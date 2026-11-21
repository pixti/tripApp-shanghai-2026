// 편집 화면들 (장소 / 날짜 메모 / 정보 섹션 / 예약 항목)
import { h, uid } from './util.js';
import { openSheet, toast, confirmSheet } from './sheets.js';
import { PickerMap } from './map.js';
import { parseCoords, hasPos } from './amap.js';
import { MAP } from './providers.js';
import { CAT, MOVE } from './consts.js';

function field(label, input, hint) {
  return h('label', { class: 'fld' }, h('span', { class: 'fld-label' }, label), input, hint ? h('span', { class: 'fld-hint' }, hint) : null);
}

function text(value, attrs = {}) {
  return h('input', { class: 'inp', type: 'text', value: value || '', ...attrs });
}

function area(value, rows = 3, attrs = {}) {
  const t = h('textarea', { class: 'inp', rows: String(rows), ...attrs });
  t.value = value || '';
  return t;
}

function select(value, options) {
  const s = h('select', { class: 'inp' }, options.map(([v, label]) => h('option', { value: v }, label)));
  s.value = value || options[0][0];
  return s;
}

function sameJSON(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function linksToText(links) {
  return (links || []).map(l => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n');
}

function textToLinks(t) {
  return String(t || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)\s*$/);
    if (m) return { label: m[1] || '링크', url: m[2] };
    const u = line.match(/https?:\/\/\S+/);
    return u ? { label: line.replace(u[0], '').trim() || '링크', url: u[0] } : null;
  }).filter(Boolean);
}

function lines(t) {
  return String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
}

