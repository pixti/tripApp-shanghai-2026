// 화면 그리기
import { h, clear, $, mdLabel, chinaToday, dayDiff, timeAgo, copyText, won, appendKids } from './util.js';
import { renderRich, inline } from './rich.js';
import { TripMap } from './map.js';
import * as A from './providers.js';
import { MAP, setProvider } from './providers.js';
import { openSheet, toast, showChinese, confirmSheet, openLayer } from './sheets.js';
import { tilesForTrip, prefetchTiles, countCachedTiles } from './tiles.js';
import * as E from './editor.js';
import { CAT, MOVE } from './consts.js';
import { distM } from './gcj.js';
import { GUIDE_ASOF, TRAIN_STEPS, STATIONS, SECTIONS, AI_TARGETS, findStation, buildPrompt, photoUrl, STATION_PHOTOS } from './guide.js';
import { SITES, findSite, siteMapSvg } from './sites.js';
import { PHOTOS, findPhoto, photoPath } from './photos.js';

const SYNC_TEXT = {
  idle: ['●', '대기', 's-idle'],
  ok: ['●', '온라인', 's-ok'],
  syncing: ['↻', '동기화', 's-sync'],
  pending: ['●', '저장 대기', 's-pending'],
  offline: ['●', '오프라인', 's-off'],
  error: ['●', '연결 오류', 's-err'],
  auth: ['●', '권한 오류', 's-err'],
};

// 날짜 탭 뒤에 붙는 탭 (옆으로 밀기 순서)
const OTHER_TABS = ['book', 'check', 'guide', 'info'];

// 예약·발권 항목 판별 (체크리스트 중 kind: 'book')
const isBook = c => c.kind === 'book';
const bookTodo = c => isBook(c) && !c.done && !c.onsite && c.need !== '현장' && c.need !== '선택';

