#!/usr/bin/env node
// README용 앱 화면 찍기 → docs/screenshots/*.png   (node tools/screenshots.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { ROOT } from './lib.mjs';
const OUT = path.join(ROOT, 'docs', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8095, DBG = 9338, sleep = ms => new Promise(r => setTimeout(r, ms));
const SEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8'));
const procs = []; const cleanup = () => procs.forEach(p => { try { p.kill(); } catch {} });
procs.push(spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore' }));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch {} await sleep(200); }
procs.push(spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'))}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' }));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36' }, sid);
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }, sid)).result.value;
const wait = async x => { for (let i = 0; i < 100; i++) { try { if (await ev(x)) return; } catch {} await sleep(200); } throw new Error('timeout ' + x); };
const shot = async f => { await sleep(900); const r = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(path.join(OUT, f), Buffer.from(r.data, 'base64')); console.log('  ✔', f); };
const tab = t => ev(`[...document.querySelectorAll('.tab')].find(x => x.textContent.includes(${JSON.stringify(t)})).click()`);
const tiles = () => wait(`document.querySelectorAll('.leaflet-tile-loaded').length > 6`);
try {
  await send('Page.navigate', { url: `http://localhost:${PORT}/` }, sid);
  await wait(`!!document.querySelector('.lock-inp')`);
  await shot('0-');
  await ev(`(() => { document.querySelector('.lock-inp').value = ${JSON.stringify(SEC.pass)}; document.querySelector('.lock-form').requestSubmit(); })()`);
  await wait(`[...document.querySelectorAll('.sheet .seg-btn')].length > 0`);
  await ev(`[...document.querySelectorAll('.sheet .seg-btn')][0].click()`);
  await sleep(500);
  await tab('Day 3'); await tiles();
  await shot('1-day.png');
  await ev(`(() => { const m = document.querySelector('.move.has-route'); m.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); })()`);
  await shot('2-route.png');
  await tab('Day 5'); await tiles();
  await ev(`(() => { const d = document.querySelector('#stop-d5-04 details.tmi'); d.open = true; d.scrollIntoView({ block: 'start' }); window.scrollBy(0, -140); })()`);
  await shot('3-guide.png');
  await tab('Day 3'); await sleep(800);
  await ev(`[...document.querySelectorAll('#stop-d3-05 .actions .btn')].find(b => b.textContent.includes('⋯')).click()`);
  await wait(`!!document.querySelector('.menu')`);
  await ev(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.includes('크게 보여주기')).click()`);
  await wait(`!!document.querySelector('.zh-big')`);
  await shot('4-chinese.png');
  await ev('history.back()'); await sleep(500);
  await tab('예약');
  await wait(`!!document.querySelector('.check-who')`);
  await ev(`[...document.querySelectorAll('.check-who .seg-btn')][0].click()`);
  await ev(`(() => { const g = [...document.querySelectorAll('.group-title')].find(x => x.textContent.includes('오픈 예정')); if (g) { g.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); } })()`);
  await shot('5-booking.png');
  await tab('정보');
  await wait(`!!document.querySelector('.conv-in')`);
  await ev(`(() => { const i = document.querySelector('.conv-in'); i.value = '128'; i.dispatchEvent(new Event('input')); window.scrollTo(0, 0); })()`);
  await shot('6-info.png');
} catch (e) { console.error('  ✖', e.message); process.exitCode = 1; }
cleanup(); process.exit();
