// 지도 제공자 — 여행지에 맞춰 갈아 끼우는 부분
//   일정 데이터 trip.map 값으로 선택: 'amap'(중국, 고덕) | 'google'(일본 등 그 밖, 구글 지도 + 오픈스트리트맵 타일)
// 앱 화면 코드는 여기 있는 MAP 만 사용하므로, 새 나라는 provider 하나만 추가하면 됨.
import * as A from './amap.js';
import { wgs2gcj } from './gcj.js';

const enc = encodeURIComponent;
const fix = n => Number(n).toFixed(6);

// ── 중국: 고덕지도 ───────────────────────────────────────
const AMAP_TILE = 'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang={lang}&size=1&scl=1&style=7';
const amapLang = l => (l === 'en' ? 'en' : 'zh_cn');

const amap = {
  id: 'amap',
  name: '고덕',
  fullName: '고덕지도',
  stationWord: '地铁站',
  // 휴대폰 GPS(WGS-84) → 이 지도 좌표 (중국은 GCJ-02)
  fromGps: (lat, lng) => wgs2gcj(lat, lng),
  tiles: {
    langs: true, // 중문/영문 전환 가능
    template: lang => AMAP_TILE.replace('{lang}', amapLang(lang)),
    subdomains: ['1', '2', '3', '4'],
    maxNativeZoom: 18,
    attribution: '© 高德地图',
    url(x, y, z, lang) {
      const s = this.subdomains[Math.abs(x + y) % this.subdomains.length];
      return AMAP_TILE.replace('{s}', s).replace('{x}', x).replace('{y}', y).replace('{z}', z).replace('{lang}', amapLang(lang));
    },
    // sw.js 의 tileKey 와 같아야 함
    key: (x, y, z, lang) => `https://tiles.local/${z}/${x}/${y}/${amapLang(lang)}/7`,
  },
  route: (to, o) => A.routeUrl(to, o),
  marker: (s, o) => A.markerUrl(s, o),
  search: (s, o) => A.searchUrl(s, o),
  nearStation: (s, o) => A.searchUrl({ zh: '地铁站', lat: s.lat, lng: s.lng }, o),
  multi: stops => A.multiMarkerUrl(stops),
};

// ── 그 밖(일본 등): 구글 지도 링크 + 오픈스트리트맵 타일 (키 필요 없음) ──
const OSM_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const gName = s => String((s && (s.zh || s.name)) || '').trim();
const gMode = { transit: 'transit', walk: 'walking', car: 'driving' };
const gPos = s => `${fix(s.lat)},${fix(s.lng)}`;

const google = {
  id: 'google',
  name: '구글',
  fullName: '구글 지도',
  stationWord: '駅',
  fromGps: (lat, lng) => [lat, lng],
  tiles: {
    langs: false,
    template: () => OSM_TILE,
    subdomains: [],
    maxNativeZoom: 19,
    attribution: '© OpenStreetMap',
    url: (x, y, z) => OSM_TILE.replace('{x}', x).replace('{y}', y).replace('{z}', z),
    key: (x, y, z) => `https://tiles.local/osm/${z}/${x}/${y}`,
  },
  // 구글 지도 공식 URL — 안드로이드·아이폰 모두 구글 지도 앱이 있으면 앱으로 열림
  route(to, { from = null, kind = 'transit' } = {}) {
    let u = `https://www.google.com/maps/dir/?api=1&destination=${gPos(to)}&travelmode=${gMode[kind] || 'transit'}`;
    if (from) u += `&origin=${gPos(from)}`;
    return u;
  },
  marker: s => `https://www.google.com/maps/search/?api=1&query=${gPos(s)}`,
  search: s => `https://www.google.com/maps/search/?api=1&query=${enc(gName(s))}`,
  nearStation: s => `https://www.google.com/maps/search/${enc('駅')}/@${gPos(s)},16z`,
  multi(stops) {
    const pts = stops.filter(s => A.hasPos(s) && !s.skip).slice(0, 10);
    if (pts.length < 2) return pts[0] ? google.marker(pts[0]) : 'https://www.google.com/maps';
    const mid = pts.slice(1, -1).map(gPos).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${gPos(pts[0])}&destination=${gPos(pts[pts.length - 1])}${mid ? `&waypoints=${enc(mid)}` : ''}&travelmode=transit`;
  },
};

export const PROVIDERS = { amap, google };

// 현재 지도 (다른 모듈에서 import 해도 바뀐 값이 그대로 보임)
export let MAP = amap;

export function setProvider(id) {
  MAP = PROVIDERS[id] || amap;
  return MAP;
}

export const hasPos = A.hasPos;
export const routeKind = A.routeKind;
export const isIntent = A.isIntent;
export const IS_ANDROID = A.IS_ANDROID;
export const IS_MOBILE = A.IS_MOBILE;
