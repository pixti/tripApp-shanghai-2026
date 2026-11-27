// 브라우저 통합 테스트 (크롬을 휴대폰 크기로 띄워서 실제로 눌러봄)
//   node tools/test/browser.mjs        → 스크린샷: tools/test/out/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, C, loadConfig } from '../lib.mjs';

const OUT = path.join(ROOT, 'tools', 'test', 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8099;
const DBG = 9333;
const BASE = `http://localhost:${PORT}/`;
const SEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8'));
const [P1, P2] = SEC.testPeople || ['A', 'B'];
const PASS = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'secrets.json'), 'utf8')).pass;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const procs = [];
function cleanup() {
  for (const p of procs) {
    try { p.kill(); } catch { /* 이미 종료 */ }
  }
}
process.on('exit', cleanup);

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    return new CDP(ws);
  }
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(`${m.error.message} ${m.error.data || ''}`));
        else res(m.result);
      } else if (m.method) {
        for (const h of this.handlers) h(m);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

class Page {
  constructor(cdp, sessionId, name) {
    this.cdp = cdp;
    this.sid = sessionId;
    this.name = name;
    this.errors = [];
    cdp.handlers.push(m => {
      if (m.sessionId !== this.sid) return;
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/autonavi|favicon/.test(m.params.entry.url || '')) this.errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    });
  }
  send(method, params) { return this.cdp.send(method, params, this.sid); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval 실패: ${expr}\n${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(expr, ms = 15000, label = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expr)) return; } catch { /* 계속 */ }
      await sleep(150);
    }
    throw new Error(`[${this.name}] 시간 초과: ${label}`);
  }
  click(sel) {
    return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('없음: ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
  }
  clickText(sel, text) {
    return this.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)})); if (!el) throw new Error('없음: ' + ${JSON.stringify(text)}); el.click(); return true; })()`);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
  }
  async idle(ms = 600) { await sleep(ms); }
}

async function newPage(cdp, name, { geo } = {}) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const p = new Page(cdp, sessionId, name);
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Log.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await p.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' });
  if (geo) {
    await cdp.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: `http://localhost:${PORT}`, browserContextId });
    await p.send('Emulation.setGeolocationOverride', { latitude: geo[0], longitude: geo[1], accuracy: 25 });
  }
  return p;
}

async function unlock(p, who) {
  await p.send('Page.navigate', { url: BASE });
  await p.waitFor(`!!document.querySelector('.lock-inp')`, 15000, '잠금 화면');
  await p.eval(`(() => { const i = document.querySelector('.lock-inp'); i.value = ${JSON.stringify(PASS)}; i.dispatchEvent(new Event('input')); document.querySelector('.lock-form').requestSubmit(); return true; })()`);
  await p.waitFor(`!!document.querySelector('.day-head .dh-title')`, 20000, '일정 화면');
  await p.waitFor(`[...document.querySelectorAll('.sheet .seg-btn')].some(b => b.textContent === ${JSON.stringify(who)})`, 8000, '이름 묻기');
  await p.clickText('.sheet .seg-btn', who);
  await p.idle(500);
}

async function mockState() {
  return (await fetch(`http://localhost:${PORT}/__gh/_state`)).json();
}

async function remoteData() {
  const cfg = await loadConfig();
  const key = await C.deriveKey(PASS, cfg.kdf.salt, cfg.kdf.iter);
  const r = await fetch(`http://localhost:${PORT}/__gh/repos/local/preview/contents/data/trip.enc.json`, { headers: { Authorization: 'Bearer devtoken-local-preview' } });
  const j = await r.json();
  return C.openJSON(key, Buffer.from(j.content, 'base64').toString('utf8'));
}

