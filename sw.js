// 오프라인용 서비스워커: 앱 파일은 저장본 우선, 고덕 지도 타일은 한 번 본 것 저장
const VERSION = '2026-11-21T15-48-20';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const MAX_TILES = 6000;

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
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
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
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
