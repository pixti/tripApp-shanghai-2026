#!/usr/bin/env node
// 일정 데이터 도구
//   node tools/trip.mjs seed          private/seed.mjs → private/trip.json
//   node tools/trip.mjs check         private/trip.json 점검
//   node tools/trip.mjs print         일정 요약 출력
//   node tools/trip.mjs seal [--data] [--new-salt]
//                                     config.js(암호화된 토큰·확인값) 다시 만들기
//                                     --data: private/trip.json 을 data/trip.enc.json 으로 암호화 (처음 올릴 때만!)
//   node tools/trip.mjs pull          GitHub의 최신 일정 → private/trip.json
//   node tools/trip.mjs push [--force] private/trip.json → GitHub (폰에서 고친 내용 덮어쓰기 방지 확인)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { P, C, readJSON, writeJSON, loadSecrets, loadConfig, stamp, configSource, keyFor, ghGet, ghPut } from './lib.mjs';
import { CAT, MOVE } from '../js/consts.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = name => args.includes(name);

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function cmdSeed() {
  const mod = await import(`${pathToFileURL(P.seed).href}?t=${Date.now()}`);
  const data = mod.default;
  if (fs.existsSync(P.trip) && !flag('--force')) {
    fail(`${P.trip} 가 이미 있어요. 덮어쓰려면 --force`);
  }
  writeJSON(P.trip, data);
  console.log(`✔ ${P.trip} 작성`);
  check(data);
}

function check(data) {
  const warn = [];
  const ids = new Set();
  const inChina = s => s.lat > 18 && s.lat < 54 && s.lng > 73 && s.lng < 135;
  let prevDate = '';
  for (const [di, d] of (data.days || []).entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) warn.push(`Day${di + 1}: 날짜 형식 오류 ${d.date}`);
    if (prevDate && d.date <= prevDate) warn.push(`Day${di + 1}: 날짜 순서 이상`);
    prevDate = d.date;
    if (!d.tracks || !d.tracks.length) warn.push(`Day${di + 1}: 일정(track)이 없음`);
    for (const t of d.tracks || []) {
      for (const s of t.stops || []) {
        const where = `Day${di + 1}/${t.label}/${s.name}`;
        if (!s.id) warn.push(`${where}: id 없음`);
        else if (ids.has(s.id)) warn.push(`${where}: id 중복 ${s.id}`);
        ids.add(s.id);
        if (!s.name) warn.push(`${where}: 이름 없음`);
        if (!CAT[s.cat]) warn.push(`${where}: 종류 이상 ${s.cat}`);
        if (s.move && !MOVE[s.move.mode]) warn.push(`${where}: 이동수단 이상 ${s.move.mode}`);
        const hasLat = Number.isFinite(s.lat);
        const hasLng = Number.isFinite(s.lng);
        if (hasLat !== hasLng) warn.push(`${where}: 위도/경도 한쪽만 있음`);
        if (hasLat && hasLng && !inChina(s)) warn.push(`${where}: 좌표가 중국 밖 (${s.lat}, ${s.lng})`);
        for (const l of s.links || []) if (!/^https?:\/\//.test(l.url || '')) warn.push(`${where}: 링크 주소 이상 ${l.url}`);
      }
    }
  }
  const cids = new Set();
  for (const c of data.checklist || []) {
    if (cids.has(c.id)) warn.push(`체크리스트 id 중복 ${c.id}`);
    cids.add(c.id);
  }
  const iids = new Set();
  for (const s of data.info || []) {
    if (iids.has(s.id)) warn.push(`정보 id 중복 ${s.id}`);
    iids.add(s.id);
  }
  const stopN = (data.days || []).reduce((n, d) => n + d.tracks.reduce((m, t) => m + t.stops.length, 0), 0);
  console.log(`  날짜 ${data.days.length}일 · 장소 ${stopN}곳 · 체크리스트 ${(data.checklist || []).length}개 · 정보 ${(data.info || []).length}개`);
  if (warn.length) {
    console.log(`  ⚠ 확인할 것 ${warn.length}건`);
    for (const w of warn) console.log(`   - ${w}`);
  } else {
    console.log('  ✔ 문제 없음');
  }
  return warn;
}

function cmdCheck() {
  const data = readJSON(P.trip);
  const warn = check(data);
  if (warn.length) process.exitCode = 2;
}

function cmdPrint() {
  const data = readJSON(P.trip);
  for (const [i, d] of data.days.entries()) {
    console.log(`\nDay${i + 1} ${d.date} ${d.title}`);
    for (const t of d.tracks) {
      if (d.tracks.length > 1) console.log(`  [${t.label}]`);
      t.stops.forEach((s, j) => {
        const pos = Number.isFinite(s.lat) ? `${s.lat.toFixed(5)},${s.lng.toFixed(5)}` : '좌표 없음';
        console.log(`   ${String(j + 1).padStart(2)}. ${s.name}  ${s.zh ? `(${s.zh})` : ''}  [${pos}]${s.review ? ' *검토' : ''}`);
      });
    }
  }
}