function shortName(s) {
  return String((s && s.name) || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

export class App {
  constructor(store) {
    this.store = store;
    this.tab = sessionStorage.getItem('tp.tab') || null;
    try { this.trackSel = JSON.parse(sessionStorage.getItem('tp.track') || '{}'); } catch { this.trackSel = {}; }
    this.map = null;
    this.mapSig = '';
    this.cardEls = new Map();
  }

  get data() {
    return this.store.data;
  }

  get editing() {
    return this.store.canEdit && !!this.store.prefs.edit;
  }

  // 고덕: 안드로이드에서만 앱 바로 열기(intent), 아이폰·PC는 웹 링크 (앱 있으면 웹에서 앱으로 넘어감)
  linkOpts() {
    const app = this.store.prefs.linkMode !== 'web' && A.IS_ANDROID;
    return { linkMode: app ? 'app' : 'web', desktop: !A.IS_MOBILE };
  }

  // ── 뼈대 ──────────────────────────────────────────────
  mount() {
    const root = $('#app');
    clear(root);
    this.el = {
      header: h('header', { class: 'top' }),
      tabs: h('nav', { class: 'tabs', 'aria-label': '날짜' }),
      dayView: h('section', { class: 'view day-view' }),
      dayHead: h('div', { class: 'card day-head' }),
      tracks: h('div', { class: 'tracks' }),
      mapCard: h('div', { class: 'card map-card' }),
      mapBox: h('div', { class: 'map-box' }),
      mapTools: h('div', { class: 'map-tools' }),
      list: h('div', { class: 'stops' }),
      otherView: h('section', { class: 'view other-view' }),
      nextBar: h('div', { class: 'next-bar' }),
      loading: h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, '일정 불러오는 중…')),
    };
    const mapEl = h('div', { class: 'map', id: 'map' });
    this.el.mapBox.append(mapEl, h('button', { class: 'fs-close', type: 'button', onclick: () => this.toggleFullscreen(false) }, '✕ 닫기'));
    this.el.mapCard.append(this.el.mapBox, this.el.mapTools,
      h('p', { class: 'map-note' }, '핀 번호는 일정 순서예요. 점선은 순서만 이은 것이고 실제 경로가 아니에요 — 경로는 구간마다 있는 [경로]나 [길찾기]로 보세요.'));
    this.el.dayView.append(this.el.dayHead, this.el.tracks, this.el.mapCard, this.el.list);
    root.append(h('div', { class: 'sticky' }, this.el.header, this.el.tabs),
      this.el.scroller = h('div', { class: 'scroller' }, h('main', { class: 'main' }, this.el.loading, this.el.dayView, this.el.otherView)),
      this.el.nextBar);
    this.mapEl = mapEl;

    this.store.addEventListener('change', () => this.render());
    this.setupSwipe();
    this.store.addEventListener('status', () => this.renderHeader());
    this.store.addEventListener('rejected', e => {
      toast(`상대방이 먼저 바꾼 부분과 겹쳐서 ${e.detail.length}건은 적용 못 했어요`, { ms: 5000 });
    });
    setInterval(() => this.renderHeader(), 60000);
  }

  // 본문을 옆으로 밀면 이전/다음 날짜 (지도·입력칸·가로 스크롤 영역 제외)
  setupSwipe() {
    const main = this.el.dayView.parentElement;
    let sx = 0, sy = 0, ok = false;
    main.addEventListener('touchstart', e => {
      const t = e.touches[0];
      ok = e.touches.length === 1 && !e.target.closest('.map-card, input, textarea, select, .sheet-wrap, .seg, .links');
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    main.addEventListener('touchend', e => {
      if (!ok || !this.data) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const ids = [...(this.data.days || []).map(d => d.id), ...OTHER_TABS];
      const i = ids.indexOf(this.tab);
      const j = i + (dx < 0 ? 1 : -1);
      if (i >= 0 && j >= 0 && j < ids.length) this.setTab(ids[j]);
    }, { passive: true });
  }

  // ── 전체 ──────────────────────────────────────────────
  render() {
    this.renderHeader();
    if (!this.data) {
      this.el.loading.hidden = false;
      this.el.dayView.hidden = true;
      this.el.otherView.hidden = true;
      this.el.nextBar.hidden = true;
      this.el.tabs.hidden = true;
      if (this.store.status === 'error' || this.store.status === 'offline' || this.store.status === 'auth') {
        clear(this.el.loading).append(
          h('p', null, this.store.status === 'offline' ? '인터넷 연결이 필요해요 (처음 한 번)' : '일정을 불러오지 못했어요'),
          h('p', { class: 'muted' }, String((this.store.error && this.store.error.message) || '')),
          h('button', { class: 'btn primary', type: 'button', onclick: () => this.store.refresh({ force: true }) }, '다시 시도'));
      }
      return;
    }
    this.el.loading.hidden = true;
    this.el.tabs.hidden = false;
    const want = (this.data.trip && this.data.trip.map) || 'amap';
    if (MAP.id !== want) {
      setProvider(want);
      if (this.map) this.map.resetTiles();
    }
    const days = this.data.days || [];
    if (!this.tab || (!OTHER_TABS.includes(this.tab) && !days.some(d => d.id === this.tab))) {
      this.tab = this.defaultTab();
    }
    this.renderTabs();
    const day = days.find(d => d.id === this.tab);
    if (day) {
      this.el.dayView.hidden = false;
      this.el.otherView.hidden = true;
      this.renderDay(day);
    } else {
      this.el.dayView.hidden = true;
      this.el.otherView.hidden = false;
      this.el.nextBar.hidden = true;
      if (this.tab === 'info') this.renderInfo();
      else if (this.tab === 'guide') this.renderGuide();
      else if (this.tab === 'book') this.renderBook();
      else this.renderCheck();
    }
  }

  defaultTab() {
    const days = this.data.days || [];
    const today = chinaToday();
    const hit = days.find(d => d.date === today);
    if (hit) return hit.id;
    if (days.length && today > days[days.length - 1].date) return days[days.length - 1].id;
    return days[0] ? days[0].id : 'info';
  }

  setTab(id) {
    if (this.tab === id) return;
    this.tab = id;
    this.renderHeader();
    sessionStorage.setItem('tp.tab', id);
    this.render();
    this.el.scroller.scrollTop = 0;
  }

  // ── 머리 ──────────────────────────────────────────────
  renderHeader() {
    const hd = this.el.header;
    clear(hd);
    const trip = (this.data && this.data.trip) || {};
    const days = (this.data && this.data.days) || [];
    let dday = '';
    if (days.length) {
      const today = chinaToday();
      const first = days[0].date;
      const last = days[days.length - 1].date;
      if (today < first) dday = `D-${dayDiff(today, first)}`;
      else if (today > last) dday = '여행 끝';
      else dday = `여행 중 · Day ${dayDiff(first, today) + 1}`;
    }
    const st = SYNC_TEXT[this.store.status] || SYNC_TEXT.idle;
    const pendingN = this.store.pending.length;
    hd.append(
      h('div', { class: 'top-row' },
        h('h1', { class: 'title' }, trip.title || '여행', trip.subtitle ? h('span', { class: 'sub' }, ' ', trip.subtitle) : null),
        dday ? h('span', { class: 'dday' }, dday) : null,
        h('button', {
          class: `sync ${st[2]}`,
          type: 'button',
          title: this.store.lastSync ? `마지막 동기화 ${timeAgo(this.store.lastSync)}` : '',
          onclick: () => this.onSyncClick(),
        }, h('i', null, st[0]), ' ', st[1], pendingN ? ` ${pendingN}` : ''),
        this.store.canEdit ? h('button', {
          class: `icon-btn edit-toggle ${this.editing ? 'on' : ''}`,
          type: 'button',
          'aria-pressed': this.editing ? 'true' : 'false',
          title: '편집 모드',
          onclick: () => {
            this.store.setPref('edit', !this.store.prefs.edit);
            toast(this.store.prefs.edit ? '편집 모드 켬 — 카드마다 수정 버튼이 생겨요' : '편집 모드 끔');
          },
        }, '✏️') : null,
        h('button', { class: 'icon-btn', type: 'button', title: '설정', onclick: () => this.openSettings() }, '⚙️')),
    );
    if (this.editing) hd.append(h('div', { class: 'edit-banner' }, '✏️ 편집 모드 — 고친 내용은 바로 같이 쓰는 사람에게도 반영돼요'));
    const s = this.store;
    const alert = this.bookingAlert();
    if (alert) hd.append(alert);
    const when = s.lastSync ? `마지막 업데이트 ${timeAgo(s.lastSync)}` : '앱에 들어있던 일정';
    if (this.data && (s.status === 'offline' || s.status === 'error')) {
      hd.append(h('div', { class: 'off-banner' },
        h('span', null, `📴 ${s.status === 'offline' ? '오프라인' : '연결 안 됨'} · 저장된 일정 보는 중 (${when})`),
        h('button', { class: 'link-btn', type: 'button', onclick: () => this.onSyncClick() }, '다시 시도')));
    } else if (this.data && s.manual) {
      hd.append(h('div', { class: 'off-banner manual' },
        h('span', null, `🔒 수동 업데이트 · ${when}`),
        h('button', { class: 'btn sm', type: 'button', onclick: () => this.onSyncClick() }, '↻ 업데이트 받기')));
    }
  }

  // 내 예약 중 오늘 열리는 것 / 이미 열렸는데 아직 안 한 것 → 위쪽 알림 띠
  bookingAlert() {
    if (!this.data || this.tab === 'check' || this.tab === 'book') return null;
    const today = chinaToday();
    if (sessionStorage.getItem('tp.alertOff') === today) return null;
    const me = this.store.me;
    const mine = c => !me || !c.who || c.who === '둘 다' || c.who === me;
    const items = (this.data.checklist || []).filter(c => mine(c) && !c.done && !c.onsite && c.opens && c.opens <= today && (!c.date || c.date >= today));
    if (!items.length) return null;
    const todayOpen = items.filter(c => c.opens === today);
    const first = (todayOpen[0] || items[0]).title;
    const more = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
    const text = todayOpen.length ? `🔔 오늘 예약 오픈: ${first}${more}` : `🎟️ 지금 예약 가능: ${first}${more}`;
    return h('div', { class: `alert-banner ${todayOpen.length ? 'hot' : ''}` },
      h('button', { class: 'alert-text', type: 'button', onclick: () => this.setTab(isBook(todayOpen[0] || items[0]) ? 'book' : 'check') }, text),
      h('button', { class: 'alert-x', type: 'button', 'aria-label': '오늘 그만 보기', onclick: () => { sessionStorage.setItem('tp.alertOff', today); this.renderHeader(); } }, '✕'));
  }

  onSyncClick() {
    const s = this.store;
    if (s.status === 'auth') {
      toast('GitHub 토큰 권한/만료 문제예요. 설정 → 동기화 상태를 확인하세요', { ms: 5000 });
      return;
    }
    if (navigator.onLine === false) {
      toast('지금은 오프라인이에요 — 저장된 일정을 그대로 보여드려요');
      return;
    }
    toast('최신 일정 받는 중…');
    s.refresh({ force: true }).then(() => {
      if (s.pending.length) s.flush();
      if (s.status === 'ok' || s.status === 'pending') toast('최신 일정으로 업데이트했어요');
      else toast('연결이 안 돼서 저장된 일정을 계속 보여드려요', { ms: 3500 });
    });
  }

  // ── 탭 ────────────────────────────────────────────────
  renderTabs() {
    const nav = this.el.tabs;
    clear(nav);
    const today = chinaToday();
    (this.data.days || []).forEach((d, i) => {
      const multi = (d.tracks || []).length > 1;
      const btn = h('button', {
        class: `tab ${this.tab === d.id ? 'active' : ''} ${d.date === today ? 'today' : ''}`,
        type: 'button',
        onclick: () => this.setTab(d.id),
      },
      h('b', null, `Day ${i + 1}`, multi ? h('em', { class: 'tag' }, '개별') : null),
      h('small', null, `${mdLabel(d.date)} ${d.title || ''}`));
      nav.append(btn);
    });
    const me = this.store.me;
    const todo = (this.data.checklist || []).filter(c => !isBook(c) && !c.done && !c.onsite && (!me || !c.who || c.who === '둘 다' || c.who === me)).length;
    const bookN = (this.data.checklist || []).filter(bookTodo).length;
    nav.append(
      h('button', { class: `tab ${this.tab === 'book' ? 'active' : ''}`, type: 'button', onclick: () => this.setTab('book') },
        h('b', null, '🎟️ 예약·발권', bookN ? h('em', { class: 'count' }, String(bookN)) : null), h('small', null, '언제 무엇을 예약')),
      h('button', { class: `tab ${this.tab === 'check' ? 'active' : ''}`, type: 'button', onclick: () => this.setTab('check') },
        h('b', null, '✅ 할 일', todo ? h('em', { class: 'count' }, String(todo)) : null), h('small', null, '출발 전 준비')),
      h('button', { class: `tab ${this.tab === 'guide' ? 'active' : ''}`, type: 'button', onclick: () => this.setTab('guide') },
        h('b', null, '🧭 가이드'), h('small', null, '기차·지하철·중국 팁')),
      h('button', { class: `tab ${this.tab === 'info' ? 'active' : ''}`, type: 'button', onclick: () => this.setTab('info') },
        h('b', null, 'ℹ️ 정보'), h('small', null, '항공·숙소·결제')),
    );
    const act = nav.querySelector('.tab.active');
    if (act) requestAnimationFrame(() => act.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }));
  }

  // ── 하루 일정 ─────────────────────────────────────────
  currentTrack(day) {
    const tracks = day.tracks || [];
    const sel = this.trackSel[day.id];
    if (sel && tracks.some(t => t.id === sel)) return tracks.find(t => t.id === sel);
    if (tracks.length > 1 && this.store.me) {
      const mine = tracks.find(t => t.label === this.store.me);
      if (mine) return mine;
    }
    return tracks[0];
  }

  renderDay(day) {
    const days = this.data.days;
    const idx = days.indexOf(day);
    const track = this.currentTrack(day);
    const stops = (track && track.stops) || [];
    const done = this.store.done;
    const active = stops.filter(s => !s.skip);
    const doneN = active.filter(s => done.has(s.id)).length;
    const next = active.find(s => !done.has(s.id)) || null;
    const isToday = day.date === chinaToday();

    // 머리 카드
    const head = this.el.dayHead;
    clear(head);
    const route = stops.length ? `${shortName(stops[0])} → … → ${shortName(stops[stops.length - 1])} · ${stops.length}곳` : '아직 장소가 없어요';
    head.append(
      h('div', { class: 'dh-sub' }, `DAY ${idx + 1} · ${mdLabel(day.date)}`, isToday ? h('span', { class: 'today-badge' }, '오늘') : null),
      h('h2', { class: 'dh-title' }, day.title || ''),
      h('div', { class: 'dh-route' }, route),
      h('div', { class: 'progress' },
        h('div', { class: 'bar' }, h('i', { style: { width: active.length ? `${Math.round(doneN / active.length * 100)}%` : '0%' } })),
        h('span', null, `${doneN}/${active.length} 완료`),
        doneN ? h('button', { class: 'link-btn', type: 'button', onclick: () => this.store.clearDone(stops.map(s => s.id)) }, '초기화') : null),
    );
    if (day.note) head.append(this.noteBox(day.note));
    if (this.editing) {
      head.append(h('div', { class: 'edit-row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => E.editDay(this, day, track) }, '✏️ 제목·메모 수정')));
    }

    // 개별 일정 선택
    const tw = this.el.tracks;
    clear(tw);
    if ((day.tracks || []).length > 1) {
      tw.append(h('div', { class: 'seg' }, ...day.tracks.map(t => h('button', {
        class: `seg-btn ${t === track ? 'on' : ''}`,
        type: 'button',
        onclick: () => {
          this.trackSel[day.id] = t.id;
          sessionStorage.setItem('tp.track', JSON.stringify(this.trackSel));
          this.render();
        },
      }, t.label || t.id))));
    }
    if (track && track.note) tw.append(this.noteBox(track.note, 'card track-note'));
    tw.hidden = !tw.childNodes.length;

    // 지도
    this.renderMap(day, track, stops, next);

    // 장소 목록
    const list = this.el.list;
    clear(list);
    this.cardEls.clear();
    if (!stops.length) {
      list.append(h('div', { class: 'card empty' }, '장소가 없어요.', this.editing ? ' 아래 버튼으로 추가하세요.' : ''));
    }
    stops.forEach((s, i) => {
      const prev = i > 0 ? stops.slice(0, i).reverse().find(p => A.hasPos(p) && !p.skip) : null;
      const conn = this.moveRow(s, prev);
      if (conn) list.append(conn);
      const card = this.stopCard(day, track, s, i, { next, prev, stops });
      this.cardEls.set(s.id, card);
      list.append(card);
    });
    if (this.editing) {
      list.append(h('button', {
        class: 'btn add-btn',
        type: 'button',
        onclick: () => E.editStop(this, { day, track, stop: null, after: stops.length ? stops[stops.length - 1].id : null }),
      }, '➕ 장소 추가'));
    }
    list.append(h('div', { class: 'list-end' }));

    this.renderNextBar(day, track, next, stops);
  }

  richCtx() {
    return {
      onZh: t => this.showZh({ zh: t }),
      onCopy: t => this.copyZh(t),
    };
  }

  rich(src) {
    return renderRich(src, this.richCtx());
  }

  // 3줄 넘는 메모는 첫 줄만 보이고 눌러서 펼침
  noteBox(src, extra = '') {
    const lines = String(src).split('\n');
    if (lines.length <= 3) return h('div', { class: `note-box ${extra}` }, this.rich(src));
    return h('details', { class: `note-box ${extra}` },
      h('summary', null, inline(lines[0].replace(/^#{2,3}\s+/, '').replace(/^\s*[-•]\s+/, ''), this.richCtx())),
      h('div', { class: 'note-rest' }, this.rich(lines.slice(1).join('\n'))));
  }

  async copy(text, hint = '') {
    const ok = await copyText(text);
    toast(ok ? `복사했어요${hint ? ` · ${hint}` : ''}` : '복사하지 못했어요');
  }

  copyZh(text) {
    return this.copy(text, `${MAP.name} 검색창에 붙여넣기`);
  }

  // 근처 지하철역 찾기 (지도 앱 검색: 이 장소 주변 역)
  nearStationUrl(s) {
    return MAP.nearStation(s, this.linkOpts());
  }

  // 현지어 이름표 (중국어/일본어…)
  get local() {
    const t = (this.data && this.data.trip) || {};
    return { label: t.localLabel || '중국어', taxi: t.taxiPhrase ?? '师傅，请带我去这里。', taxiKo: t.taxiPhraseKo ?? '(기사님, 여기로 가 주세요)', lang: t.localLang || 'zh-CN' };
  }

  showZh(stop) {
    const href = A.hasPos(stop) ? MAP.route(stop, { kind: A.routeKind(stop.move && stop.move.mode), ...this.linkOpts() }) : null;
    const loc = this.local;
    showChinese({
      title: `${loc.label} 보여주기`,
      phrase: loc.taxi,
      phraseKo: loc.taxiKo,
      lang: loc.lang,
      routeLabel: `🧭 ${MAP.name} 길찾기`,
      zh: stop.zh || stop.name,
      addr: stop.addr,
      ko: stop.zh ? stop.name : '',
      onCopy: t => this.copyZh(t),
      onRoute: href ? { href, target: A.isIntent(href) ? '_self' : '_blank' } : null,
    });
  }

  linkAttrs(url) {
    return A.isIntent(url) ? { href: url } : { href: url, target: '_blank', rel: 'noopener' };
  }

  moveRow(s, prev) {
    const mv = s.move;
    if (!mv || (!mv.text && !prev)) return null;
    const m = MOVE[mv.mode] || MOVE.none;
    let routeBtn = null;
    if (prev && A.hasPos(s) && mv.mode !== 'flight') {
      const url = MAP.route(s, { from: prev, kind: A.routeKind(mv.mode), ...this.linkOpts() });
      routeBtn = h('a', { class: 'route-btn', ...this.linkAttrs(url) }, '경로');
    }
    // 기차 구간: 타는 법 안내 (출발역·도착역 가이드 연결)
    const trainBtn = mv.mode === 'train'
      ? h('button', { class: 'route-btn train-btn', type: 'button', onclick: () => this.openTrainGuide(prev, s) }, '🚄 타는 법')
      : null;
    // 고덕에서 받아온 경로 (이전 장소가 그대로일 때만 표시 — 순서가 바뀌면 옛 정보라 숨김)
    const r = s.route && prev && s.route.from === prev.id ? s.route : null;
    if (!r) {
      return h('div', { class: `move mode-${mv.mode || 'none'}` },
        h('span', { class: 'mv-icon' }, m.icon),
        h('span', { class: 'mv-text' }, mv.text || m.label),
        trainBtn, routeBtn);
    }
    const sum = [];
    if (r.min != null) sum.push(r.min >= 60 ? `${Math.floor(r.min / 60)}시간 ${r.min % 60}분` : `${r.min}분`);
    if (r.fare) sum.push(`${r.fare}위안`);
    if (r.walkM) sum.push(`도보 ${r.walkM >= 1000 ? `${(r.walkM / 1000).toFixed(1)}km` : `${r.walkM}m`}`);
    return h('div', { class: `move mode-${mv.mode || 'none'} has-route` },
      h('span', { class: 'mv-icon' }, m.icon),
      h('div', { class: 'mv-text' },
        h('div', { class: 'mv-sum' }, sum.join(' · ')),
        r.steps && r.steps.length ? h('div', { class: 'mv-steps' }, r.steps.map(x => h('span', { class: 'mv-step', lang: 'zh-CN' },
          h('b', null, x.line.replace(/^(地铁|轨道交通)/, '')), ` ${x.from} → ${x.to}`))) : null,
        h('div', { class: 'mv-src' }, `${MAP.name} 기준 ${r.at ? r.at.slice(5).replace('-', '/') : ''} · 실시간은 [경로]`)),
      trainBtn, routeBtn);
  }

  stopCard(day, track, s, i, ctx) {
    const cat = CAT[s.cat] || CAT.etc;
    const done = this.store.done.has(s.id);
    const isNext = ctx.next && ctx.next.id === s.id;
    const lo = this.linkOpts();
    const card = h('article', {
      class: `card stop ${done ? 'is-done' : ''} ${s.skip ? 'is-skip' : ''} ${isNext ? 'is-next' : ''}`,
      id: `stop-${s.id}`,
    });

    const badges = [];
    if (isNext) badges.push(h('span', { class: 'badge next' }, '다음'));
    if (s.skip) badges.push(h('span', { class: 'badge skip' }, '건너뜀'));
    if (s.review) badges.push(h('span', { class: 'badge review' }, '검토 필요'));

    card.append(h('div', { class: 'stop-top' },
      h('button', {
        class: `num cat-${s.cat || 'etc'}`,
        type: 'button',
        title: '지도에서 보기',
        onclick: () => this.focusOnMap(s.id),
      }, String(i + 1)),
      h('div', { class: 'stop-title' },
        h('div', { class: 'name' }, s.name || '(이름 없음)', ...badges),
        s.zh ? h('div', { class: 'zh', lang: 'zh-CN' }, s.zh) : null),
      h('button', {
        class: `done-btn ${done ? 'on' : ''}`,
        type: 'button',
        'aria-label': done ? '완료 취소' : '완료 표시',
        onclick: () => this.store.toggleDone(s.id),
      }, done ? '✓' : '')));

    // 일정 데이터에 직접 넣은 사진(암호화돼 공개되지 않음)이 있으면 그것, 없으면 앱에 든 자유 라이선스 사진
    const ph = s.photo ? { data: s.photo, alt: s.name, author: s.photoCredit || '직접 넣은 사진', license: '', src: '', page: s.photoSrc || '' }
      : (s.photoRef && PHOTOS.find(x => x.id === s.photoRef)) || findPhoto(s);
    if (ph) card.append(this.photoFigure(ph, 'stop-photo'));

    const meta = [];
    if (s.time) meta.push(h('span', { class: 'time' }, '⏰ ', s.time));
    meta.push(h('span', { class: 'cat' }, `${cat.icon} ${cat.label}`));
    card.append(h('div', { class: 'meta' }, meta));
    if (s.desc) card.append(h('p', { class: 'desc' }, inline(s.desc)));
    if (s.station) {
      card.append(h('div', { class: 'station' },
        h('span', { class: 'st-label' }, '🚇 가까운 역'),
        h('span', { class: 'st-name', lang: 'zh-CN' }, s.station),
        h('button', { class: 'mini', type: 'button', onclick: () => this.copyZh(s.station) }, '복사'),
        h('a', { class: 'mini', ...this.linkAttrs(MAP.search({ zh: s.station, lat: s.lat, lng: s.lng }, lo)) }, `${MAP.name}에서 보기`)));
    }
    if (s.info && s.info.length) {
      card.append(h('ul', { class: 'info' }, s.info.map(line => h('li', null, inline(line, { onZh: t => this.showZh({ zh: t }), onCopy: t => this.copy(t) })))));
    }
    if (s.tmi) {
      card.append(h('details', { class: 'tmi' }, h('summary', null, '📖 둘러보기 · 역사 · TMI'), h('div', { class: 'tmi-body' }, this.rich(s.tmi))));
    }
    if (s.links && s.links.length) {
      card.append(h('div', { class: 'links' }, s.links.map(l => h('a', { class: 'chip', href: l.url, target: '_blank', rel: 'noopener' }, '🔗 ', l.label || '링크'))));
    }

    const st = findStation(s);
    if (st) {
      card.append(h('button', { class: 'st-guide', type: 'button', onclick: () => this.openStation(st) },
        h('span', null, `${st.icon} ${st.name} 안내`), h('small', null, '타는 법 · 나가는 법 · 몇 층')));
    }
    const site = findSite(s);
    if (site) {
      card.append(h('button', { class: 'st-guide site-guide', type: 'button', onclick: () => this.openSite(site) },
        h('span', null, `🗺️ ${site.name} 내부 동선 지도`), h('small', null, `추천 순서 · 꼭 볼 곳 · ${site.time}`)));
    }

    const actions = h('div', { class: 'actions' });
    if (A.hasPos(s)) {
      const url = MAP.route(s, { kind: A.routeKind(s.move && s.move.mode), ...lo });
      actions.append(h('a', { class: 'btn primary', ...this.linkAttrs(url) }, `🧭 ${MAP.name} 길찾기`));
    } else if (s.zh) {
      const url = MAP.search(s, lo);
      actions.append(h('a', { class: 'btn', ...this.linkAttrs(url) }, `🔍 ${MAP.name} 검색`));
    }
    if (s.zh) actions.append(h('button', { class: 'btn', type: 'button', onclick: () => this.copyZh(s.zh) }, `📋 ${this.local.label} 복사`));
    actions.append(h('button', { class: 'btn icon', type: 'button', 'aria-label': '더보기', onclick: () => this.openStopMenu(day, track, s, i, ctx) }, '⋯'));
    card.append(actions);

    if (this.editing) {
      const stops = ctx.stops;
      card.append(h('div', { class: 'edit-row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => E.editStop(this, { day, track, stop: s }) }, '✏️ 수정'),
        h('button', { class: 'btn sm', type: 'button', disabled: i === 0, onclick: () => E.moveStop(this, day, track, s, -1) }, '⬆'),
        h('button', { class: 'btn sm', type: 'button', disabled: i === stops.length - 1, onclick: () => E.moveStop(this, day, track, s, +1) }, '⬇'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => E.editStop(this, { day, track, stop: null, after: s.id }) }, '➕ 아래에 추가'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: () => E.deleteStop(this, day, track, s) }, '🗑')));
    }
    return card;
  }

  openStopMenu(day, track, s, i, ctx) {
    const lo = this.linkOpts();
    const items = [];
    const item = (label, onclick, attrs = {}) => {
      const isLink = !!attrs.href;
      return h(isLink ? 'a' : 'button', { class: 'menu-item', type: isLink ? null : 'button', ...attrs, onclick: e => { if (onclick) onclick(e); setTimeout(() => sheet.close(), 50); } }, label);
    };
    if (A.hasPos(s)) items.push(item('📍 앱 지도에서 보기', () => this.focusOnMap(s.id)));
    if (ctx.prev && A.hasPos(s)) {
      const url = MAP.route(s, { from: ctx.prev, kind: A.routeKind(s.move && s.move.mode), ...lo });
      items.push(item(`🧭 이전 장소(${shortName(ctx.prev)}) → 여기 경로`, null, this.linkAttrs(url)));
    }
    if (A.hasPos(s)) {
      items.push(item('🧭 걸어서 가는 길 (현재 위치에서)', null, this.linkAttrs(MAP.route(s, { kind: 'walk', ...lo }))));
      items.push(item('🚕 차로 가는 길 (택시 탈 때 참고)', null, this.linkAttrs(MAP.route(s, { kind: 'car', ...lo }))));
      items.push(item(`🗺️ ${MAP.name}에서 위치 보기`, null, this.linkAttrs(MAP.marker(s, lo))));
    }
    if (s.zh) items.push(item(`🔍 ${MAP.name}에서 이름으로 검색`, null, this.linkAttrs(MAP.search(s, lo))));
    if (s.zh) items.push(item(`📋 ${this.local.label} 이름 복사`, () => this.copyZh(s.zh)));
    if (s.station) items.push(item(`📋 가까운 역 복사 (${s.station})`, () => this.copyZh(s.station)));
    if (A.hasPos(s)) items.push(item(`🚇 근처 지하철역 찾기 (${MAP.name})`, null, this.linkAttrs(this.nearStationUrl(s))));
    if (s.zh) items.push(item(`🀄 ${this.local.label} 크게 보여주기 (택시·직원)`, () => this.showZh(s)));
    if (s.addr) items.push(item(`📋 ${this.local.label} 주소 복사`, () => this.copy(s.addr)));
    const st = findStation(s);
    if (st) items.push(item(`${st.icon} ${st.name} 안내 (타는 법·나가는 법)`, () => setTimeout(() => this.openStation(st), 120)));
    const site = findSite(s);
    if (site) items.push(item(`🗺️ ${site.name} 내부 동선 지도`, () => setTimeout(() => this.openSite(site), 120)));
    items.push(item(ctx.prev ? `🤖 AI에게 묻기: ${shortName(ctx.prev)} → 여기 가는 법` : '🤖 AI에게 여기 가는 법 묻기',
      () => setTimeout(() => this.openAskAI(this.stopPrompt(day, s, ctx.prev)), 120)));
    items.push(item(this.store.done.has(s.id) ? '↩️ 완료 취소' : '✅ 완료 표시', () => this.store.toggleDone(s.id)));
    if (this.store.canEdit) {
      items.push(item('✏️ 이 장소 수정', () => E.editStop(this, { day, track, stop: s })));
      items.push(item(s.skip ? '▶️ 다시 일정에 넣기' : '⏭️ 이번엔 건너뛰기 (같이 반영)', () => {
        this.store.commit({ type: 'stop.update', day: day.id, track: track.id, stopId: s.id, patch: { skip: !s.skip } });
      }));
    }
    const sheet = openSheet({ title: `${i + 1}. ${s.name}`, body: h('div', { class: 'menu' }, items) });
  }

  focusOnMap(id) {
    if (!this.map) return;
    this.el.mapCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      if (!this.map.focus(id)) toast('이 장소는 지도 좌표가 없어요');
    }, 350);
  }

  onMarker(id) {
    const card = this.cardEls.get(id);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }


  // 장소 사진 + 출처 (누르면 크게)
  photoFigure(ph, cls = '') {
    return h('figure', { class: `photo ${cls}` },
      h('img', { src: ph.data || photoPath(ph), alt: ph.alt, loading: 'lazy', decoding: 'async', onclick: () => this.openPhoto(ph) }),
      ph.src
        ? h('figcaption', null, '📷 ', h('a', { href: ph.src, target: '_blank', rel: 'noopener' }, `${ph.author} · ${ph.license}`), ' · 위키미디어 공용')
        : h('figcaption', null, '📷 ', ph.page ? h('a', { href: ph.page, target: '_blank', rel: 'noopener' }, `출처: ${ph.author}`) : ph.author));
  }

  openPhoto(ph) {
    openSheet({
      title: `📷 ${ph.alt}`,
      full: true,
      className: 'photo-sheet',
      body: h('div', { class: 'photo-big' },
        h('img', { src: ph.data || photoPath(ph), alt: ph.alt }),
        ph.src
          ? h('p', { class: 'muted small' }, '사진: ', h('a', { href: ph.src, target: '_blank', rel: 'noopener' }, ph.author), ` · ${ph.license} · 위키미디어 공용 (찍은 때와 지금 모습이 다를 수 있어요)`)
          : h('p', { class: 'muted small' }, '사진 ', ph.page ? h('a', { href: ph.page, target: '_blank', rel: 'noopener' }, `출처: ${ph.author}`) : ph.author, ' (개인 여행용으로만 보관)')),
    });
  }

  // 위치 권한 켜는 법 (기기별)
  openLocationHelp() {
    const UA = navigator.userAgent || '';
    const tabs = [
      ['android', '안드로이드', [
        '휴대폰 **위치(GPS)** 가 켜져 있는지 확인 — 화면 위에서 아래로 내려 빠른 설정의 **위치** 켜기',
        '크롬 주소창 왼쪽 **조정 아이콘(또는 자물쇠)** → **권한** → **위치** → **허용**',
        '또는 크롬 **⋮ → 설정 → 사이트 설정 → 위치** → 이 사이트(pixti.github.io)를 **허용**',
        '**홈 화면에 설치한 앱**이면: 앱 아이콘 길게 누르기 → **앱 정보** → **권한** → **위치 → 앱 사용 중에만 허용**',
        '그래도 안 되면: 휴대폰 **설정 → 애플리케이션 → Chrome → 권한 → 위치 → 앱 사용 중에만 허용**',
        '바꾼 뒤 앱으로 돌아와 **◎ 내 위치**를 다시 누르기',
      ]],
      ['iphone', '아이폰', [
        '**설정 → 개인정보 보호 및 보안 → 위치 서비스** 켜기',
        '같은 화면 아래 **Safari 웹 사이트** → **앱을 사용하는 동안** + **정확한 위치** 켜기',
        '사파리에서 주소창 왼쪽 **가가(aA)** → **웹 사이트 설정** → **위치** → **허용**',
        '홈 화면에 추가한 앱은 처음 누를 때 물어봐요 → **허용**',
        '바꾼 뒤 앱으로 돌아와 **◎ 내 위치**를 다시 누르기',
      ]],
      ['pc', '컴퓨터', [
        '크롬 **⋮ → 설정 → 개인 정보 보호 및 보안 → 사이트 설정 → 위치** → 이 사이트를 **허용**',
        '윈도우: **설정 → 개인 정보 및 보안 → 위치** → 위치 서비스·앱의 위치 액세스 켜기',
        '맥: **시스템 설정 → 개인정보 보호 및 보안 → 위치 서비스** → Chrome 켜기',
        'PC는 GPS가 없어서 위치가 수백 m 틀릴 수 있어요',
      ]],
    ];
    let cur = /iPhone|iPad/.test(UA) ? 'iphone' : /Android/.test(UA) ? 'android' : 'pc';
    const body = h('div', { class: 'loc-help' });
    const draw = () => {
      clear(body).append(
        h('p', null, inline('지도에 내 위치를 보려면 이 앱에 **위치 권한**이 필요해요. 쓰는 기기를 고르세요.')),
        h('div', { class: 'seg' }, tabs.map(([id, label]) => h('button', { class: `seg-btn ${cur === id ? 'on' : ''}`, type: 'button', onclick: () => { cur = id; draw(); } }, label))),
        this.stepList(tabs.find(t => t[0] === cur)[2]),
        h('p', { class: 'muted small' }, '위치 정보는 내 폰 지도에만 쓰이고 어디에도 저장·전송되지 않아요.'));
    };
    draw();
    openSheet({ title: '📍 위치 권한 켜는 법', body, full: true });
  }

  // ── 지도 ──────────────────────────────────────────────
  renderMap(day, track, stops, next) {
    if (!this.map) {
      this.map = new TripMap(this.mapEl, { lang: this.store.prefs.lang, onMarker: id => this.onMarker(id) });
      setTimeout(() => this.map.invalidate(), 50);
    }
    this.map.setLang(this.store.prefs.lang);
    const sig = JSON.stringify([day.id, track && track.id, stops.map(s => [s.id, s.lat, s.lng, !!s.skip])]);
    const fit = sig !== this.mapSig;
    this.mapSig = sig;
    this.map.setStops(stops, { nextId: next && next.id, done: this.store.done, fit });
    if (fit) setTimeout(() => { this.map.invalidate(); this.map.fit(); }, 30);

    const tools = this.el.mapTools;
    clear(tools);
    const lang = this.store.prefs.lang === 'en' ? 'en' : 'zh';
    tools.append(
      MAP.tiles.langs && h('div', { class: 'seg small' },
        h('button', { class: `seg-btn ${lang === 'zh' ? 'on' : ''}`, type: 'button', onclick: () => this.store.setPref('lang', 'zh') }, '중문'),
        h('button', { class: `seg-btn ${lang === 'en' ? 'on' : ''}`, type: 'button', onclick: () => this.store.setPref('lang', 'en') }, '영문')),
      h('button', { class: `btn sm ${this.map.locating ? 'on' : ''}`, type: 'button', onclick: () => this.toggleLocate() }, '◎ 내 위치'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => this.map.fit(true) }, '📍 모든 핀'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => this.toggleFullscreen(true) }, '⤢ 크게'),
      h('a', { class: 'btn sm primary', href: MAP.multi(stops), target: '_blank', rel: 'noopener' }, `${MAP.name}에서 전체 보기`),
    );
  }

  toggleLocate() {
    if (this.map.locating) {
      this.map.stopLocate();
      this.myPos = null;
      this.render();
      return;
    }
    this.map.startLocate(pos => { this.myPos = pos; this.updateNextDist(); }, msg => {
      if (/권한/.test(msg)) this.openLocationHelp();
      else toast(`${msg} — 실내라면 창가로, 휴대폰 위치(GPS)가 켜져 있는지 확인하세요`, { ms: 4500 });
      this.render();
    });
    this.render();
  }

  toggleFullscreen(on) {
    const card = this.el.mapCard;
    if (on && !card.classList.contains('fs')) {
      card.classList.add('fs');
      document.body.classList.add('no-scroll');
      this.fsLayer = openLayer(h('div'), {
        onClose: () => {
          card.classList.remove('fs');
          document.body.classList.remove('no-scroll');
          this.fsLayer = null;
          setTimeout(() => this.map && this.map.invalidate(), 60);
        },
      });
      setTimeout(() => this.map.invalidate(), 60);
    } else if (!on && this.fsLayer) {
      this.fsLayer.close();
    }
  }

  // ── 아래 고정 바 ──────────────────────────────────────
  // 내 위치를 켰을 때 다음 목적지까지 직선거리
  updateNextDist() {
    const el = this.el.nextBar.querySelector('.nb-dist');
    const n = this.nextStop;
    if (!el) return;
    if (!this.myPos || !n || !A.hasPos(n)) { el.textContent = ''; return; }
    const m = distM(this.myPos, n);
    el.textContent = `📍 ${m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`}`;
  }

  renderNextBar(day, track, next) {
    this.nextStop = next;
    const bar = this.el.nextBar;
    clear(bar);
    bar.hidden = false;
    if (!next) {
      bar.append(h('div', { class: 'nb-text' }, h('div', { class: 'nb-label' }, day.title || ''), h('div', { class: 'nb-name' }, '이 날 일정 끝! 🎉')));
      return;
    }
    const stops = track.stops;
    const n = stops.indexOf(next) + 1;
    const lo = this.linkOpts();
    appendKids(bar, [
      h('button', { class: 'nb-text', type: 'button', onclick: () => this.onMarker(next.id) },
        h('div', { class: 'nb-label' }, '다음 목적지 ', h('span', { class: 'nb-dist' })),
        h('div', { class: 'nb-name' }, `${n}. ${next.name}`),
        next.zh ? h('div', { class: 'nb-zh', lang: 'zh-CN' }, next.zh) : null),
      next.zh ? h('button', { class: 'btn nb-btn', type: 'button', onclick: () => this.copyZh(next.zh) }, this.local.label, h('br'), '복사') : null,
      A.hasPos(next)
        ? h('a', { class: 'btn primary nb-btn', ...this.linkAttrs(MAP.route(next, { kind: A.routeKind(next.move && next.move.mode), ...lo })) }, MAP.name, h('br'), '길찾기')
        : null,
    ]);
  }

  // ── 가이드 탭 (앱에 내장된 교통·생활 안내) ─────────────
  renderGuide() {
    const v = this.el.otherView;
    clear(v);
    v.append(h('div', { class: 'card guide-intro' },
      h('h3', null, '🧭 중국 처음이라면'),
      h('p', null, '기차·지하철 타는 순서, 역 안에서 몇 층으로 가는지, 갑자기 나오는 짐검사까지 정리했어요. 중국어 글자는 누르면 복사, ⤢ 누르면 크게 보여줘요.'),
      h('p', { class: 'muted small' }, `${GUIDE_ASOF} · 역 구조·규정은 바뀔 수 있으니 현장 표지판과 직원 안내가 우선이에요.`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => this.openLocationHelp() }, '📍 내 위치가 안 나올 때 (위치 권한 켜는 법)')));

    // 기차 타는 법
    const train = h('details', { class: 'card info-sec', open: this.guideOpen ? this.guideOpen.has('train') : true },
      h('summary', null, h('h3', null, '🚄 기차(고속철) 타는 법 — 처음부터 끝까지')),
      this.stepList(TRAIN_STEPS));
    this.trackGuideOpen(train, 'train');
    v.append(train);

    // 역별 안내
    v.append(h('div', { class: 'card' },
      h('h3', null, '🚉 역별 안내 — 몇 층에서 타고 어디로 나가는지'),
      h('div', { class: 'st-grid' }, STATIONS.map(st => h('button', { class: 'st-card', type: 'button', onclick: () => this.openStation(st) },
        h('b', null, `${st.icon} ${st.name}`),
        h('span', { lang: 'zh-CN' }, st.zh),
        h('small', null, st.sub))))));

    // 정원 내부 동선
    v.append(h('div', { class: 'card' },
      h('h3', null, '🏯 정원 내부 동선 지도 — 오래 걸리는 곳'),
      h('p', { class: 'muted small' }, '2~3시간 걸리는 큰 정원은 안에서 길을 잃기 쉬워요. 추천 순서대로 그린 개략도와 꼭 볼 곳이에요.'),
      h('div', { class: 'st-grid' }, SITES.map(site => h('button', { class: 'st-card', type: 'button', onclick: () => this.openSite(site) },
        h('b', null, `🗺️ ${site.name}`),
        h('span', { lang: 'zh-CN' }, `${site.zh} · ${site.city}`),
        h('small', null, site.time))))));

    // 주제별
    SECTIONS.forEach(sec => {
      const card = h('details', { class: 'card info-sec', open: this.guideOpen ? this.guideOpen.has(sec.id) : false },
        h('summary', null, h('h3', null, `${sec.icon} ${sec.title}`)),
        h('div', { class: 'rt' }, this.rich(sec.body)));
      this.trackGuideOpen(card, sec.id);
      v.append(card);
    });

    // AI에게 묻기 (자유 질문)
    const from = h('input', { class: 'inp', placeholder: '출발 (예: 塘桥역, 숙소)' });
    const to = h('input', { class: 'inp', placeholder: '도착 (예: 上海虹桥站 G7xxx 탑승)' });
    const q = h('textarea', { class: 'inp', rows: 3, placeholder: '궁금한 것 (예: 기차 타려면 몇 층으로 가요? 짐검사에서 뭘 꺼내야 해요?)' });
    v.append(h('div', { class: 'card ai-card' },
      h('h3', null, '🤖 AI에게 묻기'),
      h('p', { class: 'muted small' }, '여기 없는 상황은 AI에게 물어보세요. 질문을 "단계별·몇 층·표지판 중국어·확실하지 않으면 확인 필요 표시" 형식으로 만들어서 넘겨줘요. 장소 카드 ⋯ 메뉴에서는 그 구간 정보가 자동으로 들어가요.'),
      h('div', { class: 'editor' }, from, to, q),
      h('div', { class: 'row ai-go' }, h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => this.openAskAI(buildPrompt({ from: from.value.trim(), to: to.value.trim(), question: q.value.trim(), context: this.tripContext() })),
      }, '질문 만들기 →'))));
    v.append(h('div', { class: 'list-end' }));
  }

  trackGuideOpen(card, id) {
    card.addEventListener('toggle', () => {
      if (!this.guideOpen) this.guideOpen = new Set(['train']);
      if (card.open) this.guideOpen.add(id); else this.guideOpen.delete(id);
    });
  }

  stepList(steps) {
    return h('ol', { class: 'steps' }, steps.map(t => h('li', null, inline(t, this.richCtx()))));
  }

  // 역 하나의 안내 (출발 / 도착 / 층 구조)
  openStation(st, { focus = null } = {}) {
    const lo = this.linkOpts();
    const part = (key, title) => st[key] && st[key].length
      ? h('details', { class: 'st-part', open: !focus || focus === key }, h('summary', null, title),
        st.flow && st.flow[key] ? h('div', { class: 'flow' }, st.flow[key].map((f, i) => [i ? h('span', { class: 'flow-arrow' }, '→') : null, h('span', { class: 'flow-step' }, f)])) : null,
        this.stepList(st[key]))
      : null;
    const body = h('div', { class: 'st-sheet' },
      (ph => ph ? this.photoFigure(ph, 'site-photo') : null)(findPhoto({ zh: st.zh, cat: 'station' })),
      h('div', { class: 'st-head' },
        h('div', { class: 'st-zh', lang: 'zh-CN' }, st.zh),
        h('div', { class: 'muted small' }, st.sub)),
      st.floors && st.floors.length ? h('div', { class: 'floors' }, st.floors.map(([f, t]) => h('div', { class: 'floor' }, h('b', null, f), h('span', null, t)))) : null,
      h('div', { class: 'photo-row' }, h('span', { class: 'muted small' }, '📷 사진으로 미리 보기'), STATION_PHOTOS.map(([q, ko]) => h('a', { class: 'chip', href: photoUrl(`${st.zh} ${q}`), target: '_blank', rel: 'noopener' }, ko))),
      focus === 'arrive' ? [part('arrive', '🚪 도착해서 나가기'), part('depart', '🚶 타러 가기 (출발)')]
        : [part('depart', '🚶 타러 가기 (출발)'), part('arrive', '🚪 도착해서 나가기')],
      st.tips && st.tips.length ? h('div', { class: 'note-box' }, h('ul', { class: 'rt-ul' }, st.tips.map(t => h('li', null, inline(t, this.richCtx()))))) : null,
      h('p', { class: 'muted small' }, `${GUIDE_ASOF} · 현장 표지판이 우선이에요. 고덕 지하철 경로의 「站内图文指引」(역 안 사진 길안내)도 같이 보세요.`));
    openSheet({
      title: `${st.icon} ${st.name} 안내`,
      body,
      full: true,
      actions: [
        h('a', { class: 'btn', ...this.linkAttrs(MAP.search({ zh: st.zh }, lo)) }, `🗺️ ${MAP.name}에서 보기`),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => this.openAskAI(buildPrompt({
            to: st.zh,
            context: this.tripContext(),
            question: `${st.zh}(${st.name})에서 고속철 타는 법과 내려서 나가는 법을 자세히 알려줘. 몇 층이 출발층인지, 지하철에서 어떻게 올라가는지, 여권 확인·짐검사 위치, 검표구 찾는 법, 도착 후 지하철·택시 타는 곳까지.`,
          })),
        }, '🤖 AI에게 더 묻기'),
      ],
    });
  }

  // 기차 구간: 공통 순서 + 출발역/도착역 안내 바로가기
  openTrainGuide(from, to) {
    const a = findStation(from);
    const b = findStation(to);
    let sheet = null;
    const go = (st, focus) => { sheet.close(); setTimeout(() => this.openStation(st, { focus }), 120); };
    const links = [
      a ? h('button', { class: 'st-card', type: 'button', onclick: () => go(a, 'depart') }, h('b', null, `출발 ${a.icon} ${a.name}`), h('small', null, '타러 가기 · 몇 층')) : null,
      b ? h('button', { class: 'st-card', type: 'button', onclick: () => go(b, 'arrive') }, h('b', null, `도착 ${b.icon} ${b.name}`), h('small', null, '내려서 나가기')) : null,
    ].filter(Boolean);
    const body = h('div', null,
      links.length ? h('div', { class: 'st-grid' }, links) : null,
      h('h4', { class: 'rt-h' }, '기차 타는 순서'),
      this.stepList(TRAIN_STEPS));
    sheet = openSheet({
      title: `🚄 ${from ? shortName(from) : ''} → ${shortName(to)}`,
      body,
      full: true,
      actions: [h('button', {
        class: 'btn', type: 'button',
        onclick: () => this.openAskAI(this.stopPrompt(null, to, from)),
      }, '🤖 이 구간 AI에게 묻기')],
    });
  }

  // 일정 공통 맥락 (숙소 등) — AI 질문에 덧붙임
  tripContext() {
    const out = [];
    const hotel = (this.data.days || []).flatMap(d => (d.tracks || []).flatMap(t => t.stops || [])).find(s => s.cat === 'hotel' && (s.zh || s.name));
    if (hotel) out.push(`숙소: ${[hotel.zh, hotel.station && `가까운 지하철역 ${hotel.station}`].filter(Boolean).join(' / ') || hotel.name}`);
    out.push('여권으로 트립닷컴/12306에서 산 전자 기차표, 알리페이 사용, 고덕지도 사용');
    return out;
  }

  stopPrompt(day, s, prev) {
    const place = x => x ? [x.name, x.zh && x.zh !== x.name ? x.zh : ''].filter(Boolean).join(' / ') : '';
    const mv = s.move || {};
    const m = MOVE[mv.mode];
    const ctx = [];
    if (mv.text) ctx.push(`일정 메모: ${mv.text}`);
    const r = s.route && prev && s.route.from === prev.id ? s.route : null;
    if (r && r.steps && r.steps.length) ctx.push(`고덕 경로: ${r.steps.map(x => `${x.line} ${x.from}→${x.to}`).join(', ')}`);
    if (prev && prev.station) ctx.push(`출발지 근처 지하철역: ${prev.station}`);
    if (s.station) ctx.push(`목적지 근처 지하철역: ${s.station}`);
    if (s.addr) ctx.push(`목적지 주소: ${s.addr}`);
    const d = day || (this.data.days || []).find(x => (x.tracks || []).some(t => (t.stops || []).includes(s)));
    return buildPrompt({
      from: prev ? place(prev) : '현재 위치',
      to: place(s),
      mode: m && mv.mode !== 'none' ? m.label : '',
      when: [d && d.date ? mdLabel(d.date) : '', s.time || ''].filter(Boolean).join(' '),
      context: [...ctx, ...this.tripContext()],
      question: mv.mode === 'train'
        ? '이 기차 구간을 처음 타. 출발역에서 몇 층으로 가서 어떻게 타는지, 도착역에서 어떻게 나가서 다음 교통수단을 타는지 알려줘.'
        : '출발지에서 목적지까지 가장 쉬운 방법과, 정류장·역·출구에서 길을 잃지 않게 단계별로 알려줘.',
    });
  }

  // 정원 내부 동선: 개략도(위에 고정) + 번호 순서 목록 — 서로 누르면 연결돼서 표시
  openSite(site) {
    const lo = this.linkOpts();
    const ctx = this.richCtx();
    const items = [];
    const mapBox = h('div', { class: 'site-map' });
    const zoomBtn = h('button', { class: 'btn sm site-zoom', type: 'button' }, '🔍 크게');
    const foldBtn = h('button', { class: 'btn sm site-fold', type: 'button' });
    const setFold = on => {
      mapBox.classList.toggle('folded', on);
      foldBtn.textContent = on ? '🗺️ 지도 펼치기' : '▲ 지도 접기';
      zoomBtn.hidden = on;
      localStorage.setItem('tp.siteFold', on ? '1' : '');
    };
    foldBtn.addEventListener('click', () => setFold(!mapBox.classList.contains('folded')));
    const pick = (i, fromMap) => {
      svg.querySelectorAll('.sm-spot.on').forEach(x => x.classList.remove('on'));
      const g = svg.querySelector(`.sm-spot[data-i="${i}"]`);
      if (g) g.classList.add('on');
      items.forEach((li, k) => li.classList.toggle('on', k === i));
      if (!fromMap && mapBox.classList.contains('folded')) setFold(false);
      if (fromMap && items[i]) items[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 크게 보기 중이면 지도를 그 지점으로 이동
      const sp = site.spots[i];
      if (!fromMap && sp && mapBox.classList.contains('zoom')) {
        const w = svg.clientWidth;
        const hgt = svg.clientHeight;
        mapBox.scrollTo({ left: sp.x / 400 * w - mapBox.clientWidth / 2, top: sp.y / (site.h || 260) * hgt - mapBox.clientHeight / 2, behavior: 'smooth' });
      }
    };
    const svg = siteMapSvg(site, { onSpot: i => pick(i, true) });
    mapBox.append(svg);
    zoomBtn.addEventListener('click', () => {
      const on = mapBox.classList.toggle('zoom');
      zoomBtn.textContent = on ? '↩ 원래 크기' : '🔍 크게';
    });
    const list = h('ol', { class: 'site-list' });
    site.spots.forEach((s, i) => {
      const li = h('li', { class: `site-item ${s.must ? 'must' : ''}`, onclick: e => { if (!e.target.closest('.zh-chip')) pick(i, false); } },
        h('span', { class: 'si-num' }, i === 0 ? '🚪' : String(i)),
        h('div', { class: 'si-body' },
          h('div', { class: 'si-name' }, h('b', null, s.ko), ' ', inline(`{zh:${s.zh}}`, ctx), s.must ? h('span', { class: 'si-must' }, '★ 꼭 보기') : null),
          h('div', { class: 'si-desc' }, inline(s.desc, ctx)),
          h('a', { class: 'si-photo', href: photoUrl(i === 0 ? `${site.zh} ${s.ko.includes('남문') ? '南门' : '入口'}` : `${site.zh} ${s.zh}`), target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, '📷 사진 보기')));
      items.push(li);
      list.append(li);
    });
    const sph = findPhoto({ zh: site.zh, cat: 'sight' });
    const scroll = h('div', { class: 'site-scroll' },
      h('div', { class: 'site-top' },
        h('div', null, h('span', { class: 'st-zh', lang: 'zh-CN' }, site.zh), h('span', { class: 'muted small' }, ` ${site.city} · ⏱ ${site.time}`)),
        h('p', { class: 'site-intro' }, inline(site.intro, ctx))),
      sph ? this.photoFigure(sph, 'site-photo') : null,
      list,
      h('div', { class: 'note-box' }, h('ul', { class: 'rt-ul' }, site.tips.map(t => h('li', null, inline(t, ctx))))),
      h('p', { class: 'muted small' }, `${GUIDE_ASOF} · 직접 그린 개략도라 실제 축척·모양과 달라요. 번호나 이름을 누르면 지도와 목록이 서로 표시돼요. 공사·통제로 길이 막히면 현장 안내판(导览图)을 따라가세요.`));
    // 지도는 위에 항상 고정, 아래 목록만 스크롤
    const body = h('div', { class: 'site-sheet' },
      h('div', { class: 'site-stick' }, mapBox,
        h('div', { class: 'site-legend' },
          h('span', null, h('i', { class: 'lg-route' }), '추천 동선'),
          h('span', null, h('i', { class: 'lg-dot' }), '순서'),
          h('span', null, h('i', { class: 'lg-must' }), '꼭 볼 곳'),
          site.wc && site.wc.length ? h('span', null, h('i', { class: 'lg-wc' }, 'WC'), '화장실') : null,
          h('span', { class: 'site-btns' }, foldBtn, zoomBtn))),
      scroll);
    setFold(localStorage.getItem('tp.siteFold') === '1');
    openSheet({
      title: `🗺️ ${site.name} 내부 동선`,
      body,
      full: true,
      className: 'site-sheet-wrap',
      actions: [
        h('a', { class: 'btn', ...this.linkAttrs(MAP.search({ zh: site.zh }, lo)) }, `🗺️ ${MAP.name}에서 보기`),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => this.openAskAI(buildPrompt({
            to: `${site.zh} (${site.city})`,
            context: [`추천 동선: ${site.spots.map(s => s.zh).join(' → ')}`],
            question: `${site.zh} 안을 처음 둘러봐. 위 동선이 맞는지, 놓치면 아까운 곳과 사진 포인트, 화장실·출구 위치, 시간이 부족할 때 줄이는 방법을 알려줘.`,
          })),
        }, '🤖 AI에게 더 묻기'),
      ],
    });
  }

  // 질문 미리보기 → 복사 + AI 열기
  openAskAI(prompt) {
    const ta = h('textarea', { class: 'inp ai-prompt', rows: 12 });
    ta.value = prompt;
    const open = t => {
      const text = ta.value.trim();
      copyText(text);
      window.open(t.url(text), '_blank', 'noopener');
    };
    openSheet({
      title: '🤖 AI에게 묻기',
      full: true,
      className: 'ai-sheet',
      body: h('div', { class: 'editor' },
        h('p', { class: 'muted small' }, '아래 질문을 고쳐도 돼요. 버튼을 누르면 질문이 복사되고 AI가 열려요 (질문이 안 들어가 있으면 붙여넣기). AI 답은 틀릴 수 있으니 층·출구 번호는 현장 표지판으로 꼭 확인하세요.'),
        ta,
        h('p', { class: 'muted small' }, '중국 현지 와이파이/유심에서는 ChatGPT·Claude가 막혀요 (한국 로밍은 OK). 그럴 땐 [질문 복사] 후 豆包·DeepSeek 같은 중국 AI에 붙여넣기.')),
      actions: [
        ...AI_TARGETS.map(t => h('button', { class: 'btn primary', type: 'button', onclick: () => open(t) }, t.label)),
        h('button', { class: 'btn', type: 'button', onclick: () => this.copy(ta.value.trim(), 'AI 앱에 붙여넣기') }, '질문 복사'),
      ],
    });
  }

  // ── 정보 탭 ───────────────────────────────────────────
  renderInfo() {
    const v = this.el.otherView;
    clear(v);
    const rate = this.store.rate;
    const live = this.store.prefs.rateLive;
    const hint = '금액을 넣으면 원으로 바꿔줘요';
    const out = h('div', { class: 'conv-out empty' }, hint);
    const gLink = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://www.google.com/search?q=1+CNY+to+KRW' }, '🔎 구글 환율');
    const nLink = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent('위안 환율') }, '🔎 네이버 환율');
    const input = h('input', {
      class: 'conv-in',
      type: 'number',
      inputmode: 'decimal',
      placeholder: '위안',
      oninput: () => {
        const n = parseFloat(input.value);
        const ok = Number.isFinite(n) && n > 0;
        out.textContent = ok ? `${n} 위안 ≈ ${won(n * this.store.rate)} 원` : hint;
        out.classList.toggle('empty', !ok);
        const q = ok ? `${n}+CNY+to+KRW` : '1+CNY+to+KRW';
        gLink.href = `https://www.google.com/search?q=${q}`;
        nLink.href = 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent(ok ? `${n}위안 원화` : '위안 환율');
      },
    });
    // 원 → 위안
    const hintW = '원화를 넣으면 위안으로 바꿔줘요';
    const outW = h('div', { class: 'conv-out empty' }, hintW);
    const inputW = h('input', {
      class: 'conv-in',
      type: 'number',
      inputmode: 'numeric',
      placeholder: '원',
      oninput: () => {
        const n = parseFloat(inputW.value);
        const ok = Number.isFinite(n) && n > 0;
        const y = ok ? n / this.store.rate : 0;
        outW.textContent = ok ? `${won(n)} 원 ≈ ${y >= 100 ? Math.round(y).toLocaleString('ko-KR') : y.toFixed(1)} 위안` : hintW;
        outW.classList.toggle('empty', !ok);
      },
    });
    const src = this.store.prefs.rate
      ? '직접 입력한 환율'
      : live ? `오늘 환율 (${new Date(live.at).toLocaleDateString('ko-KR')} 기준)` : '기본값';
    const small = h('small', null, `1위안 = ${rate}원 · ${src}`);
    this.conv = { small, input, inputW };
    v.append(h('div', { class: 'card conv' },
      h('div', { class: 'conv-title' }, '💱 위안 → 원 ', small),
      h('div', { class: 'conv-row' }, input, h('span', null, '¥')),
      out,
      h('div', { class: 'conv-title conv-sub' }, '💱 원 → 위안'),
      h('div', { class: 'conv-row' }, inputW, h('span', null, '₩')),
      outW,
      h('div', { class: 'row conv-links' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => this.fetchRate(true) }, '↻ 오늘 환율 받기'),
        gLink, nLink)));
    this.fetchRate(false);

    const sections = this.data.info || [];
    sections.forEach((sec, i) => {
      // 제목만 보이고 눌러서 펼침 (펼친 상태는 기억)
      const open = this.infoOpen ? this.infoOpen.has(sec.id) : i < 2;
      const card = h('details', { class: 'card info-sec', open },
        h('summary', null, h('h3', null, `${sec.icon || '📌'} ${sec.title || ''}`)),
        h('div', { class: 'rt' }, this.rich(sec.body)));
      card.addEventListener('toggle', () => {
        if (!this.infoOpen) this.infoOpen = new Set(sections.filter((x, k) => k < 2).map(x => x.id));
        if (card.open) this.infoOpen.add(sec.id); else this.infoOpen.delete(sec.id);
      });
      if (this.editing) {
        card.append(h('div', { class: 'edit-row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => E.editInfo(this, sec) }, '✏️ 수정'),
          h('button', { class: 'btn sm', type: 'button', disabled: i === 0, onclick: () => this.store.commit({ type: 'info.move', id: sec.id, after: i >= 2 ? sections[i - 2].id : null }) }, '⬆'),
          h('button', { class: 'btn sm', type: 'button', disabled: i === sections.length - 1, onclick: () => this.store.commit({ type: 'info.move', id: sec.id, after: sections[i + 1].id }) }, '⬇'),
          h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmSheet(`'${sec.title}' 섹션을 지울까요?`, { ok: '지우기', danger: true })) this.store.commit({ type: 'info.delete', id: sec.id }); } }, '🗑')));
      }
      v.append(card);
    });
    if (this.editing) v.append(h('button', { class: 'btn add-btn', type: 'button', onclick: () => E.editInfo(this, null) }, '➕ 정보 섹션 추가'));
    v.append(h('div', { class: 'list-end' }));
  }

  // 무료 환율 서버에서 오늘 위안→원 받기 (하루 한 번 자동, 버튼으로 강제)
  async fetchRate(force) {
    const live = this.store.prefs.rateLive;
    if (!force && live && Date.now() - live.at < 12 * 3600000) return;
    if (navigator.onLine === false) { if (force) toast('오프라인이에요 — 저장된 환율을 써요'); return; }
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/CNY', { cache: 'no-store' });
      const j = await r.json();
      const krw = j && j.rates && j.rates.KRW;
      if (!krw) throw new Error('no rate');
      this.store.setPref('rateLive', { rate: Math.round(krw * 10) / 10, at: Date.now() }, { silent: true });
      // 입력 중인 금액은 그대로 두고 환율 표시·계산만 갱신
      if (this.conv && this.conv.small.isConnected) {
        this.conv.small.textContent = `1위안 = ${this.store.rate}원 · ${this.store.prefs.rate ? '직접 입력한 환율' : `오늘 환율 (${new Date().toLocaleDateString('ko-KR')} 기준)`}`;
        this.conv.input.dispatchEvent(new Event('input'));
        this.conv.inputW.dispatchEvent(new Event('input'));
      }
      if (force) toast(`오늘 환율: 1위안 = ${Math.round(krw * 10) / 10}원`);
    } catch {
      if (force) toast('환율을 못 받았어요 — 구글/네이버 버튼으로 확인하세요');
    }
  }


  // ── 예약·발권 탭: 언제 열리고, 어디서, 얼마, 누가 ─────────
  renderBook() {
    const v = this.el.otherView;
    clear(v);
    const today = chinaToday();
    const items = (this.data.checklist || []).filter(isBook);
    const site = c => c.onsite || c.need === '현장';
    const g = { now: [], soon: [], opt: [], site: [], done: [] };
    for (const c of items) {
      if (c.done) g.done.push(c);
      else if (site(c)) g.site.push(c);
      else if (c.need === '선택') g.opt.push(c);
      else if (c.opens && c.opens > today) g.soon.push(c);
      else g.now.push(c);
    }
    const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
    g.now.sort(byDate); g.site.sort(byDate); g.opt.sort(byDate); g.done.sort(byDate);
    g.soon.sort((a, b) => a.opens.localeCompare(b.opens) || byDate(a, b));
    const must = items.filter(c => !site(c) && c.need !== '선택');
    const mustDone = must.filter(c => c.done).length;
    const who = [...new Set(items.map(c => c.who).filter(Boolean))].join(' · ');

    // 요약
    const next = g.soon[0];
    v.append(h('div', { class: 'card bk-head' },
      h('h3', null, '🎟️ 예약·발권 한눈에'),
      h('p', { class: 'muted small' }, `담당: ${who || '-'} · 2026년 11월 조사 기준 · 예약할 때 공식 화면에서 시간·요금 한 번 더 확인`),
      h('div', { class: 'progress' },
        h('div', { class: 'bar' }, h('i', { style: { width: must.length ? `${Math.round(mustDone / must.length * 100)}%` : '0%' } })),
        h('span', null, `꼭 할 예약 ${mustDone}/${must.length}`)),
      h('div', { class: 'bk-stats' },
        h('span', { class: 'bk-stat hot' }, h('b', null, String(g.now.length)), '지금 가능'),
        h('span', { class: 'bk-stat' }, h('b', null, String(g.soon.length)), '오픈 예정'),
        h('span', { class: 'bk-stat' }, h('b', null, String(g.site.length)), '현장 구매'),
        h('span', { class: 'bk-stat ok' }, h('b', null, String(g.done.length)), '완료')),
      next ? h('div', { class: 'bk-next' }, '⏰ 다음 오픈 ', h('b', null, `${mdLabel(next.opens)} · D-${dayDiff(today, next.opens)}`), ` — ${g.soon.filter(c => c.opens === next.opens).map(c => c.title).join(', ')}`) : null));

    const sec = (title, hint, list, opts = {}) => {
      if (!list.length) return;
      v.append(h('h3', { class: 'group-title' }, title, hint ? h('small', null, ` ${hint}`) : null));
      if (opts.byOpen) {
        // 오픈일별로 묶어서 달력처럼
        const days = [...new Set(list.map(c => c.opens))];
        for (const d of days) {
          const n = dayDiff(today, d);
          v.append(h('div', { class: 'card bk-day' },
            h('div', { class: 'bk-day-head' }, h('b', null, `${mdLabel(d)} 오픈`), h('span', { class: `pill ${n <= 3 ? 'hot' : 'soon'}` }, n === 0 ? '오늘!' : `D-${n}`)),
            list.filter(c => c.opens === d).map(c => this.bookRow(c, today))));
        }
      } else {
        v.append(h('div', { class: 'card bk-list' }, list.map(c => this.bookRow(c, today))));
      }
    };
    if (!this.store.canEdit) v.append(h('div', { class: 'card note-box' }, '체크 표시는 편집 권한(토큰)이 있어야 같이 저장돼요.'));
    sec('🔥 지금 예약하기', '이미 열렸거나 열리는 날이 정해지지 않은 것', g.now);
    sec('⏳ 오픈 예정', '이 날짜에 예약·판매가 열려요', g.soon, { byOpen: true });
    sec('🎫 현장에서 사요', '미리 예약 없음', g.site);
    sec('🤔 필요할 때만', '일정상 안 해도 되는 것', g.opt);
    sec('✅ 완료', '', g.done);
    if (!items.length) v.append(h('div', { class: 'card empty' }, '예약 항목이 없어요'));
    v.append(h('div', { class: 'list-end' }));
  }

  bookRow(c, today) {
    const NEED = { 필수: 'must', 권장: 'rec', 선택: 'opt', 현장: 'site', 확인: 'check' };
    let open = null;
    if (!c.done && !c.onsite && c.opens) {
      const n = dayDiff(today, c.opens);
      open = n > 0 ? h('span', { class: 'pill soon' }, `${mdLabel(c.opens)} 오픈`) : h('span', { class: 'pill open' }, n === 0 ? '오늘 오픈!' : '예약 가능');
    }
    const box = h('button', {
      class: `check-box ${c.done ? 'on' : ''}`, type: 'button', disabled: !this.store.canEdit,
      'aria-label': c.done ? '완료 취소' : '완료',
      onclick: () => this.store.commit({ type: 'check.update', id: c.id, patch: { done: !c.done, doneBy: this.store.me || '', doneAt: Date.now() } }),
    }, c.done ? '✓' : '');
    const ctx = this.richCtx();
    return h('div', { class: `bk-row ${c.done ? 'is-done' : ''}` },
      box,
      h('div', { class: 'bk-main' },
        h('div', { class: 'bk-title' }, c.title),
        h('div', { class: 'check-meta' },
          c.need ? h('span', { class: `pill need-${NEED[c.need] || 'check'}` }, c.need) : null,
          c.date ? h('span', { class: 'pill' }, `📅 ${mdLabel(c.date)} 방문`) : null,
          c.for ? h('span', { class: 'pill who' }, `👤 ${c.for}`) : null,
          open,
          c.done && c.doneBy ? h('span', { class: 'pill muted' }, `${c.doneBy} 완료`) : null),
        c.where ? h('div', { class: 'bk-line' }, '📱 ', inline(c.where, ctx)) : null,
        c.cost ? h('div', { class: 'bk-line' }, '💰 ', c.cost) : null,
        c.note ? h('details', { class: 'bk-note' }, h('summary', null, '자세히'), h('div', null, this.rich(c.note))) : null,
        c.link ? h('a', { class: 'chip', href: c.link, target: '_blank', rel: 'noopener' }, '🔗 예약/참고 링크') : null),
      this.editing ? h('button', { class: 'btn sm', type: 'button', onclick: () => E.editCheck(this, c) }, '✏️') : null);
  }

  // ── 준비 체크리스트 ───────────────────────────────────
  renderCheck() {
    const v = this.el.otherView;
    clear(v);
    const today = chinaToday();
    const people = (this.data.trip && this.data.trip.people) || [];
    if (this.checkWho == null) this.checkWho = this.store.me || '전체';
    const who = this.checkWho;
    v.append(h('div', { class: 'seg check-who' }, ['전체', ...people].map(p => h('button', {
      class: `seg-btn ${who === p ? 'on' : ''}`,
      type: 'button',
      onclick: () => { this.checkWho = p; this.render(); },
    }, p === '전체' ? '전체' : `${p}${p === this.store.me ? ' (나)' : ''}`))));
    // 담당이 나 / 둘 다 / 미정 인 것만
    const mine = c => who === '전체' || !c.who || c.who === '둘 다' || c.who === who;
    const items = (this.data.checklist || []).filter(c => !isBook(c)).filter(mine);
    const groups = { now: [], soon: [], onsite: [], done: [] };
    for (const c of items) {
      if (c.done) groups.done.push(c);
      else if (c.onsite) groups.onsite.push(c);
      else if (c.opens && c.opens > today) groups.soon.push(c);
      else groups.now.push(c);
    }
    const byDate = (a, b) => String(a.opens || a.date || '9').localeCompare(String(b.opens || b.date || '9'));
    groups.now.sort(byDate);
    groups.soon.sort(byDate);
    groups.onsite.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const sec = (title, list, hint) => {
      if (!list.length) return;
      v.append(h('h3', { class: 'group-title' }, title, hint ? h('small', null, ` ${hint}`) : null));
      v.append(h('div', { class: 'card check-list' }, list.map(c => this.checkRow(c, today))));
    };
    if (!this.store.canEdit) v.append(h('div', { class: 'card note-box' }, '체크 표시는 편집 권한(토큰)이 있어야 같이 저장돼요.'));
    sec('🔥 지금 할 것', groups.now, '예약이 열렸거나 날짜가 정해지지 않은 것');
    sec('⏳ 예약 오픈 예정', groups.soon);
    sec('🎟️ 현장 구매·무료', groups.onsite);
    sec('✅ 완료', groups.done);
    if (!items.length) v.append(h('div', { class: 'card empty' }, '항목이 없어요'));
    if (this.editing) v.append(h('button', { class: 'btn add-btn', type: 'button', onclick: () => E.editCheck(this, null) }, '➕ 항목 추가'));
    v.append(h('div', { class: 'list-end' }));
  }

  checkRow(c, today) {
    let status = null;
    if (!c.done && !c.onsite && c.opens) {
      const n = dayDiff(today, c.opens);
      if (n > 0) status = h('span', { class: 'pill soon' }, `D-${n} 오픈 (${mdLabel(c.opens)})`);
      else if (n === 0) status = h('span', { class: 'pill hot' }, '오늘 오픈!');
      else status = h('span', { class: 'pill open' }, `${mdLabel(c.opens)}부터 예약 가능`);
    }
    const box = h('button', {
      class: `check-box ${c.done ? 'on' : ''}`,
      type: 'button',
      disabled: !this.store.canEdit,
      'aria-label': c.done ? '완료 취소' : '완료',
      onclick: () => this.store.commit({ type: 'check.update', id: c.id, patch: { done: !c.done, doneBy: this.store.me || '', doneAt: Date.now() } }),
    }, c.done ? '✓' : '');
    return h('div', { class: `check-row ${c.done ? 'is-done' : ''}` },
      box,
      h('div', { class: 'check-main', onclick: this.editing ? () => E.editCheck(this, c) : null },
        h('div', { class: 'check-title' }, c.title),
        h('div', { class: 'check-meta' },
          c.who ? h('span', { class: 'pill who' }, c.who) : null,
          c.date ? h('span', { class: 'pill' }, `📅 ${mdLabel(c.date)}`) : null,
          c.onsite ? h('span', { class: 'pill' }, '현장') : null,
          status,
          c.done && c.doneBy ? h('span', { class: 'pill muted' }, `${c.doneBy} 완료`) : null),
        c.note ? h('div', { class: 'check-note' }, this.rich(c.note)) : null,
        c.link ? h('a', { class: 'chip', href: c.link, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, '🔗 예약/참고 링크') : null),
      this.editing ? h('button', { class: 'btn sm', type: 'button', onclick: () => E.editCheck(this, c) }, '✏️') : null);
  }

  // ── 설정 ──────────────────────────────────────────────
  openSettings() {
    const sheet = openSheet({ title: '설정', body: h('div') });
    const rebuild = () => clear(sheet.body).append(this.settingsBody(sheet, rebuild));
    rebuild();
  }

  settingsBody(sheet, rebuild) {
    const s = this.store;
    const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([val, label]) => h('button', {
      class: `seg-btn ${s.prefs[key] === val ? 'on' : ''}`,
      type: 'button',
      onclick: () => { s.setPref(key, val); rebuild(); },
    }, label)));
    const people = (this.data && this.data.trip && this.data.trip.people) || ['나', '친구'];
    const rateIn = h('input', { type: 'number', inputmode: 'numeric', value: String(s.rate), class: 'inp short' });
    const tileInfo = h('span', { class: 'muted' }, '');
    const storeLine = h('p', { class: 'muted' }, '확인 중…');
    s.storageInfo().then(i => {
      const mb = i.usage != null ? ` · 사용 ${(i.usage / 1048576).toFixed(1)}MB` : '';
      const keep = i.persisted === true ? '✅ 영구 보관 (브라우저가 지우지 않음)' : '⚠️ 일반 보관 (공간 부족하면 브라우저가 지울 수 있음 → 홈 화면에 추가하면 보통 영구 보관됨)';
      const m = this.data && this.data.meta;
      storeLine.textContent = `${keep}${mb}${m ? ` · 일정 버전 ${m.rev || 0}` : ''}`;
    }).catch(() => { storeLine.textContent = ''; });
    countCachedTiles().then(n => { tileInfo.textContent = `지금 저장된 지도 조각: ${n}장`; }).catch(() => {});
    const syncLine = s.status === 'auth'
      ? 'GitHub 토큰이 만료됐거나 권한이 없어요. PC에서 토큰을 다시 설정해야 해요.'
      : `${(SYNC_TEXT[s.status] || SYNC_TEXT.idle)[1]} · 마지막 동기화 ${s.lastSync ? timeAgo(s.lastSync) : '없음'}${s.pending.length ? ` · 저장 대기 ${s.pending.length}건` : ''}`;
    const meta = this.data && this.data.meta;
    const body = h('div', { class: 'settings' },
      h('label', { class: 'set-label' }, '나는 누구?'),
      h('div', { class: 'seg' }, people.map(p => h('button', {
        class: `seg-btn ${s.me === p ? 'on' : ''}`, type: 'button', onclick: () => { s.setMe(p); rebuild(); },
      }, p))),
      h('p', { class: 'muted' }, '수정 기록에 이름이 남고, 개별 일정 날에는 내 일정이 먼저 보여요.'),

      MAP.id === 'amap' ? h('label', { class: 'set-label' }, '고덕 길찾기 여는 방식') : null,
      MAP.id === 'amap' ? seg('linkMode', [['app', '고덕 앱 바로 열기'], ['web', '웹페이지로 열기']]) : null,
      MAP.id === 'amap' ? h('p', { class: 'muted' }, '안드로이드 폰에서는 고덕 앱이 바로 열려요. 아이폰·PC는 웹 고덕지도로 열리고, 앱이 깔려 있으면 거기서 앱으로 넘어가요. 안 열리면 "웹페이지로 열기"로 바꿔 보세요.') : null,

      h('label', { class: 'set-label' }, '내 위치'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { sheet.close(); setTimeout(() => this.openLocationHelp(), 120); } }, '📍 위치 권한 켜는 법'),

      h('label', { class: 'set-label' }, '지도 글자'),
      seg('lang', [['zh', '중문'], ['en', '영문']]),

      h('label', { class: 'set-label' }, '환율 (1위안 = ?원)'),
      h('div', { class: 'row' }, rateIn, h('button', { class: 'btn sm', type: 'button', onclick: () => { const n = parseFloat(rateIn.value); if (n > 0) { s.setPref('rate', n); toast('환율 저장'); } } }, '저장')),

      h('label', { class: 'set-label' }, '일정 업데이트 받기'),
      seg('sync', [['auto', '자동 (30초마다)'], ['manual', '내가 누를 때만']]),
      h('p', { class: 'muted' }, '"내가 누를 때만"이면 위쪽 [업데이트 받기]를 눌러야 새 일정을 받아요. 데이터를 아끼거나 화면이 갑자기 바뀌는 게 싫을 때. 내가 고친 내용은 인터넷이 될 때 자동으로 올라가요.'),

      h('label', { class: 'set-label' }, '동기화'),
      h('p', null, syncLine),
      meta && meta.updatedAt ? h('p', { class: 'muted' }, `일정 최종 수정: ${new Date(meta.updatedAt).toLocaleString('ko-KR')} (${meta.updatedBy || '?'}) · 버전 ${meta.rev || 0}`) : null,
      s.error && s.status !== 'ok' ? h('p', { class: 'muted small' }, String(s.error.message || s.error)) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { s.refresh({ force: true }); toast('새로 불러오는 중…'); } }, '↻ 지금 동기화'),
        s.pending.length ? h('button', {
          class: 'btn sm danger', type: 'button',
          onclick: async () => { if (await confirmSheet(`아직 저장 못 한 수정 ${s.pending.length}건을 버릴까요?`, { ok: '버리기', danger: true })) { s.discardPending(); toast('버렸어요'); } },
        }, '대기 중 수정 버리기') : null),
      !s.canEdit ? h('p', { class: 'muted' }, '이 앱에는 편집 토큰이 없어서 보기만 가능해요.') : null,

      h('label', { class: 'set-label' }, '이 기기에 저장된 일정'),
      storeLine,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => { if (s.exportBackup()) toast('백업 파일을 내려받았어요 (다운로드 폴더)'); } }, '💾 일정 백업 파일 받기')),
      h('p', { class: 'muted small' }, '일정은 이 폰 안(브라우저 저장소)에 저장돼서 인터넷이 없어도 열려요. 백업 파일은 비밀번호 없이 열리는 파일이니 공유하지 마세요.'),

      h('label', { class: 'set-label' }, '오프라인 지도'),
      h('p', { class: 'muted' }, '와이파이에서 미리 저장해 두면 인터넷이 끊겨도 지도가 보여요 (장소 주변만, 수십 MB).'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { sheet.close(); this.prefetchMap(); } }, '⬇ 지도 미리 저장'), tileInfo),

      h('label', { class: 'set-label' }, '잠금'),
      h('button', {
        class: 'btn sm danger', type: 'button',
        onclick: async () => {
          if (await confirmSheet('이 기기에서 잠글까요? 다시 열 때 여행 비밀번호가 필요해요.', { ok: '잠그기', danger: true })) {
            await s.lock();
            location.reload();
          }
        },
      }, '🔒 이 기기 잠그기'),
      h('p', { class: 'muted small' }, `앱 빌드 ${(s.cfg && s.cfg.build) || '-'}`),
    );
    return body;
  }

  async prefetchMap() {
    if (!this.data) return;
    if (!('caches' in window)) {
      toast('이 브라우저는 지도 저장을 지원하지 않아요');
      return;
    }
    const list = tilesForTrip(this.data, this.store.prefs.lang);
    const ok = await confirmSheet(`지도 조각 ${list.length}장 (약 ${Math.round(list.length * 22 / 1024)}MB)을 저장할게요. 와이파이에서 하세요.`, { ok: '저장 시작' });
    if (!ok) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const ctrl = new AbortController();
    const bar = h('i', { style: { width: '0%' } });
    const label = h('p', null, '준비 중…');
    const sheet = openSheet({
      title: '지도 저장 중',
      body: h('div', null, h('div', { class: 'progress' }, h('div', { class: 'bar' }, bar)), label),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => { ctrl.abort(); sheet.close(); } }, '중단')],
      onClose: () => ctrl.abort(),
    });
    const r = await prefetchTiles(list, (d, total, failed) => {
      bar.style.width = `${Math.round(d / total * 100)}%`;
      label.textContent = `${d} / ${total}${failed ? ` (실패 ${failed})` : ''}`;
    }, ctrl.signal);
    if (!ctrl.signal.aborted) {
      sheet.close();
      toast(r.failed ? `저장 완료 (실패 ${r.failed}장)` : '지도 저장 완료!', { ms: 4000 });
    }
  }

  askName() {
    const people = (this.data && this.data.trip && this.data.trip.people) || ['나', '친구'];
    const sheet = openSheet({
      title: '누구세요?',
      body: h('div', null,
        h('p', null, '수정 기록에 이름이 남아요. 나중에 설정에서 바꿀 수 있어요.'),
        h('div', { class: 'seg big' }, people.map(p => h('button', {
          class: 'seg-btn', type: 'button', onclick: () => { this.store.setMe(p); sheet.close(); },
        }, p)))),
    });
  }
}
