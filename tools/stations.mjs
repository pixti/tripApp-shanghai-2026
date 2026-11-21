#!/usr/bin/env node
// 오픈스트리트맵 지하철역 데이터로 각 장소의 가장 가까운 역 찾기 (키·인증 필요 없음)
//   node tools/stations.mjs          → 결과만 출력
//   node tools/stations.mjs --write  → private/trip.json 의 station 칸 채우기/고치기
import { P, readJSON, writeJSON } from './lib.mjs';
import { wgs2gcj, distM } from '../js/gcj.js';

const WRITE = process.argv.includes('--write');
const data = readJSON(P.trip);
const stops = data.days.flatMap(d => d.tracks.flatMap(t => t.stops)).filter(s => Number.isFinite(s.lat));

// 장소 주변 영역을 도시별로 묶어서 한 번에 받기
const boxes = [];
for (const s of stops) {
  let b = boxes.find(b => Math.abs(b.lat - s.lat) < 0.5 && Math.abs(b.lng - s.lng) < 0.5);
  if (!b) boxes.push(b = { lat: s.lat, lng: s.lng, pts: [] });
  b.pts.push(s);
}
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
async function overpass(q) {
  let last;
  for (let i = 0; i < 6; i++) {
    const url = MIRRORS[i % MIRRORS.length];
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': 'trip-planner-stations/1.0' } });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status} (${url})`;
    } catch (e) { last = e.message; }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Overpass 실패: ${last}`);
}
const stations = [];
for (const b of boxes) {
  const lats = b.pts.map(p => p.lat), lngs = b.pts.map(p => p.lng);
  const bbox = [Math.min(...lats) - 0.03, Math.min(...lngs) - 0.03, Math.max(...lats) + 0.03, Math.max(...lngs) + 0.03].join(',');
  const q = `[out:json][timeout:60];(node["railway"="station"]["station"="subway"](${bbox});node["public_transport"="station"]["subway"="yes"](${bbox});node["railway"="station"]["station"="light_rail"](${bbox}););out;`;
  const j = await overpass(q);
  for (const el of j.elements) {
    const name = el.tags['name:zh'] || el.tags.name;
    if (!name || !/[一-鿿]/.test(name) || /在建|规划/.test(name)) continue;
    const [lat, lng] = wgs2gcj(el.lat, el.lon); // 고덕 좌표로
    stations.push({ name: name.endsWith('站') ? name : `${name}站`, lat, lng });
  }
}
// 같은 이름(여러 출입구·노선) 합치기
const seen = new Map();
for (const s of stations) if (!seen.has(s.name)) seen.set(s.name, []); 
for (const s of stations) seen.get(s.name).push(s);

let changed = 0;
for (const s of stops) {
  let best = null;
  for (const [name, list] of seen) {
    const d = Math.min(...list.map(x => distM(s, x)));
    if (!best || d < best.d) best = { name, d };
  }
  if (!best) continue;
  const far = best.d > 1500;
  const mark = s.station === best.name ? '=' : (s.station ? '≠' : '+');
  console.log(`${mark} ${s.name.padEnd(22)} ${best.name} (${Math.round(best.d)}m)${s.station && s.station !== best.name ? `  [기존: ${s.station}]` : ''}${far ? '  ⚠ 1.5km 넘음 → 비워둠' : ''}`);
  if (WRITE) {
    const v = far ? '' : best.name;
    if (s.station !== v) { s.station = v; changed++; }
  }
}
console.log(`\n역 ${seen.size}곳 데이터로 장소 ${stops.length}곳 확인`);
if (WRITE) {
  data.meta = { ...(data.meta || {}), updatedAt: new Date().toISOString() };
  writeJSON(P.trip, data);
  console.log(`✔ private/trip.json 에 ${changed}곳 반영`);
}
