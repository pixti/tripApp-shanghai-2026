// 배포용 설정(서비스워커 켬)으로: 한 번 열고 → 인터넷 끊고 → 새로고침해도 앱·일정·지도가 나오는지
//   node tools/test/offline.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../lib.mjs';

const OUT = path.join(ROOT, 'tools', 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8098;
const DBG = 9334;
const BASE = `http://localhost:${PORT}/`;
const PASS = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8')).pass;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const cleanup = () => procs.forEach(p => { try { p.kill(); } catch { /* */ } });
process.on('exit', cleanup);

let msgId = 0;
const pending = new Map();
let ws;
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT), '--prod'], { cwd: ROOT, stdio: 'ignore' });
  procs.push(server);
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* */ }
    await sleep(200);
  }
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-off-'));
  procs.push(spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
  let ver = null;
  for (let i = 0; i < 50 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); }
  }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sid);
  const ev = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, ms = 20000, label = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await ev(expr)) return; } catch { /* */ }
      await sleep(200);
    }
    throw new Error(`시간 초과: ${label}`);
  };
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

  await S('Page.navigate', { url: BASE });
  await waitFor(`!!document.querySelector('.lock-inp')`);
  await ev(`(() => { document.querySelector('.lock-inp').value = ${JSON.stringify(PASS)}; document.querySelector('.lock-form').requestSubmit(); })()`);
  await waitFor(`!!document.querySelector('.day-head .dh-title')`, 25000, '일정 표시');
  await ev(`(() => { const b = [...document.querySelectorAll('.sheet .seg-btn')][1]; if (b) b.click(); })()`);
  await waitFor(`navigator.serviceWorker.controller !== null || (navigator.serviceWorker.ready.then(() => true))`, 15000, '서비스워커');
  await waitFor(`(async () => (await caches.keys()).some(k => k.startsWith('shell-')))()`, 15000, '앱 저장');
  await waitFor(`document.querySelectorAll('.leaflet-tile-loaded').length > 4`, 20000, '지도 타일');
  await sleep(1500);
  const tiles = await ev(`(async () => (await (await caches.open('tiles-v1')).keys()).length)()`);
  console.log(`  1. 온라인으로 열기 + 서비스워커 설치 (지도 조각 ${tiles}장 저장됨)`);
  assert.ok(tiles > 0, '타일이 저장되지 않음');
  // 서비스워커가 페이지를 제어하도록 한 번 새로고침
  await S('Page.reload', {});
  await waitFor(`!!document.querySelector('.day-head .dh-title') && !!navigator.serviceWorker.controller`, 20000, '재로드 후 제어');

  // 오프라인
  await S('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await S('Page.reload', {});
  await waitFor(`!!document.querySelector('.day-head .dh-title')`, 20000, '오프라인에서 일정 표시');
  await waitFor(`document.querySelectorAll('.leaflet-tile-loaded').length > 2`, 10000, '오프라인 지도 타일');
  await sleep(800);
  const r = await S('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, '20-offline-reload.png'), Buffer.from(r.data, 'base64'));
  const status = await ev(`document.querySelector('.sync').textContent`);
  assert.equal(await ev(`document.querySelectorAll('.stop').length > 0`), true);
  console.log(`  2. 인터넷 끊고 새로고침 → 앱·일정·지도 표시 (상태: ${status.trim()})`);
  if (errors.length) throw new Error(`오류: ${errors.join(' | ')}`);
  console.log(`\n  ✔ 오프라인 시험 통과`);
}

main().then(() => { cleanup(); process.exit(0); }).catch(e => { console.error(`  ✖ ${e.stack || e}`); cleanup(); process.exit(1); });
