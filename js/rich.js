// 메모용 간단 서식
//  ## 소제목 / - 목록 / **굵게** / [이름](https://…) / 맨 주소 자동 링크
//  {zh:中文} → 중국어 보여주기·복사 버튼, {tel:+86…|표시} → 전화 걸기, {copy:텍스트} → 복사 버튼
import { h } from './util.js';

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\{(zh|tel|copy):([^}]+)\}|(https?:\/\/[^\s<>()]+[^\s<>().,!?'"])/g;

export function renderRich(src, ctx = {}) {
  const frag = document.createDocumentFragment();
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let ul = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const li = line.match(/^\s*[-•]\s+(.*)$/);
    if (li) {
      if (!ul) {
        ul = h('ul', { class: 'rt-ul' });
        frag.append(ul);
      }
      ul.append(h('li', null, inline(li[1], ctx)));
      continue;
    }
    ul = null;
    if (!line.trim()) {
      frag.append(h('div', { class: 'rt-gap' }));
      continue;
    }
    const hd = line.match(/^#{2,3}\s+(.*)$/);
    if (hd) {
      frag.append(h('h4', { class: 'rt-h' }, inline(hd[1], ctx)));
      continue;
    }
    frag.append(h('p', { class: 'rt-p' }, inline(line, ctx)));
  }
  return frag;
}

export function inline(text, ctx = {}) {
  const out = [];
  let last = 0;
  let m;
  const re = new RegExp(INLINE.source, 'g'); // 호출마다 따로 (굵은 글씨 안을 다시 처리할 때 위치가 섞이지 않게)
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) {
      out.push(h('b', null, inline(m[1], ctx))); // 굵은 글씨 안의 {zh:…} 등도 처리
    } else if (m[2] != null) {
      out.push(h('a', { href: m[3], target: '_blank', rel: 'noopener' }, m[2]));
    } else if (m[4]) {
      const val = m[5].trim();
      if (m[4] === 'tel') {
        const [num, label] = val.split('|');
        out.push(h('a', { class: 'rt-tel', href: 'tel:' + num.replace(/[^+\d]/g, '') }, '📞 ', (label || num).trim()));
      } else if (m[4] === 'zh') {
        // 누르면 복사, ⤢ 누르면 크게 보여주기
        out.push(h('span', { class: 'zh-chip' },
          h('button', { class: 'zh-chip-text', type: 'button', lang: 'zh-CN', title: '복사', onclick: () => ctx.onCopy && ctx.onCopy(val) }, val),
          h('button', { class: 'zh-chip-big', type: 'button', 'aria-label': '크게 보기', onclick: () => ctx.onZh && ctx.onZh(val) }, '⤢')));
      } else {
        out.push(h('span', { class: 'rt-copy' }, val,
          h('button', { class: 'mini', type: 'button', onclick: () => ctx.onCopy && ctx.onCopy(val) }, '복사')));
      }
    } else if (m[6]) {
      out.push(h('a', { href: m[6], target: '_blank', rel: 'noopener' }, shortUrl(m[6])));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function shortUrl(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^(www|m)\./, '');
    return x.pathname.length > 1 ? `${host}/…` : host;
  } catch {
    return u;
  }
}
