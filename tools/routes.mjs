#!/usr/bin/env node
// 고덕에서 구간별 경로(노선·승하차역·시간·요금)를 받아와 일정에 저장 (키·인증 필요 없음)
//   node tools/routes.mjs            → private/trip.json 갱신
//   node tools/routes.mjs --dry      → 결과만 출력
// 고덕 웹 길찾기 페이지의 "링크 미리보기용" 요약을 읽음 (디스코드 미리보기와 같은 방식)
import { P, readJSON, writeJSON } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const TYPE = { subway: 1, bus: 1, taxi: 0 }; // 고덕 type: 0 차, 1 대중교통 (도보는 고덕 웹에 페이지가 없음)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasPos = s => Number.isFinite(s && s.lat) && Number.isFinite(s && s.lng);
const nm = s => String(s.zh || s.name).replace(/[|]/g, ' ');

function decode(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\|[\s|]*/g, '|');
}

// "1小时6分钟" → 66
function minutes(t) {
  const h = /(\d+)小时/.exec(t);
  const m = /(\d+)分钟/.exec(t);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

// 노선 이름 줄이기: "地铁4号线外圈(宜山路--宜山路)" → "地铁4号线外圈"
const shortLine = l => l.replace(/\(.*?\)/g, '').trim();

function parse(text, type) {
  const i = text.indexOf('|方案1|');
  if (i < 0) return null;
  const end = text.indexOf('|方案2|', i);
  const seg = text.slice(i, end > 0 ? end : i + 3000).split('|').filter(Boolean);
  const r = { min: null, km: null, fare: null, walkM: null, steps: [] };
  for (const t of seg) {
    if (r.min == null && /(小时|分钟)/.test(t) && !/步行/.test(t)) r.min = minutes(t);
    else if (r.km == null && /^[\d.]+公里$/.test(t)) r.km = parseFloat(t);
    else if (r.km == null && /^\d+米$/.test(t)) r.km = parseInt(t, 10) / 1000;
    else if (/^[\d.]+元$/.test(t)) r.fare = parseFloat(t);
    else if (/^步行\s*[\d.]+(米|公里)/.test(t)) {
      const m = /步行\s*([\d.]+)(米|公里)/.exec(t);
      r.walkM = Math.round(parseFloat(m[1]) * (m[2] === '公里' ? 1000 : 1));
    }
    const st = /乘坐(.+?)，从(.+?)上车，(.+?)下车/.exec(t);
    if (st) r.steps.push({ line: shortLine(st[1]), from: st[2], to: st[3] });
  }
  if (type === 2 && r.walkM == null && r.km != null) r.walkM = Math.round(r.km * 1000);
  return r.min != null ? r : null;
}

async function fetchRoute(from, to, type) {
  const q = new URLSearchParams({
    fname: nm(from), flat: from.lat.toFixed(6), flon: from.lng.toFixed(6),
    dname: nm(to), dlat: to.lat.toFixed(6), dlon: to.lng.toFixed(6),
    type: String(type), policy: '0',
  });
  const url = `https://www.amap.com/ssr/dir?${q}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return parse(decode(await res.text()), type);
    } catch { /* 다시 */ }
    await sleep(2000);
  }
  return null;
}

// 앱에 보여줄 한 줄 요약
export function summary(r) {
  const parts = [];
  if (r.min != null) parts.push(r.min >= 60 ? `${Math.floor(r.min / 60)}시간 ${r.min % 60}분` : `${r.min}분`);
  if (r.fare) parts.push(`${r.fare}위안`);
  if (r.walkM) parts.push(`도보 ${r.walkM >= 1000 ? `${(r.walkM / 1000).toFixed(1)}km` : `${r.walkM}m`}`);
  return parts.join(' · ');
}

// 고덕은 '지금' 기준 경로만 줌 → 중국이 밤이면 심야버스 경로가 나와서 받지 않음
const chinaHour = new Date(Date.now() + 8 * 3600000).getUTCHours();
if ((chinaHour < 7 || chinaHour >= 21) && !process.argv.includes('--force')) {
  console.log(`지금 중국 시간이 ${chinaHour}시예요. 밤에는 고덕이 심야 노선으로 안내해서 받지 않아요.`);
  console.log('중국 시간 07~21시 (한국 시간 08~22시)에 다시 실행해 주세요.');
  process.exit(2);
}

const data = readJSON(P.trip);
let ok = 0, fail = 0, skip = 0;
for (const day of data.days) {
  for (const t of day.tracks) {
    let prev = null;
    for (const s of t.stops) {
      const mode = s.move && s.move.mode;
      const type = TYPE[mode];
      if (prev && hasPos(s) && type != null && !s.skip) {
        const r = await fetchRoute(prev, s, type);
        if (r) {
          s.route = { ...r, from: prev.id, at: new Date().toISOString().slice(0, 10) };
          ok++;
          const steps = r.steps.map(x => `${x.line} ${x.from}→${x.to}`).join(' / ');
          console.log(`✔ ${day.date} ${prev.name} → ${s.name}: ${summary(r)}${steps ? `  [${steps}]` : ''}`);
        } else {
          fail++;
          console.log(`✖ ${day.date} ${prev.name} → ${s.name}: 못 가져옴 (기존 정보 유지)`);
        }
        await sleep(1200);
      } else if (prev && hasPos(s)) {
        skip++;
      }
      if (hasPos(s) && !s.skip) prev = s;
    }
  }
}
console.log(`\n가져옴 ${ok} · 실패 ${fail} · 건너뜀(기차·비행기 등) ${skip}`);
if (!DRY) {
  data.meta = { ...(data.meta || {}), updatedAt: new Date().toISOString() };
  writeJSON(P.trip, data);
  console.log('✔ private/trip.json 저장 — 앱에 반영하려면: (배포 전) node tools/trip.mjs seal --data / (배포 후) node tools/trip.mjs push');
}
