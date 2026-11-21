// 앱 안 지도 (Leaflet). 타일·좌표계는 providers.js 의 MAP 을 따름
/* global L */
import { MAP, hasPos } from './providers.js';

const SHANGHAI = [31.2304, 121.4737];
const CORE_SKIP = new Set(['hotel', 'station', 'airport', 'transit']);

function tileLayer(lang) {
  const t = MAP.tiles;
  return L.tileLayer(t.template(lang), {
    subdomains: t.subdomains.length ? t.subdomains : 'abc',
    minZoom: 3,
    maxZoom: 19,
    maxNativeZoom: t.maxNativeZoom,
    crossOrigin: true,
    attribution: t.attribution,
  });
}

export class TripMap {
  constructor(el, { lang = 'zh', onMarker } = {}) {
    this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView(SHANGHAI, 12);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    this.lang = lang === 'en' ? 'en' : 'zh';
    this.tiles = tileLayer(this.lang).addTo(this.map);
    this.group = L.layerGroup().addTo(this.map);
    this.markers = new Map();
    this.onMarker = onMarker;
    this.bounds = null;
    this.watchId = null;
    this.myPos = null;
  }

  // 지도 제공자가 바뀌었을 때 타일 다시 깔기
  resetTiles() {
    this.map.removeLayer(this.tiles);
    this.tiles = tileLayer(this.lang).addTo(this.map);
  }

  setLang(lang) {
    const l = lang === 'en' ? 'en' : 'zh';
    if (l === this.lang) return;
    this.lang = l;
    this.map.removeLayer(this.tiles);
    this.tiles = tileLayer(l).addTo(this.map);
  }

  setStops(stops, { nextId = null, done = new Set(), fit = true } = {}) {
    this.group.clearLayers();
    this.markers.clear();
    const pts = [];
    const core = [];
    stops.forEach((s, i) => {
      if (!hasPos(s)) return;
      const cls = ['pin', `cat-${s.cat || 'etc'}`];
      if (s.skip) cls.push('skip');
      if (done.has(s.id)) cls.push('done');
      if (s.id === nextId) cls.push('next');
      const icon = L.divIcon({
        className: 'pin-wrap',
        html: `<div class="${cls.join(' ')}"><span>${i + 1}</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const m = L.marker([s.lat, s.lng], {
        icon,
        title: s.name,
        keyboard: false,
        zIndexOffset: s.id === nextId ? 1000 : (done.has(s.id) ? -100 : 0),
      }).addTo(this.group);
      m.on('click', () => this.onMarker && this.onMarker(s.id));
      this.markers.set(s.id, m);
      if (!s.skip) {
        pts.push([s.lat, s.lng]);
        if (!CORE_SKIP.has(s.cat)) core.push([s.lat, s.lng]);
      }
    });
    if (pts.length > 1) {
      L.polyline(pts, { color: '#1f6feb', weight: 3, opacity: 0.7, dashArray: '6 8', interactive: false }).addTo(this.group);
    }
    this.bounds = pts.length ? L.latLngBounds(pts) : null;
    // 숙소·역·공항을 빼고 실제 구경하는 곳 위주로 화면 맞춤 (쑤저우·항저우 가는 날 등)
    this.coreBounds = core.length >= 2 ? L.latLngBounds(core) : this.bounds;
    if (fit) this.fit();
  }

  fit(all = false) {
    const b = all ? this.bounds : (this.coreBounds || this.bounds);
    if (!b) return;
    if (b.getNorthEast().equals(b.getSouthWest())) this.map.setView(b.getCenter(), 15);
    else this.map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
  }

  focus(id) {
    const m = this.markers.get(id);
    if (!m) return false;
    this.map.setView(m.getLatLng(), Math.max(this.map.getZoom(), 15), { animate: true });
    const el = m.getElement() && m.getElement().firstElementChild;
    if (el) {
      el.classList.remove('bounce');
      void el.offsetWidth;
      el.classList.add('bounce');
    }
    return true;
  }

  invalidate() {
    this.map.invalidateSize();
  }

  get locating() {
    return this.watchId != null;
  }

  startLocate(onUpdate, onError) {
    if (!navigator.geolocation) {
      if (onError) onError('이 기기에서는 위치를 쓸 수 없어요');
      return;
    }
    this.stopLocate();
    let first = true;
    this.watchId = navigator.geolocation.watchPosition(p => {
      const [lat, lng] = MAP.fromGps(p.coords.latitude, p.coords.longitude);
      const ll = [lat, lng];
      if (!this.me) {
        this.meAcc = L.circle(ll, { radius: p.coords.accuracy || 30, color: '#1f6feb', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.map);
        this.me = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1f6feb', fillOpacity: 1, interactive: false }).addTo(this.map);
      } else {
        this.me.setLatLng(ll);
        this.meAcc.setLatLng(ll).setRadius(p.coords.accuracy || 30);
      }
      if (first) {
        this.map.setView(ll, Math.max(this.map.getZoom(), 15));
        first = false;
      }
      this.myPos = { lat, lng };
      if (onUpdate) onUpdate(this.myPos);
    }, err => {
      this.stopLocate();
      if (onError) onError(err && err.code === 1 ? '위치 권한이 꺼져 있어요 (브라우저 설정에서 허용)' : '위치를 찾지 못했어요');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  stopLocate() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.me) this.me.remove();
    if (this.meAcc) this.meAcc.remove();
    this.me = null;
    this.meAcc = null;
  }
}

// 편집 화면용: 지도를 눌러 위치 고르기
export class PickerMap {
  constructor(el, { lat, lng, lang = 'zh', context = [], onPick } = {}) {
    const start = Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : (context[0] ? [context[0].lat, context[0].lng] : SHANGHAI);
    this.map = L.map(el, { zoomControl: true, attributionControl: false }).setView(start, Number.isFinite(lat) ? 16 : 13);
    tileLayer(lang).addTo(this.map);
    for (const c of context) {
      L.circleMarker([c.lat, c.lng], { radius: 5, color: '#8b95a7', weight: 2, fillOpacity: 0.6, interactive: false }).addTo(this.map);
    }
    this.marker = null;
    this.onPick = onPick;
    if (Number.isFinite(lat) && Number.isFinite(lng)) this.set(lat, lng, false);
    this.map.on('click', e => this.set(e.latlng.lat, e.latlng.lng, true));
    setTimeout(() => this.map.invalidateSize(), 250);
  }

  set(lat, lng, notify) {
    if (!this.marker) {
      this.marker = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'pin-wrap', html: '<div class="pin next"><span>●</span></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(this.map);
      this.marker.on('dragend', () => {
        const p = this.marker.getLatLng();
        if (this.onPick) this.onPick(p.lat, p.lng);
      });
    } else {
      this.marker.setLatLng([lat, lng]);
    }
    if (notify && this.onPick) this.onPick(lat, lng);
  }

  center(lat, lng) {
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 16));
  }

  destroy() {
    this.map.remove();
  }
}