// ── 장소 ─────────────────────────────────────────────────
export function editStop(app, { day, track, stop, after = null }) {
  const isNew = !stop;
  const s = stop || { name: '', zh: '', station: '', addr: '', lat: null, lng: null, cat: 'sight', time: '', desc: '', info: [], tmi: '', links: [], move: { mode: 'subway', text: '' }, skip: false, review: false };
  const f = {
    name: text(s.name, { placeholder: '예: 정안사', required: true }),
    zh: text(s.zh, { placeholder: '예: 静安寺 (지도 검색·택시용)', lang: 'zh-CN' }),
    addr: text(s.addr, { placeholder: '중국어 주소 (선택)', lang: 'zh-CN' }),
    station: text(s.station, { placeholder: '예: 静安寺站', lang: 'zh-CN' }),
    cat: select(s.cat || 'sight', Object.entries(CAT).map(([k, v]) => [k, `${v.icon} ${v.label}`])),
    time: text(s.time, { placeholder: '예: 14:00 / 점심 / 저녁' }),
    desc: text(s.desc, { placeholder: '한 줄 설명' }),
    info: area((s.info || []).join('\n'), 4, { placeholder: '⏰ 09:00–17:00\n🎫 입장료 50위안' }),
    tmi: area(s.tmi, 3),
    links: area(linksToText(s.links), 2, { placeholder: '블로그 | https://…' }),
    moveMode: select((s.move && s.move.mode) || 'none', Object.entries(MOVE).map(([k, v]) => [k, `${v.icon} ${v.label}`])),
    moveText: text(s.move && s.move.text, { placeholder: '예: 약 25분 · 2호선 · 3위안' }),
    lat: h('input', { class: 'inp', type: 'number', step: 'any', inputmode: 'decimal', value: hasPos(s) ? String(s.lat) : '' }),
    lng: h('input', { class: 'inp', type: 'number', step: 'any', inputmode: 'decimal', value: hasPos(s) ? String(s.lng) : '' }),
    paste: text('', { placeholder: '지도 링크(고덕/구글)나 "31.23, 121.47" 붙여넣기' }),
    skip: h('input', { type: 'checkbox', checked: !!s.skip }),
    review: h('input', { type: 'checkbox', checked: !!s.review }),
  };

  const mapEl = h('div', { class: 'picker-map' });
  let picker = null;
  const setPos = (lat, lng) => {
    f.lat.value = lat.toFixed(6);
    f.lng.value = lng.toFixed(6);
  };
  f.paste.addEventListener('input', () => {
    const p = parseCoords(f.paste.value);
    if (!p) return;
    setPos(p.lat, p.lng);
    if (picker) {
      picker.set(p.lat, p.lng, false);
      picker.center(p.lat, p.lng);
    }
    if (p.name && !f.zh.value) f.zh.value = p.name;
    toast('좌표를 넣었어요');
  });
  const syncFromInputs = () => {
    const lat = parseFloat(f.lat.value);
    const lng = parseFloat(f.lng.value);
    if (picker && Number.isFinite(lat) && Number.isFinite(lng)) {
      picker.set(lat, lng, false);
      picker.center(lat, lng);
    }
  };
  f.lat.addEventListener('change', syncFromInputs);
  f.lng.addEventListener('change', syncFromInputs);

  const body = h('form', { class: 'editor', onsubmit: e => { e.preventDefault(); save(); } },
    field('이름 *', f.name),
    field('현지어 이름 (중국어/일본어)', f.zh, '지도 검색창 붙여넣기, 택시 기사에게 보여줄 때 사용'),
    field('가까운 지하철역 (현지어)', f.station, '복사해서 지도 앱에 붙여넣거나 역까지 길찾기용'),
    field('현지어 주소', f.addr),
    h('div', { class: 'grid2' }, field('종류', f.cat), field('시간', f.time)),
    field('한 줄 설명', f.desc),
    h('fieldset', { class: 'fs-box' },
      h('legend', null, '📍 위치 (지도를 눌러서 고르기)'),
      mapEl,
      h('div', { class: 'grid2' }, field('위도', f.lat), field('경도', f.lng)),
      field('붙여넣기', f.paste),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: useMyLocation }, '◎ 지금 내 위치로'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { f.lat.value = ''; f.lng.value = ''; } }, '위치 지우기'))),
    h('fieldset', { class: 'fs-box' },
      h('legend', null, '🚇 이전 장소에서 오는 방법'),
      h('div', { class: 'grid2' }, field('수단', f.moveMode), field('설명', f.moveText))),
    field('정보 (한 줄에 하나)', f.info),
    field('TMI / 메모', f.tmi),
    field('링크 (한 줄에 하나: 이름 | 주소)', f.links),
    h('label', { class: 'chk' }, f.skip, ' 이번엔 건너뛰기 (지도·순서에서 빠짐)'),
    h('label', { class: 'chk' }, f.review, ' "검토 필요" 표시'),
  );

  function useMyLocation() {
    if (!navigator.geolocation) return toast('위치를 쓸 수 없어요');
    toast('위치 찾는 중…');
    navigator.geolocation.getCurrentPosition(p => {
      const [lat, lng] = MAP.fromGps(p.coords.latitude, p.coords.longitude);
      setPos(lat, lng);
      if (picker) {
        picker.set(lat, lng, false);
        picker.center(lat, lng);
      }
      toast('지금 위치를 넣었어요');
    }, () => toast('위치를 찾지 못했어요'), { enableHighAccuracy: true, timeout: 15000 });
  }

  function collect() {
    const lat = parseFloat(f.lat.value);
    const lng = parseFloat(f.lng.value);
    const mode = f.moveMode.value;
    return {
      name: f.name.value.trim(),
      zh: f.zh.value.trim(),
      addr: f.addr.value.trim(),
      station: f.station.value.trim(),
      cat: f.cat.value,
      time: f.time.value.trim(),
      desc: f.desc.value.trim(),
      info: lines(f.info.value),
      tmi: f.tmi.value.trim(),
      links: textToLinks(f.links.value),
      move: mode === 'none' && !f.moveText.value.trim() ? null : { mode, text: f.moveText.value.trim() },
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      skip: f.skip.checked,
      review: f.review.checked,
    };
  }

  function save() {
    const v = collect();
    if (!v.name) {
      toast('이름을 넣어 주세요');
      f.name.focus();
      return;
    }
    if ((v.lat === null) !== (v.lng === null)) {
      toast('위도와 경도를 둘 다 넣거나 둘 다 비워 주세요');
      return;
    }
    if (isNew) {
      app.store.commit({ type: 'stop.add', day: day.id, track: track.id, after, stop: { id: uid('s'), ...v } });
      toast('추가했어요');
    } else {
      const patch = {};
      for (const [k, val] of Object.entries(v)) if (!sameJSON(val, stop[k])) patch[k] = val;
      if (!Object.keys(patch).length) {
        sheet.close();
        return;
      }
      app.store.commit({ type: 'stop.update', day: day.id, track: track.id, stopId: stop.id, patch });
      toast('저장했어요');
    }
    sheet.close();
  }

  const actions = [
    h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '취소'),
    h('button', { class: 'btn primary', type: 'button', onclick: save }, isNew ? '추가' : '저장'),
  ];
  if (!isNew) actions.unshift(h('button', { class: 'btn danger', type: 'button', onclick: () => { sheet.close(); deleteStop(app, day, track, stop); } }, '삭제'));
  const sheet = openSheet({
    title: isNew ? '장소 추가' : '장소 수정',
    body,
    actions,
    full: true,
    onClose: () => { if (picker) picker.destroy(); },
  });
  const context = (track.stops || []).filter(x => hasPos(x) && (!stop || x.id !== stop.id)).map(x => ({ lat: x.lat, lng: x.lng }));
  setTimeout(() => {
    picker = new PickerMap(mapEl, {
      lat: hasPos(s) ? s.lat : undefined,
      lng: hasPos(s) ? s.lng : undefined,
      lang: app.store.prefs.lang,
      context,
      onPick: (lat, lng) => setPos(lat, lng),
    });
  }, 260);
}