async function cmdSeal() {
  const s = loadSecrets();
  const prev = await loadConfig();
  const salt = !prev || flag('--new-salt') ? C.newSalt() : prev.kdf.salt;
  const iter = (prev && !flag('--new-salt') && prev.kdf.iter) || C.KDF_ITER;
  const cfg = { kdf: { salt, iter } };
  const key = await keyFor(s.pass, cfg);
  const build = stamp();
  const config = {
    v: 1,
    title: 'tripApp-shanghai-2026',
    repo: s.owner ? { owner: s.owner, name: s.repo, branch: s.branch, path: 'data/trip.enc.json' } : null,
    api: 'https://api.github.com',
    dataUrl: 'data/trip.enc.json',
    kdf: { salt, iter },
    check: await C.sealText(key, `ok:${build}`),
    token: s.token ? await C.sealText(key, s.token) : null,
    build,
    sw: true,
  };
  fs.writeFileSync(P.config, configSource(config), 'utf8');
  console.log(`✔ config.js 작성 (저장소: ${config.repo ? `${s.owner}/${s.repo}` : '없음 — 보기 전용'}, 토큰: ${config.token ? '있음' : '없음'})`);

  if (flag('--data') || !fs.existsSync(P.data)) {
    const data = readJSON(P.trip);
    const warn = check(data);
    if (warn.length && !flag('--force')) fail('데이터에 확인할 것이 있어요. 그래도 하려면 --force');
    fs.mkdirSync(path.dirname(P.data), { recursive: true });
    fs.writeFileSync(P.data, await C.sealJSON(key, data), 'utf8');
    console.log(`✔ data/trip.enc.json 암호화 저장 (${fs.statSync(P.data).size} bytes)`);
  } else {
    // 비밀번호가 바뀌었으면 기존 일정 파일을 새 키로 다시 암호화해야 함
    let ok = false;
    try {
      await C.openJSON(key, fs.readFileSync(P.data, 'utf8'));
      ok = true;
    } catch { ok = false; }
    if (!ok) console.log('⚠ data/trip.enc.json 이 지금 비밀번호로 열리지 않아요. 비밀번호를 바꿨다면: pull(옛 비밀번호) → seal --data(새 비밀번호) → push --force');
  }

  const sw = fs.readFileSync(P.sw, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${build}';`);
  fs.writeFileSync(P.sw, sw, 'utf8');
  console.log(`✔ sw.js 버전 ${build}`);
}

async function cmdPull() {
  const s = loadSecrets();
  if (!s.owner || !s.token) fail('secrets.json 에 owner/token 이 없어요');
  const cfg = await loadConfig();
  const key = await keyFor(s.pass, cfg);
  const r = await ghGet(s);
  const data = await C.openJSON(key, r.text);
  if (fs.existsSync(P.trip)) {
    fs.mkdirSync(P.backup, { recursive: true });
    fs.copyFileSync(P.trip, path.join(P.backup, `trip-${stamp()}.json`));
  }
  writeJSON(P.trip, data);
  console.log(`✔ GitHub 최신 일정 → private/trip.json (버전 ${data.meta && data.meta.rev}, ${data.meta && data.meta.updatedBy} 수정)`);
}

async function cmdPush() {
  const s = loadSecrets();
  if (!s.owner || !s.token) fail('secrets.json 에 owner/token 이 없어요');
  const cfg = await loadConfig();
  const key = await keyFor(s.pass, cfg);
  const local = readJSON(P.trip);
  const warn = check(local);
  if (warn.length && !flag('--force')) fail('데이터에 확인할 것이 있어요. 그래도 하려면 --force');
  const r = await ghGet(s);
  const remote = await C.openJSON(key, r.text);
  const rr = (remote.meta && remote.meta.rev) || 0;
  const lr = (local.meta && local.meta.rev) || 0;
  if (rr !== lr && !flag('--force')) {
    fail(`GitHub 일정(버전 ${rr})이 내 파일(버전 ${lr})과 달라요 — 폰에서 고친 게 있을 수 있어요.\n  먼저 pull 해서 받은 뒤 고치거나, 정말 덮어쓰려면 --force`);
  }
  local.meta = { ...(local.meta || {}), rev: rr + 1, updatedAt: new Date().toISOString(), updatedBy: 'PC' };
  const text = await C.sealJSON(key, local);
  await ghPut(s, text, r.sha, '일정 수정 (PC)');
  writeJSON(P.trip, local);
  console.log(`✔ GitHub에 올림 (버전 ${local.meta.rev})`);
}

const cmds = { seed: cmdSeed, check: cmdCheck, print: cmdPrint, seal: cmdSeal, pull: cmdPull, push: cmdPush };
if (!cmds[cmd]) {
  console.log('사용법: node tools/trip.mjs <seed|check|print|seal|pull|push>');
  process.exit(1);
}
Promise.resolve(cmds[cmd]()).catch(e => fail(e.message || String(e)));
