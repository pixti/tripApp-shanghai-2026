// 지도 타일 오프라인용 미리 저장 (타일 주소는 providers.js 의 MAP 이 정함)
import { MAP, hasPos } from './providers.js';

export const TILE_CACHE = 'tiles-v1';

function lng2x(lng, z) {
  return Math.floor((lng + 180) / 360 * 2 ** z);
}

function lat2y(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
}

export function tilesForTrip(data, lang, { zooms = [14, 15, 16], radius = 1, overview = [11, 12, 13] } = {}) {
  const map = new Map();
  const add = (x, y, z) => {
    const k = `${z}/${x}/${y}`;
    if (!map.has(k)) map.set(k, { url: MAP.tiles.url(x, y, z, lang), key: MAP.tiles.key(x, y, z, lang) });
  };
  for (const day of data.days || []) {
    for (const t of day.tracks || []) {
      const pts = (t.stops || []).filter(hasPos);
      for (const s of pts) {
        for (const z of zooms) {
          const cx = lng2x(s.lng, z);
          const cy = lat2y(s.lat, z);
          for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) add(cx + dx, cy + dy, z);
          }
        }
      }
      if (pts.length) {
        const lats = pts.map(p => p.lat);
        const lngs = pts.map(p => p.lng);
        for (const z of overview) {
          const x0 = lng2x(Math.min(...lngs), z);
          const x1 = lng2x(Math.max(...lngs), z);
          const y0 = lat2y(Math.max(...lats), z);
          const y1 = lat2y(Math.min(...lats), z);
          if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) continue;
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(x, y, z);
        }
      }
    }
  }
  return [...map.values()];
}

export async function prefetchTiles(list, onProgress, signal) {
  const cache = await caches.open(TILE_CACHE);
  const queue = list.slice();
  let done = 0;
  let failed = 0;
  async function worker() {
    while (queue.length) {
      if (signal && signal.aborted) return;
      const t = queue.shift();
      try {
        const hit = await cache.match(t.key);
        if (!hit) {
          const r = await fetch(t.url, { mode: 'cors' });
          if (r.ok) await cache.put(t.key, r);
          else failed++;
        }
      } catch {
        failed++;
      }
      done++;
      if (onProgress) onProgress(done, list.length, failed);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { done, failed };
}

export async function countCachedTiles() {
  if (!('caches' in self)) return 0;
  const cache = await caches.open(TILE_CACHE);
  return (await cache.keys()).length;
}
