// 실제 배포 사이트 점검: 열기 → 비밀번호 → 일정 → GitHub 저장(체크 켰다 끄기) → 되돌림 확인
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { ROOT } from '../lib.mjs';
const URL = process.argv[2] || 'https://pixti.github.io/tripApp-shanghai-2026/';
const SEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8'));
const DBG = 9337, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'live-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true }, sessionId);
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' }, sessionId);
await send('Page.navigate', { url: URL }, sessionId);
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
const wait = async (x, l, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(x)) return; } catch {} await sleep(300); } throw new Error('시간 초과: ' + l); };
const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(path.join(ROOT, 'tools', 'test', 'out', f), Buffer.from(r.data, 'base64')); };
try {
  await wait(`!!document.querySelector('.lock-inp')`, '잠금 화면');
  console.log('  ✔ 사이트 열림 · 잠금 화면');
  await ev(`(() => { document.querySelector('.lock-inp').value = ${JSON.stringify(SEC.pass)}; document.querySelector('.lock-form').requestSubmit(); })()`);
  await wait(`!!document.querySelector('.day-head .dh-title')`, '일정 표시');
  await wait(`[...document.querySelectorAll('.sheet .seg-btn')].length > 0`, '이름 묻기');
  await ev(`[...document.querySelectorAll('.sheet .seg-btn')][0].click()`);
  await wait(`document.querySelector('.sync').className.includes('s-ok')`, 'GitHub 동기화');
  console.log('  ✔ 비밀번호 해제 → 일정 표시 → GitHub 연결(온라인)');
  console.log('  ✔ 편집 가능:', await ev(`!!document.querySelector('.edit-toggle')`));
  await wait(`document.querySelectorAll('.leaflet-tile-loaded').length > 3`, '고덕 지도');
  await sleep(1500); await shot('40-live.png');
  console.log('  ✔ 고덕 지도 타일 로드');
  // 저장 시험: 체크리스트 항목 하나 켰다가 다시 끔
  await ev(`[...document.querySelectorAll('.tab')].find(t => t.textContent.includes('예약')).click()`);
  await wait(`!!document.querySelector('.check-who')`, '예약 탭');
  await ev(`[...document.querySelectorAll('.check-who .seg-btn')][0].click()`);
  await sleep(500);
  const title = '여권 원본 항상 몸에 지니기';
  const row = `[...document.querySelectorAll('.check-row')].find(r => r.textContent.includes('${title}'))`;
  await wait(`!!${row}`, '항목');
  await ev(`${row}.querySelector('.check-box').click()`);
  await wait(`${row}.classList.contains('is-done') && document.querySelector('.sync').className.includes('s-ok')`, '저장 1', 40000);
  console.log('  ✔ 체크 → GitHub에 저장됨');
  await ev(`${row}.querySelector('.check-box').click()`);
  await wait(`!${row}.classList.contains('is-done') && document.querySelector('.sync').className.includes('s-ok')`, '저장 2', 40000);
  console.log('  ✔ 다시 해제 → 저장됨 (원래대로)');
  if (errs.length) console.log('  ⚠ 오류:', errs);
} catch (e) { console.error('  ✖', e.message); process.exitCode = 1; }
chrome.kill(); process.exit();
