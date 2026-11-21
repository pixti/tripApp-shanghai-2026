// PC 브라우저(안드로이드 아님)에서는 고덕 링크가 웹 주소여야 함
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT } from '../lib.mjs';
const PORT = 8097, DBG = 9335, sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8')).pass;
const procs = []; const cleanup = () => procs.forEach(p => { try { p.kill(); } catch {} });
const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' }); procs.push(server);
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await sleep(200); }
procs.push(spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'dk-'))}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: `http://localhost:${PORT}/` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
const wait = async x => { for (let i = 0; i < 100; i++) { try { if (await ev(x)) return; } catch {} await sleep(200); } throw new Error('timeout ' + x); };
try {
  await wait(`!!document.querySelector('.lock-inp')`);
  await ev(`(() => { document.querySelector('.lock-inp').value = ${JSON.stringify(PASS)}; document.querySelector('.lock-form').requestSubmit(); })()`);
  await wait(`!!document.querySelector('#stop-d1-07 .actions a.btn.primary')`);
  const href = await ev(`document.querySelector('#stop-d1-07 .actions a.btn.primary').href`);
  const tgt = await ev(`document.querySelector('#stop-d1-07 .actions a.btn.primary').target`);
  assert.ok(decodeURIComponent(href).startsWith('https://uri.amap.com/marker?position=121.475108,31.232687'), href);
  assert.equal(tgt, '_blank');
  const conn = await ev(`document.querySelector('#stop-d1-08').previousElementSibling.querySelector('.route-btn').href`);
  assert.ok(decodeURIComponent(conn).startsWith('https://uri.amap.com/navigation?from=121.475108'), conn);
  console.log('  ✔ PC: 길찾기 = 웹 고덕지도 위치 보기(새 탭), 구간 경로 = 웹 길찾기');
} catch (e) { console.error('  ✖', e.message); process.exitCode = 1; }
cleanup(); process.exit();
