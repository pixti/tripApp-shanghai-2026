// 아래에서 올라오는 창(시트), 알림(토스트), 중국어 크게 보여주기
// 안드로이드 뒤로가기 버튼으로 맨 위 창이 닫히도록 history를 사용
import { h, clear } from './util.js';

const stack = [];
let ignorePop = 0;

window.addEventListener('popstate', () => {
  if (ignorePop > 0) {
    ignorePop--;
    return;
  }
  const top = stack.pop();
  if (top) top.destroy();
});

export function openLayer(el, { onClose } = {}) {
  const layer = {
    el,
    destroy() {
      el.classList.remove('open');
      setTimeout(() => el.remove(), 220);
      if (onClose) onClose();
    },
    close() {
      const i = stack.indexOf(layer);
      if (i === -1) return;
      stack.splice(i, 1);
      layer.destroy();
      ignorePop++;
      history.back();
    },
  };
  stack.push(layer);
  history.pushState({ layer: stack.length }, '');
  return layer;
}

export function openSheet({ title, body, actions, full = false, className = '', onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const head = h('div', { class: 'sheet-head' },
    h('div', { class: 'sheet-title' }, title || ''),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => layer.close() }, '✕'));
  const bodyEl = h('div', { class: 'sheet-body' }, body);
  const actEl = actions ? h('div', { class: 'sheet-actions' }, actions) : null;
  const panel = h('div', { class: `sheet ${full ? 'full' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' }, head, bodyEl, actEl);
  const wrap = h('div', { class: 'sheet-wrap' },
    h('div', { class: 'sheet-backdrop', onclick: () => layer.close() }),
    panel);
  root.append(wrap);
  const layer = openLayer(wrap, { onClose });
  requestAnimationFrame(() => wrap.classList.add('open'));
  layer.panel = panel;
  layer.body = bodyEl;
  layer.setActions = nodes => {
    if (!actEl) return;
    clear(actEl).append(...[].concat(nodes));
  };
  return layer;
}

export function confirmSheet(message, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const s = openSheet({
      title: '확인',
      body: h('p', { class: 'confirm-msg' }, message),
      actions: [
        h('button', { class: 'btn', type: 'button', onclick: () => { answered = true; s.close(); resolve(false); } }, cancel),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { answered = true; s.close(); resolve(true); } }, ok),
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

let toastTimer = null;
export function toast(msg, { action, ms = 2600 } = {}) {
  const el = document.getElementById('toast');
  clear(el);
  el.append(h('span', null, msg));
  if (action) {
    el.append(h('button', { class: 'toast-btn', type: 'button', onclick: () => { el.classList.remove('show'); action.fn(); } }, action.label));
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 택시 기사·직원에게 보여줄 큰 중국어 화면
export function showChinese({ zh, addr, ko, title = '중국어 보여주기', phrase = '师傅，请带我去这里。', phraseKo = '(기사님, 여기로 가 주세요)', lang = 'zh-CN', routeLabel = '🧭 길찾기', onCopy, onRoute }) {
  let wakeLock = null;
  if (navigator.wakeLock && navigator.wakeLock.request) {
    navigator.wakeLock.request('screen').then(w => { wakeLock = w; }).catch(() => {});
  }
  const body = h('div', { class: 'zh-show' },
    phrase ? h('div', { class: 'zh-phrase', lang }, phrase, phraseKo ? h('small', null, phraseKo) : null) : null,
    h('div', { class: 'zh-big', lang }, zh),
    addr ? h('div', { class: 'zh-addr', lang }, addr) : null,
    ko ? h('div', { class: 'zh-ko' }, ko) : null);
  const actions = [
    h('button', { class: 'btn', type: 'button', onclick: () => onCopy && onCopy([zh, addr].filter(Boolean).join(' ')) }, '📋 복사'),
  ];
  if (onRoute) actions.push(h('a', { class: 'btn primary', href: onRoute.href, target: onRoute.target || '_self', rel: 'noopener' }, routeLabel));
  return openSheet({
    title,
    body,
    full: true,
    className: 'zh-sheet',
    actions,
    onClose: () => { if (wakeLock) wakeLock.release().catch(() => {}); },
  });
}