export function moveStop(app, day, track, stop, dir) {
  const stops = track.stops;
  const i = stops.findIndex(x => x.id === stop.id);
  if (i < 0) return;
  let after;
  if (dir < 0) {
    if (i === 0) return;
    after = i >= 2 ? stops[i - 2].id : null;
  } else {
    if (i === stops.length - 1) return;
    after = stops[i + 1].id;
  }
  app.store.commit({ type: 'stop.move', day: day.id, track: track.id, stopId: stop.id, after });
}

export async function deleteStop(app, day, track, stop) {
  if (!(await confirmSheet(`'${stop.name}'을(를) 일정에서 지울까요?\n(잠깐 빼는 거면 "건너뛰기"를 쓰세요)`, { ok: '지우기', danger: true }))) return;
  app.store.commit({ type: 'stop.delete', day: day.id, track: track.id, stopId: stop.id, name: stop.name });
  toast('지웠어요');
}

// ── 날짜 제목/메모 ───────────────────────────────────────
export function editDay(app, day, track) {
  const multi = (day.tracks || []).length > 1;
  const f = {
    title: text(day.title),
    note: area(day.note, 5),
    tlabel: multi && track ? text(track.label) : null,
    tnote: track ? area(track.note, 4) : null,
  };
  const body = h('div', { class: 'editor' },
    field('제목', f.title),
    field('날짜 메모', f.note, '## 소제목, - 목록, **굵게** 사용 가능'),
    multi && track ? h('fieldset', { class: 'fs-box' }, h('legend', null, `개별 일정: ${track.label}`),
      field('이름', f.tlabel), field('메모', f.tnote)) : null,
    !multi && track ? field('일정 메모 (지도 위에 표시)', f.tnote) : null,
  );
  const save = () => {
    const ops = [];
    const dp = {};
    if (f.title.value.trim() !== (day.title || '')) dp.title = f.title.value.trim();
    if (f.note.value.trim() !== (day.note || '')) dp.note = f.note.value.trim();
    if (Object.keys(dp).length) ops.push({ type: 'day.update', day: day.id, patch: dp });
    if (track) {
      const tp = {};
      if (f.tlabel && f.tlabel.value.trim() !== (track.label || '')) tp.label = f.tlabel.value.trim();
      if (f.tnote && f.tnote.value.trim() !== (track.note || '')) tp.note = f.tnote.value.trim();
      if (Object.keys(tp).length) ops.push({ type: 'track.update', day: day.id, track: track.id, patch: tp });
    }
    if (ops.length) {
      app.store.commit(ops);
      toast('저장했어요');
    }
    sheet.close();
  };
  const sheet = openSheet({
    title: '날짜 정보 수정',
    body,
    full: true,
    actions: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '취소'), h('button', { class: 'btn primary', type: 'button', onclick: save }, '저장')],
  });
}