let step = 0;
function log(msg) {
  step++;
  console.log(`  ${String(step).padStart(2)}. ${msg}`);
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '--port', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(server);
  server.stdout.on('data', d => { if (process.env.VERBOSE) process.stdout.write(`[server] ${d}`); });
  server.stderr.on('data', d => process.stdout.write(`[server!] ${d}`));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* 대기 */ }
    await sleep(200);
  }
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--lang=ko-KR', 'about:blank'], { stdio: 'ignore' });
  procs.push(chrome);
  let ver = null;
  for (let i = 0; i < 50 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); }
  }
  const cdp = await CDP.connect(ver.webSocketDebuggerUrl);

  // ── A: 재형 ───────────────────────────────────────────
  const A = await newPage(cdp, 'A', { geo: [31.2304, 121.4737] });
  await unlock(A, P1);
  log('잠금 해제 + 이름 선택');
  await A.waitFor(`document.querySelectorAll('.leaflet-tile-loaded').length > 4`, 20000, '지도 타일');
  await A.idle(800);
  await A.shot('01-day1.png');
  assert.equal(await A.eval(`document.querySelectorAll('.stop').length`), 11);
  assert.equal(await A.eval(`document.querySelectorAll('.leaflet-marker-icon').length`), 9);
  assert.ok(!(await A.eval(`document.querySelector('.next-bar').textContent.includes('null')`)), '다음 목적지 바에 null');
  log('Day1: 장소 11곳, 지도 핀 9개 (한국 구간 제외), 타일 로드');

  // 고덕 링크 형식
  const href = await A.eval(`document.querySelector('#stop-d1-07 .actions a.btn.primary').getAttribute('href')`);
  assert.ok(href.startsWith('intent://route/plan/?sourceApplication=tripplanner&dlat=31.232687&dlon=121.475108'), href);
  log('고덕 길찾기 링크 = 앱 열기(intent) 형식');

  // Day3
  await A.clickText('.tab', 'Day 3');
  await A.waitFor(`document.querySelector('.dh-title').textContent === '조계지'`);
  await A.idle(1200);
  await A.shot('02-day3.png');
  assert.equal(await A.eval(`document.querySelectorAll('.stop').length`), 9);
  log('Day3 탭 이동 (9곳)');

  // 다음 목적지 바 + 완료 체크
  assert.ok((await A.eval(`document.querySelector('.nb-name').textContent`)).startsWith('1.'));
  await A.click('#stop-d3-01 .done-btn');
  await A.idle(300);
  assert.ok((await A.eval(`document.querySelector('.nb-name').textContent`)).startsWith('2.'));
  log('완료 체크 → 다음 목적지가 2번으로');

  // 중국어 복사 (고덕 붙여넣기용) + 가까운 역
  assert.ok((await A.eval(`document.querySelector('#stop-d3-06 .actions').textContent`)).includes('중국어 복사'));
  assert.equal(await A.eval(`document.querySelector('#stop-d3-06 .st-name').textContent`), '交通大学站');
  await A.clickText('#stop-d3-06 .actions button.btn', '중국어 복사');
  await A.waitFor(`document.querySelector('#toast').textContent.includes('복사')`, 5000, '복사 안내');
  log('중국어 복사 버튼 + 가까운 역(交通大学站) 표시');
  // 중국어 크게 보여주기 (⋯ 메뉴)
  await A.click('#stop-d3-06 .actions .btn.icon');
  await A.waitFor(`!!document.querySelector('.menu')`);
  await A.clickText('.menu-item', '크게 보여주기');
  await A.waitFor(`!document.querySelector('.menu')`, 5000, '메뉴 닫힘');
  await A.waitFor(`!!document.querySelector('.zh-big')`, 8000, '크게 보기');
  assert.equal(await A.eval(`document.querySelector('.zh-big').textContent`), '武康大楼');
  await A.idle(400);
  await A.shot('03-zh.png');
  await A.eval('history.back()');
  await A.waitFor(`!document.querySelector('.sheet-wrap')`, 5000, '뒤로가기로 시트 닫힘');
  log('중국어 보여주기 + 뒤로가기로 닫힘');

  // 내 위치
  await A.clickText('.map-tools .btn', '내 위치');
  await A.waitFor(`document.querySelectorAll('path.leaflet-interactive, path').length > 2`, 8000, '내 위치 점');
  await A.idle(800);
  await A.shot('04-mylocation.png');
  await A.waitFor(`/[0-9.]+(k?m)/.test(document.querySelector('.nb-dist').textContent)`, 8000, '다음 목적지 거리');
  log(`내 위치 표시 + 다음 목적지 거리 (${(await A.eval(`document.querySelector('.nb-dist').textContent`)).trim()})`);
  await A.clickText('.map-tools .btn', '내 위치');

  // 지도 크게
  await A.clickText('.map-tools .btn', '크게');
  await A.waitFor(`document.querySelector('.map-card').classList.contains('fs')`);
  await A.idle(900);
  await A.shot('05-fullscreen.png');
  await A.eval('history.back()');
  await A.waitFor(`!document.querySelector('.map-card').classList.contains('fs')`, 5000, '전체화면 닫힘');
  log('지도 크게 보기 + 뒤로가기');

  // 옆으로 밀어서 날짜 넘기기 (Day3 → Day4 → Day3)
  const swipe = async (x1, x2) => {
    await A.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: 200 }] });
    await A.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (x1 + x2) / 2, y: 205 }] });
    await A.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await A.idle(400);
  };
  await A.eval(`document.querySelector('.scroller').scrollTo(0,0)`);
  await swipe(330, 110);
  assert.equal(await A.eval(`document.querySelector('.dh-sub').textContent.startsWith('DAY 4')`), true, '왼쪽으로 밀면 다음 날');
  await swipe(110, 330);
  assert.equal(await A.eval(`document.querySelector('.dh-sub').textContent.startsWith('DAY 3')`), true, '오른쪽으로 밀면 이전 날');
  log('옆으로 밀어서 날짜 넘기기');

  // Day4 개별
  await A.clickText('.tab', 'Day 4');
  await A.waitFor(`document.querySelectorAll('.seg-btn').length >= 2`);
  assert.equal(await A.eval(`document.querySelector('.tracks .seg-btn.on').textContent`), P1);
  await A.idle(900);
  await A.shot('06-day4-jh.png');
  await A.clickText('.tracks .seg-btn', P2);
  await A.idle(900);
  await A.shot('07-day4-sj.png');
  log('Day4 개별 일정 (내 일정 먼저, 서준 탭 전환)');

  // 고덕에서 받은 경로 표시
  await A.clickText('.tab', 'Day 3');
  if (await A.eval(`!!document.querySelector('.move.has-route .mv-step')`)) {
    await A.eval(`document.querySelector('.move.has-route').scrollIntoView({block:'center'})`);
    await A.idle(400);
    await A.shot('13b-route.png');
    log('고덕 경로(노선·승하차역·시간·요금) 표시');
  } else {
    log('고덕 경로 정보 없음 (routes.bat 실행 전) — 표시 시험 건너뜀');
  }
  // 예약·발권 탭: 오픈일별로 묶어서 표시
  await A.clickText('.tab', '예약·발권');
  await A.waitFor(`!!document.querySelector('.bk-row')`);
  const bk = await A.eval(`[...document.querySelectorAll('.bk-title')].map(x => x.textContent).join('|')`);
  assert.ok(bk.includes('졸정원 입장권') && bk.includes('항저우 고속철') && !bk.includes('eSIM'), '예약 탭 항목');
  await A.shot('13a-book.png');
  log('예약·발권 탭 (예약 항목만 · 오픈일별)');
  // 할 일(준비) 사람별
  await A.clickText('.tab', '할 일');
  await A.waitFor(`!!document.querySelector('.check-who')`);
  const jh = await A.eval(`[...document.querySelectorAll('.check-title')].map(x => x.textContent).join('|')`);
  assert.ok(jh.includes('호텔에 확인 메시지') && !jh.includes('졸정원'), '재형 필터');
  await A.clickText('.check-who .seg-btn', P2);
  await A.idle(300);
  const sj = await A.eval(`[...document.querySelectorAll('.check-title')].map(x => x.textContent).join('|')`);
  assert.ok(!sj.includes('호텔에 확인 메시지') && sj.includes('알리페이'), '서준 필터');
  await A.shot('13c-check-sj.png');
  await A.clickText('.check-who .seg-btn', P1);
  log('할 일 체크리스트 사람별 보기 (둘 다 항목은 양쪽에)');

  // Day5 메모
  await A.clickText('.tab', 'Day 5');
  await A.waitFor(`!!document.querySelector('#stop-d5-08')`, 5000, 'Day5 동방지문');
  assert.equal(await A.eval(`document.querySelectorAll('.badge.review').length`), 0, 'Day5 검토 필요 표시 남음');
  assert.equal(await A.eval(`document.querySelectorAll('.stop').length`), 12);
  await A.idle(1500);
  await A.shot('08-day5.png');
  await A.eval(`document.querySelector('#stop-d5-05').scrollIntoView({block:'start'})`);
  await A.idle(500);
  await A.shot('08b-day5-food.png');
  // 둘러보기·역사 가이드
  await A.eval(`(() => { const d = document.querySelector('#stop-d5-04 details.tmi'); d.open = true; d.scrollIntoView({block:'start'}); })()`);
  await A.idle(400);
  assert.ok((await A.eval(`document.querySelector('#stop-d5-04 .tmi-body').textContent`)).includes('추천 동선'));
  assert.ok(!(await A.eval(`document.querySelector('#stop-d5-04 .tmi-body').textContent`)).includes('{zh:'), '가이드에 {zh: 글자 남음');
  await A.shot('08c-guide.png');
  // 정보 / 예약
  await A.clickText('.tab', '정보');
  await A.idle(400);
  await A.shot('09-info.png');
  await A.idle(2500); // 오늘 환율 받아오기가 끝난 뒤 계산 (타이밍 겹침 방지)
  await A.eval(`(() => { const i = document.querySelector('.conv-in'); i.value = '34.9'; i.dispatchEvent(new Event('input')); })()`);
  {
    const rate = await A.eval(`parseFloat(document.querySelector('.conv-title small').textContent.match(/= ([0-9.]+)원/)[1])`);
    const want = Math.round(34.9 * rate).toLocaleString('ko-KR');
    assert.ok((await A.eval(`document.querySelector('.conv-out').textContent`)).includes(want), `환율 계산 ${rate} → ${want}`);
    assert.ok((await A.eval(`document.querySelector('.conv-links a').href`)).includes('34.9+CNY+to+KRW'));
    await A.eval(`(() => { const i = document.querySelectorAll('.conv-in')[1]; i.value = '10000'; i.dispatchEvent(new Event('input')); })()`);
    const yuan = (10000 / rate).toFixed(1);
    assert.ok((await A.eval(`document.querySelectorAll('.conv-out')[1].textContent`)).includes(yuan), `원→위안 ${yuan}`);
  }
  await A.clickText('.tab', '예약');
  await A.idle(400);
  await A.shot('10-check.png');
  log('정보 탭(환율 계산) / 예약 체크리스트');

  // ── B: 서준 (다른 폰) ─────────────────────────────────
  const B = await newPage(cdp, 'B');
  await unlock(B, P2);
  log('두 번째 기기(서준) 잠금 해제');

  // A: 편집 모드 → Day3 우캉맨션 시간 수정
  await A.clickText('.tab', 'Day 3');
  await A.click('.edit-toggle');
  await A.waitFor(`!!document.querySelector('#stop-d3-06 .edit-row')`);
  await A.clickText('#stop-d3-06 .edit-row .btn', '수정');
  await A.waitFor(`!!document.querySelector('.editor .inp')`);
  await A.waitFor(`document.querySelectorAll('.picker-map .leaflet-tile-loaded').length > 3`, 15000, '편집 지도 타일');
  await A.idle(1500);
  await A.shot('11-editor.png');
  await A.eval(`(() => { const f = [...document.querySelectorAll('.editor .fld')].find(x => x.textContent.startsWith('시간')); const i = f.querySelector('input'); i.value = '15:30'; i.dispatchEvent(new Event('input')); return true; })()`);
  await A.clickText('.sheet-actions .btn', '저장');
  await A.waitFor(`(async () => (await (await fetch('/__gh/_state')).json()).puts.length === 1)()`, 10000, 'A 저장');
  log('A가 우캉맨션 시간 15:30으로 수정 → 저장됨');

  // B: 30초 폴링 대신 화면 복귀 이벤트로 새로고침
  await B.eval(`document.dispatchEvent(new Event('visibilitychange'))`);
  await B.clickText('.tab', 'Day 3');
  await B.waitFor(`document.querySelector('#stop-d3-06 .time') && document.querySelector('#stop-d3-06 .time').textContent.includes('15:30')`, 10000, 'B에 반영');
  log('B 화면에 A의 수정이 반영됨');

  // 동시에 수정 (가짜 저장소 응답을 느리게 해서 충돌 유도)
  await fetch(`http://localhost:${PORT}/__gh/_delay?ms=700`, { method: 'POST' });
  await B.clickText('.tab', '예약');
  await B.waitFor(`!!document.querySelector('.check-box')`);
  await Promise.all([
    B.eval(`(() => { [...document.querySelectorAll('.bk-row')].find(r => r.textContent.includes('예원 입장권')).querySelector('.check-box').click(); return true; })()`),
    A.eval(`(() => { [...document.querySelectorAll('#stop-d3-07 .edit-row .btn')].find(b => b.textContent.includes('⬆')).click(); return true; })()`),
  ]);
  await A.waitFor(`(async () => (await (await fetch('/__gh/_state')).json()).puts.length >= 3)()`, 25000, '두 저장 모두 끝');
  await fetch(`http://localhost:${PORT}/__gh/_delay?ms=0`, { method: 'POST' });
  await A.waitFor(`document.querySelector('.sync').className.includes('s-ok')`, 15000, 'A 동기화 완료');
  await B.waitFor(`document.querySelector('.sync').className.includes('s-ok')`, 15000, 'B 동기화 완료');
  const remote = await remoteData();
  const d3 = remote.days.find(d => d.id === 'd3').tracks[0].stops;
  assert.equal(d3.find(s => s.id === 'd3-06').time, '15:30', 'A의 첫 수정 유지');
  assert.equal(d3[3].id, 'd3-07', 'A의 순서 변경 반영');
  assert.equal(remote.checklist.find(c => c.id === 'c-yuyuan').done, true, 'B의 체크 반영');
  assert.equal(remote.checklist.find(c => c.id === 'c-yuyuan').doneBy, P2);
  const st = await mockState();
  log(`동시 수정 2건 모두 살아남음 (저장 ${st.puts.length}회: ${st.puts.map(x => x.message).join(' / ')})`);

  // 오프라인에서 수정 → 다시 연결되면 자동 업로드
  await A.send('Network.enable');
  await A.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await A.eval(`window.dispatchEvent(new Event('offline'))`);
  await A.clickText('#stop-d3-09 .edit-row .btn', '수정');
  await A.waitFor(`!!document.querySelector('.editor .inp')`);
  await A.eval(`(() => { const f = [...document.querySelectorAll('.editor .fld')].find(x => x.textContent.startsWith('한 줄 설명')); const i = f.querySelector('input'); i.value = '오프라인에서 고친 설명'; return true; })()`);
  await A.clickText('.sheet-actions .btn', '저장');
  await A.waitFor(`document.querySelector('.sync').textContent.includes('오프라인') || document.querySelector('.sync').textContent.includes('대기')`, 5000, '오프라인 표시');
  await A.shot('12-offline.png');
  await A.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await A.eval(`window.dispatchEvent(new Event('online'))`);
  await A.waitFor(`(async () => (await (await fetch('/__gh/_state')).json()).puts.length >= 4)()`, 15000, '다시 연결 후 업로드');
  const remote2 = await remoteData();
  assert.equal(remote2.days.find(d => d.id === 'd3').tracks[0].stops.find(s => s.id === 'd3-09').desc, '오프라인에서 고친 설명');
  log('오프라인에서 고친 것 → 연결되자 자동 업로드');

  // 예약 오픈 알림 띠: 오늘 열리는 항목을 추가하면 날짜 탭 위에 뜸
  await A.clickText('.tab', '할 일');
  await A.waitFor(`!!document.querySelector('.other-view .add-btn')`, 5000, '항목 추가 버튼');
  await A.click('.other-view .add-btn');
  await A.waitFor(`!!document.querySelector('.editor input[type=date]')`);
  await A.eval(`(() => {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const f = document.querySelector('.editor');
    f.querySelector('input[type=text]').value = '테스트 예약 오픈';
    const d = f.querySelectorAll('input[type=date]'); d[0].value = '2026-12-30'; d[1].value = today;
    return true; })()`);
  await A.clickText('.sheet-actions .btn', '저장');
  await A.clickText('.tab', 'Day 2');
  await A.waitFor(`document.querySelector('.alert-banner.hot') && document.querySelector('.alert-banner').textContent.includes('테스트 예약 오픈')`, 5000, '알림 띠');
  await A.shot('12b-alert.png');
  await A.click('.alert-x');
  await A.waitFor(`!document.querySelector('.alert-banner')`, 3000, '알림 닫기');
  log('예약 오픈일 알림 띠 표시 · 오늘 그만 보기');
  await A.clickText('.tab', 'Day 3');

  // 수동 업데이트 모드: B는 A의 수정을 버튼 누를 때만 받음
  await B.eval(`(() => { const p = JSON.parse(localStorage.getItem('tp.prefs') || '{}'); p.sync = 'manual'; localStorage.setItem('tp.prefs', JSON.stringify(p)); })()`);
  await B.send('Page.reload', {});
  await B.waitFor(`!!document.querySelector('.off-banner.manual')`, 15000, '수동 모드 띠');
  await B.clickText('.tab', 'Day 3');
  const before = await B.eval(`document.querySelector('#stop-d3-02 .desc').textContent`);
  await A.clickText('#stop-d3-02 .edit-row .btn', '수정');
  await A.waitFor(`!!document.querySelector('.editor .inp')`);
  await A.eval(`(() => { const f = [...document.querySelectorAll('.editor .fld')].find(x => x.textContent.startsWith('한 줄 설명')); f.querySelector('input').value = '수동모드 시험'; return true; })()`);
  await A.clickText('.sheet-actions .btn', '저장');
  await A.waitFor(`(async () => (await (await fetch('/__gh/_state')).json()).puts.length >= 5)()`, 15000, 'A 저장');
  await B.eval(`document.dispatchEvent(new Event('visibilitychange'))`);
  await B.idle(1500);
  assert.equal(await B.eval(`document.querySelector('#stop-d3-02 .desc').textContent`), before, '수동 모드인데 자동으로 바뀜');
  await B.clickText('.off-banner .btn', '업데이트 받기');
  await B.waitFor(`document.querySelector('#stop-d3-02 .desc').textContent === '수동모드 시험'`, 10000, '버튼 눌러 받기');
  await B.shot('13-manual.png');
  log('수동 모드: 자동으로 안 바뀌고 [업데이트 받기] 누르면 받음');

  // 서버가 죽은 상태 + 폰에 저장본도 없음 → 앱에 들어있는 일정으로 표시 (사용자 제보 상황)
  await fetch(`http://localhost:${PORT}/__gh/_fail?on=1`, { method: 'POST' });
  const C2 = await newPage(cdp, 'C');
  await unlock(C2, P2);
  await C2.waitFor(`!!document.querySelector('.off-banner')`, 15000, '오프라인 띠');
  assert.ok((await C2.eval(`document.querySelectorAll('.stop').length`)) > 0);
  await C2.shot('14-server-down.png');
  await fetch(`http://localhost:${PORT}/__gh/_fail?on=0`, { method: 'POST' });
  await C2.clickText('.off-banner .link-btn', '다시 시도');
  await C2.waitFor(`!document.querySelector('.off-banner')`, 10000, '다시 연결되면 띠 사라짐');
  log('저장소 연결 실패해도 앱에 든 일정으로 바로 표시 → 다시 시도하면 최신으로');

  // 새로고침해도 비밀번호 다시 안 물어봄 (기기 기억)
  await A.send('Page.reload', {});
  await A.waitFor(`!!document.querySelector('.day-head .dh-title')`, 15000, '재시작 후 바로 열림');
  log('새로고침 → 비밀번호 없이 바로 열림 (기기 기억)');

  // 일부러 만든 저장 충돌(409)과 오프라인 시험 중 네트워크 오류는 정상
  const errs = [...A.errors, ...B.errors, ...C2.errors].filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR|409 \(Conflict\)|sync\]/.test(e));
  if (errs.length) {
    console.log('\n  브라우저 오류:');
    for (const e of errs) console.log(`   - ${e}`);
    throw new Error('브라우저 오류 발생');
  }
  console.log(`\n  ✔ 전부 통과 · 스크린샷: ${OUT}`);
}

main().then(() => { cleanup(); process.exit(0); }).catch(e => {
  console.error(`\n  ✖ ${e.stack || e}`);
  cleanup();
  process.exit(1);
});
