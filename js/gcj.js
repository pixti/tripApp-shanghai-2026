// GPS(WGS-84) 좌표 → 중국 지도(GCJ-02, 고덕 좌표) 변환
// 휴대폰 GPS 위치를 고덕 지도 위에 정확히 찍기 위해 필요
const A = 6378245.0;
const EE = 0.00669342162296594323;

// 중국 본토 대략 영역 [북, 서, 남, 동] — 한국·일본·대만 등은 보정하지 않음
const IN = [
  [49.2204, 79.4462, 42.8899, 96.3300],
  [54.1415, 109.6872, 39.3742, 135.0002],
  [42.8899, 73.1246, 29.5297, 124.143255],
  [29.5297, 82.9684, 26.7186, 97.0352],
  [29.5297, 97.0253, 20.414096, 124.367395],
  [20.414096, 107.975793, 17.871542, 111.744104],
];
const OUT = [
  [25.398623, 119.921265, 21.785006, 122.497559],
  [22.2840, 101.8652, 20.0988, 106.6650],
  [21.5422, 106.4525, 20.4878, 108.0510],
  [55.8175, 109.0323, 50.3257, 119.1270],
  [55.8175, 127.4568, 49.5574, 137.0227],
  [44.8922, 131.2662, 42.5692, 137.0227],
];
const inBox = (lat, lng, [n, w, s, e]) => lat <= n && lat >= s && lng >= w && lng <= e;

export function outOfChina(lat, lng) {
  if (!IN.some(b => inBox(lat, lng, b))) return true;
  return OUT.some(b => inBox(lat, lng, b));
}

function tLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return r;
}

function tLng(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return r;
}

export function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = tLat(lng - 105.0, lat - 35.0);
  let dLng = tLng(lng - 105.0, lat - 35.0);
  const rad = lat / 180.0 * Math.PI;
  let m = Math.sin(rad);
  m = 1 - EE * m * m;
  const s = Math.sqrt(m);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (m * s) * Math.PI);
  dLng = (dLng * 180.0) / (A / s * Math.cos(rad) * Math.PI);
  return [lat + dLat, lng + dLng];
}

export function distM(a, b) {
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = p2 - p1;
  const dl = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
