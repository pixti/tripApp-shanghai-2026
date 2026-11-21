// 지도 제공자 전환 시험: 일정 trip.map 을 'google' 로 바꾸면 OSM 타일 + 구글 지도 링크로 바뀌는지
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, C, loadConfig } from '../lib.mjs';
const PORT = 8096, DBG = 9336, sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8')).pass;
const procs = []; const cleanup = () => procs.forEach(p => { try { p.kill(); } catch {} });
procs.push(spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' }));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await sleep(200); }
// 가짜 저장소의 일정을 map:'google' 로 바꿔 넣기
const cfg = await loadConfig(); const key = await C.deriveKey(PASS, cfg.kdf.salt, cfg.kdf.iter);
const api = `http://localhost:${PORT}/__gh/repos/local/preview/contents/data/trip.enc.json`;
const H = { Authorization: 'Bearer devtoken-local-preview' };
const cur = await (await fetch(api, { headers: H })).json();
const data = await C.openJSON(key, Buffer.from(cur.content, 'base64').toString('utf8'));
data.trip.map = 'google'; data.trip.localLabel = '일본어'; data.trip.taxiPhrase = 'ここへ行ってください。'; data.trip.taxiPhraseKo = '(여기로 가 주세요)'; data.trip.localLang = 'ja';
const text = await C.sealJSON(key, data);
await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'google', content: Buffer.from(text).toString('base64'), sha: cur.sha }) });
procs.push(spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'gg-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true }, sessionId);
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, sessionId);
await send('Page.navigate', { url: `http://localhost:${PORT}/` }, sessionId);
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
const wait = async (x, l) => { for (let i = 0; i < 100; i++) { try { if (await ev(x)) return; } catch {} await sleep(200); } throw new Error('timeout ' + (l || x)); };
try {
  await wait(`!!document.querySelector('.lock-inp')`);
  await ev(`(() => { document.querySelector('.lock-inp').value = ${JSON.stringify(PASS)}; document.querySelector('.lock-form').requestSubmit(); })()`);
  await wait(`!!document.querySelector('#stop-d1-07 .actions a.btn.primary')`, '일정');
  await wait(`document.querySelector('#stop-d1-07 .actions a.btn.primary').textContent.includes('구글')`, '구글로 전환');
  const href = await ev(`document.querySelector('#stop-d1-07 .actions a.btn.primary').href`);
  assert.ok(href.startsWith('https://www.google.com/maps/dir/?api=1&destination=31.232687,121.475108&travelmode=transit'), href);
  await wait(`[...document.querySelectorAll('.leaflet-tile')].some(t => t.src.includes('tile.openstreetmap.org'))`, 'OSM 타일');
  assert.ok((await ev(`document.querySelector('#stop-d1-07 .actions').textContent`)).includes('일본어 복사'));
  assert.equal(await ev(`!!document.querySelector('.map-tools .seg')`), false, '중문/영문 전환 숨김');
  await sleep(1500);
  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, 'tools', 'test', 'out', '30-google.png'), Buffer.from(r.data, 'base64'));
  console.log('  ✔ trip.map=google → 오픈스트리트맵 지도 + 구글 지도 길찾기 + "일본어" 표시 (아이폰 화면으로 확인)');
} catch (e) { console.error('  ✖', e.message); process.exitCode = 1; }
cleanup(); process.exit();
