// 오프라인용 서비스워커: 앱 파일은 저장본 우선, 고덕 지도 타일은 한 번 본 것 저장
const VERSION = '2026-11-26T23-10-42';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const MAX_TILES = 6000;
// 장소 사진: 앱 버전과 따로 한 번만 저장 (업데이트마다 다시 받지 않음). 사진을 바꾸면 PHOTOS 이름의 숫자를 올리기
const PHOTOS = 'photos-v1';
const PHOTO_FILES = ["photos/hefang.jpg","photos/bund.jpg","photos/cruise.jpg","photos/gateeast.jpg","photos/hongqiao.jpg","photos/hzeast.jpg","photos/hzkpg.jpg","photos/lingyin.jpg","photos/liuhe.jpg","photos/liuyuan.jpg","photos/museum.jpg","photos/nanjingrd.jpg","photos/pearl.jpg","photos/peoplesq.jpg","photos/pingjiang.jpg","photos/pvg.jpg","photos/roastery.jpg","photos/shantang.jpg","photos/shstation.jpg","photos/shtower.jpg","photos/sihang.jpg","photos/szstation.jpg","photos/tianzifang.jpg","photos/westlake.jpg","photos/wukang.jpg","photos/yuyuan.jpg","photos/zhuozheng.jpg"];

const ASSETS = [
  './',
  'index.html',
  'config.js',
  'data/trip.enc.json',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'js/main.js',
  'js/store.js',
  'js/ui.js',
  'js/editor.js',
  'js/sheets.js',
  'js/map.js',
  'js/tiles.js',
  'js/amap.js',
  'js/gcj.js',
  'js/ops.js',
  'js/crypto.js',
  'js/github.js',
  'js/idb.js',
  'js/rich.js',
  'js/util.js',
  'js/consts.js',
  'js/providers.js',
  'js/guide.js',
  'js/sites.js',
  'js/photos.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if ((k.startsWith('shell-') && k !== SHELL) || (k.startsWith('photos-') && k !== PHOTOS)) await caches.delete(k);
    }
    await self.clients.claim();
    // 사진은 없는 것만 받기 (실패해도 괜찮음 — 화면에서 볼 때 다시 받음)
    const pc = await caches.open(PHOTOS);
    await Promise.all(PHOTO_FILES.map(async u => { if (!(await pc.match(u))) await pc.add(u).catch(() => {}); }));
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// js/tiles.js 의 tileKey 와 같아야 함
function tileKey(url) {
  if (url.hostname === 'tile.openstreetmap.org') {
    const [, z, x, y] = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/) || [];
    return `https://tiles.local/osm/${z}/${x}/${y}`;
  }
  const p = url.searchParams;
  return `https://tiles.local/${p.get('z')}/${p.get('x')}/${p.get('y')}/${p.get('lang') || 'zh_cn'}/7`;
}

let putCount = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  for (const k of keys.slice(0, keys.length - MAX_TILES + 500)) await cache.delete(k);
}

async function tile(req, url) {
  const cache = await caches.open(TILES);
  const key = tileKey(url);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') {
      await cache.put(key, res.clone());
      if (++putCount % 200 === 0) trimTiles(cache);
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if ((url.hostname.endsWith('.is.autonavi.com') && url.pathname === '/appmaptile') || url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tile(req, url));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/data/trip.enc.json')) {
    // 일정 저장본: 인터넷 되면 최신, 안 되면 저장해 둔 것
    e.respondWith(fetch(req).then(async res => {
      if (res.ok) (await caches.open(SHELL)).put('data/trip.enc.json', res.clone());
      return res;
    }).catch(() => caches.match('data/trip.enc.json')));
    return;
  }
  if (url.pathname.includes('/photos/')) {
    e.respondWith(caches.open(PHOTOS).then(async c => (await c.match(req, { ignoreSearch: true })) || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
