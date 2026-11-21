// 고덕지도(Amap) 링크 만들기
// - 'app' 모드: 안드로이드 크롬에서 고덕 앱을 바로 연다 (앱이 없으면 웹페이지로 대체)
// - 'web' 모드: uri.amap.com 웹페이지로 연다
// 좌표는 모두 GCJ-02(고덕 좌표) 기준 → dev=0 / coordinate=gaode
const PKG = 'com.autonavi.minimap';
const SRC = 'tripplanner';
const enc = encodeURIComponent;

function qs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${enc(v)}`)
    .join('&');
}

const fix = n => Number(n).toFixed(6);

const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
export const IS_ANDROID = /Android/i.test(UA);
export const IS_MOBILE = /Android|iPhone|iPad|Mobile/i.test(UA);

export function hasPos(s) {
  return !!s && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

export function placeName(s) {
  return String((s && (s.zh || s.name)) || '').trim();
}

// 이동수단 → 고덕 경로 종류
export function routeKind(moveMode) {
  if (moveMode === 'walk') return 'walk';
  if (moveMode === 'taxi') return 'car';
  return 'transit';
}

const APP_T = { car: 0, transit: 1, walk: 2 };
const WEB_MODE = { car: 'car', transit: 'bus', walk: 'walk' };

function intent(path, query, scheme, fallback) {
  return `intent://${path}?${query}#Intent;scheme=${scheme};package=${PKG};S.browser_fallback_url=${enc(fallback)};end`;
}

// 길찾기: from 생략 시 "현재 위치"에서 출발
export function routeUrl(to, { from = null, kind = 'transit', linkMode = 'app', desktop = false } = {}) {
  // PC는 '현재 위치' 출발 길찾기가 안 되므로 위치 표시로 대신
  if (linkMode !== 'app' && desktop && !from) return markerUrl(to, { linkMode: 'web' });
  const web = 'https://uri.amap.com/navigation?' + qs({
    from: from ? `${fix(from.lng)},${fix(from.lat)},${placeName(from)}` : undefined,
    to: `${fix(to.lng)},${fix(to.lat)},${placeName(to)}`,
    mode: WEB_MODE[kind] || 'bus',
    policy: 0,
    src: SRC,
    coordinate: 'gaode',
    callnative: 1,
  });
  if (linkMode !== 'app') return web;
  const q = qs({
    sourceApplication: SRC,
    slat: from ? fix(from.lat) : undefined,
    slon: from ? fix(from.lng) : undefined,
    sname: from ? placeName(from) : undefined,
    dlat: fix(to.lat),
    dlon: fix(to.lng),
    dname: placeName(to),
    dev: 0,
    t: APP_T[kind] ?? 1,
  });
  return intent('route/plan/', q, 'amapuri', web);
}

// 지도에 위치 표시
export function markerUrl(s, { linkMode = 'app' } = {}) {
  const web = 'https://uri.amap.com/marker?' + qs({
    position: `${fix(s.lng)},${fix(s.lat)}`,
    name: placeName(s),
    src: SRC,
    coordinate: 'gaode',
    callnative: 1,
  });
  if (linkMode !== 'app') return web;
  const q = qs({ sourceApplication: SRC, poiname: placeName(s), lat: fix(s.lat), lon: fix(s.lng), dev: 0 });
  return intent('viewMap', q, 'androidamap', web);
}

// 이름으로 검색 (좌표가 있으면 그 주변에서)
export function searchUrl(s, { linkMode = 'app' } = {}) {
  const kw = placeName(s);
  const web = 'https://uri.amap.com/search?' + qs({
    keyword: kw,
    center: hasPos(s) ? `${fix(s.lng)},${fix(s.lat)}` : undefined,
    view: 'map',
    src: SRC,
    callnative: 1,
  });
  if (linkMode !== 'app') return web;
  const box = hasPos(s)
    ? { lat1: fix(s.lat + 0.05), lon1: fix(s.lng - 0.05), lat2: fix(s.lat - 0.05), lon2: fix(s.lng + 0.05) }
    : {};
  const q = qs({ sourceApplication: SRC, keywords: kw, ...box, dev: 0 });
  return intent('poi', q, 'androidamap', web);
}

// 하루 일정 전체를 고덕 웹지도에 표시 (최대 10곳)
export function multiMarkerUrl(stops) {
  const pts = stops
    .filter(s => hasPos(s) && !s.skip)
    .slice(0, 10)
    .map(s => `${fix(s.lng)},${fix(s.lat)},${placeName(s).replace(/[|,]/g, ' ')}`);
  return 'https://uri.amap.com/marker?' + qs({ markers: pts.join('|'), src: SRC, callnative: 0 });
}

export function isIntent(url) {
  return String(url).startsWith('intent:');
}

// 붙여넣은 고덕 링크/텍스트에서 좌표 뽑기 → {lat, lng, name?} 또는 null
export function parseCoords(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let decoded = t;
  try { decoded = decodeURIComponent(t.replace(/\+/g, ' ')); } catch { /* 그대로 */ }
  const num = '(-?\\d{1,3}\\.\\d+)';
  const tries = [
    [new RegExp(`dlat=${num}[^]*?dlon=${num}`), 'latlng'],
    [new RegExp(`dlon=${num}[^]*?dlat=${num}`), 'lnglat'],
    [new RegExp(`[?&]lat=${num}[^]*?[?&]lon=${num}`), 'latlng'],
    [new RegExp(`(?:to\\[lnglat\\]|lnglat|position|markers|to|center)=${num},${num}`), 'lnglat'],
    [new RegExp(`@${num},${num}`), 'latlng'],
    [new RegExp(`${num}\\s*,\\s*${num}`), 'auto'],
  ];
  for (const [re, order] of tries) {
    const m = decoded.match(re);
    if (!m) continue;
    let a = parseFloat(m[1]);
    let b = parseFloat(m[2]);
    let lat;
    let lng;
    if (order === 'latlng') [lat, lng] = [a, b];
    else if (order === 'lnglat') [lat, lng] = [b, a];
    else if (Math.abs(a) <= 60 && Math.abs(b) > 60) [lat, lng] = [a, b];
    else [lat, lng] = [b, a];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const nm = decoded.match(/[?&]dname=([^&]+)/) || decoded.match(/to\[name\]=([^&]+)/) || decoded.match(/[?&]name=([^&]+)/);
    return { lat, lng, name: nm ? nm[1].trim() : undefined };
  }
  return null;
}
