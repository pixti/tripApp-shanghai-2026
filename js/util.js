// 공통 도우미
export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' && ('value' in el)) el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  appendKids(el, kids);
  return el;
}

export function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === undefined || k === null || k === false || k === '') continue;
    el.append(k instanceof Node ? k : String(k));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function parseYMD(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function dayDiff(a, b) {
  return Math.round((parseYMD(b) - parseYMD(a)) / 86400000);
}

export function addDays(ymd, n) {
  return new Date(parseYMD(ymd) + n * 86400000).toISOString().slice(0, 10);
}

// 중국 시간(UTC+8) 기준 오늘 날짜
export function chinaToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function mdLabel(ymd) {
  if (!ymd) return '';
  const d = new Date(parseYMD(ymd));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEK[d.getUTCDay()]})`;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function uid(prefix = 's') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 아래 방법으로 */ }
  const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function won(n) {
  return Math.round(n).toLocaleString('ko-KR');
}
