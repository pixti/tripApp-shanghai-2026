// 시작: 잠금 해제 → 일정 불러오기 → 화면
import { Store } from './store.js';
import { App } from './ui.js';
import { $, h, clear } from './util.js';
import { toast } from './sheets.js';

const store = new Store();
let app = null;

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (store.cfg.sw === false) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    return;
  }
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => toast('새 버전이 있다', { action: { label: '업데이트', fn: () => w.postMessage('skipWaiting') }, ms: 0 });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(e => console.warn('SW', e));
  // 처음 설치될 때는 새로고침하지 않음 (비밀번호 입력 중에 지워지지 않게) — 업데이트일 때만
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function showLock() {
  const lock = $('#lock');
  const appEl = $('#app');
  appEl.hidden = true;
  lock.hidden = false;
  clear(lock);
  const input = h('input', {
    class: 'inp lock-inp',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '여행 비밀번호',
    'aria-label': '여행 비밀번호',
  });
  const remember = h('input', { type: 'checkbox', checked: true });
  const err = h('p', { class: 'lock-err', role: 'alert' });
  const btn = h('button', { class: 'btn primary lock-btn', type: 'submit' }, '열기');
  const form = h('form', {
    class: 'lock-form',
    onsubmit: async e => {
      e.preventDefault();
      if (!input.value.trim()) return;
      btn.disabled = true;
      btn.textContent = '확인 중…';
      err.textContent = '';
      try {
        await store.unlock(input.value, remember.checked);
        lock.hidden = true;
        start();
      } catch (ex) {
        err.textContent = ex.message === 'WRONG_PASS' ? '비밀번호가 다르다' : `열지 못했다: ${ex.message}`;
        btn.disabled = false;
        btn.textContent = '열기';
        input.select();
      }
    },
  },
  h('div', { class: 'lock-icon' }, '🗺️'),
  h('h1', null, store.cfg.title || '여행 플래너'),
  h('p', { class: 'muted' }, '같이 가는 사람끼리 정한 여행 비밀번호를 입력할 것.'),
  input,
  h('label', { class: 'chk' }, remember, ' 이 기기에서 기억하기'),
  btn,
  err);
  lock.append(form);
  setTimeout(() => input.focus(), 100);
}

async function start() {
  const appEl = $('#app');
  appEl.hidden = false;
  if (!app) {
    app = new App(store);
    app.mount();
  }
  // 1) 폰에 저장된 일정 → 2) 앱에 들어있는 저장본 → 화면부터 보여주고, 3) 온라인이면 최신 받기
  if (!(await store.loadCached())) await store.loadBundled();
  app.render();
  const people = (store.data && store.data.trip && store.data.trip.people) || [];
  if (store.data && (!store.me || (people.length && !people.includes(store.me)))) app.askName();
  if (!store.manual || !store.data) await store.refresh();
  app.render();
  const ppl = (store.data && store.data.trip && store.data.trip.people) || [];
  if (store.data && (!store.me || (ppl.length && !ppl.includes(store.me))) && !document.querySelector('.sheet-wrap')) app.askName();
  store.startPolling();
  if (store.pending.length) store.flush();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

async function boot() {
  registerSW();
  if (!window.L) {
    document.body.append(h('p', { style: { padding: '20px' } }, '지도 라이브러리를 불러오지 못했다. 새로고침할 것.'));
  }
  if (await store.tryRestoreKey()) start();
  else showLock();
}

boot();