// ── 정보 섹션 ────────────────────────────────────────────
export function editInfo(app, sec) {
  const isNew = !sec;
  const f = {
    icon: text(sec ? sec.icon : '📌', { class: 'inp short' }),
    title: text(sec ? sec.title : ''),
    body: area(sec ? sec.body : '', 14),
  };
  const body = h('div', { class: 'editor' },
    h('div', { class: 'grid2 icon-title' }, field('아이콘', f.icon), field('제목', f.title)),
    field('내용', f.body),
    h('div', { class: 'help' },
      h('b', null, '서식: '), '## 소제목 · - 목록 · **굵게** · [이름](https://주소) · ',
      h('code', null, '{zh:中文}'), ' 중국어 보여주기 · ', h('code', null, '{tel:+8621…|표시}'), ' 전화 · ', h('code', null, '{copy:텍스트}'), ' 복사 버튼'),
  );
  const save = () => {
    const v = { icon: f.icon.value.trim() || '📌', title: f.title.value.trim(), body: f.body.value.replace(/\s+$/, '') };
    if (!v.title) return toast('제목을 넣어 주세요');
    if (isNew) app.store.commit({ type: 'info.add', section: { id: uid('i'), ...v } });
    else {
      const patch = {};
      for (const k of Object.keys(v)) if (v[k] !== sec[k]) patch[k] = v[k];
      if (Object.keys(patch).length) app.store.commit({ type: 'info.update', id: sec.id, patch });
    }
    toast('저장했어요');
    sheet.close();
  };
  const sheet = openSheet({
    title: isNew ? '정보 추가' : '정보 수정',
    body,
    full: true,
    actions: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '취소'), h('button', { class: 'btn primary', type: 'button', onclick: save }, '저장')],
  });
}

// ── 예약 항목 ────────────────────────────────────────────
export function editCheck(app, item) {
  const isNew = !item;
  const c = item || { title: '', date: '', opens: '', who: '', onsite: false, note: '', link: '' };
  const people = (app.data && app.data.trip && app.data.trip.people) || ['나', '친구'];
  const f = {
    title: text(c.title, { placeholder: '예: 예원 입장권 (12/23)' }),
    date: h('input', { class: 'inp', type: 'date', value: c.date || '' }),
    opens: h('input', { class: 'inp', type: 'date', value: c.opens || '' }),
    who: select(c.who || '', [['', '—'], ...people.map(p => [p, p]), ['둘 다', '둘 다']]),
    onsite: h('input', { type: 'checkbox', checked: !!c.onsite }),
    note: area(c.note, 3),
    link: text(c.link, { placeholder: 'https://…' }),
  };
  const body = h('div', { class: 'editor' },
    field('할 일', f.title),
    h('div', { class: 'grid2' }, field('가는 날', f.date), field('예약 열리는 날', f.opens)),
    field('담당', f.who),
    h('label', { class: 'chk' }, f.onsite, ' 현장 구매/무료 (예약 필요 없음)'),
    field('메모', f.note),
    field('링크', f.link),
  );
  const save = () => {
    const v = { title: f.title.value.trim(), date: f.date.value, opens: f.opens.value, who: f.who.value, onsite: f.onsite.checked, note: f.note.value.trim(), link: f.link.value.trim() };
    if (!v.title) return toast('할 일을 넣어 주세요');
    if (isNew) app.store.commit({ type: 'check.add', item: { id: uid('c'), done: false, ...v } });
    else {
      const patch = {};
      for (const k of Object.keys(v)) if (!sameJSON(v[k], c[k])) patch[k] = v[k];
      if (Object.keys(patch).length) app.store.commit({ type: 'check.update', id: c.id, patch });
    }
    toast('저장했어요');
    sheet.close();
  };
  const actions = [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '취소'), h('button', { class: 'btn primary', type: 'button', onclick: save }, '저장')];
  if (!isNew) {
    actions.unshift(h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        sheet.close();
        if (await confirmSheet(`'${c.title}' 항목을 지울까요?`, { ok: '지우기', danger: true })) app.store.commit({ type: 'check.delete', id: c.id });
      },
    }, '삭제'));
  }
  const sheet = openSheet({ title: isNew ? '항목 추가' : '항목 수정', body, full: true, actions });
}
