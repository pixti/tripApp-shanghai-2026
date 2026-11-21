// 단위 테스트: node tools/test/unit.mjs
import assert from 'node:assert/strict';
import * as C from '../../js/crypto.js';
import { applyOps, describeOps } from '../../js/ops.js';
import * as A from '../../js/amap.js';
import { wgs2gcj, distM } from '../../js/gcj.js';

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    console.log(`  ✖ ${name}\n    ${e.stack || e}`);
    process.exitCode = 1;
  }
}

console.log('crypto');
await t('JSON 암호화 왕복 (gzip, 한글/중문)', async () => {
  const key = await C.deriveKey('여행 비번 ✈', C.newSalt(), 1000);
  const obj = { a: '상하이 测试酒店', n: [1, 2, 3], big: 'x'.repeat(100000) };
  const file = await C.sealJSON(key, obj);
  assert.equal(JSON.parse(file).z, 'gzip');
  assert.ok(!file.includes('상하이'));
  assert.deepEqual(await C.openJSON(key, file), obj);
});
await t('틀린 비밀번호는 열리지 않음', async () => {
  const salt = C.newSalt();
  const k1 = await C.deriveKey('right', salt, 1000);
  const k2 = await C.deriveKey('wrong', salt, 1000);
  const box = await C.sealText(k1, 'token-123');
  assert.equal(await C.openText(k1, box), 'token-123');
  await assert.rejects(() => C.openText(k2, box));
});
await t('비밀번호 앞뒤 공백·유니코드 정규화', async () => {
  const salt = C.newSalt();
  const k1 = await C.deriveKey(' 상하이 ', salt, 1000);
  const k2 = await C.deriveKey('상하이'.normalize('NFD'), salt, 1000);
  const box = await C.sealText(k1, 'ok');
  assert.equal(await C.openText(k2, box), 'ok');
});

console.log('ops (동시 수정 합치기)');
const base = () => ({
  meta: { rev: 1 },
  days: [{ id: 'd1', title: 'A', tracks: [{ id: 'all', stops: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] }] }],
  checklist: [{ id: 'k1', title: 'K', done: false }],
  info: [{ id: 'i1', title: 'I1' }, { id: 'i2', title: 'I2' }],
});
const names = d => d.days[0].tracks[0].stops.map(s => s.id).join('');
await t('추가/이동/삭제', () => {
  let { data } = applyOps(base(), [{ type: 'stop.add', day: 'd1', track: 'all', after: 'a', stop: { id: 'x', name: 'X' } }]);
  assert.equal(names(data), 'axbc');
  ({ data } = applyOps(data, [{ type: 'stop.move', day: 'd1', track: 'all', stopId: 'c', after: null }]));
  assert.equal(names(data), 'caxb');
  ({ data } = applyOps(data, [{ type: 'stop.delete', day: 'd1', track: 'all', stopId: 'x' }]));
  assert.equal(names(data), 'cab');
});
await t('같은 수정을 두 번 적용해도 결과 같음 (멱등)', () => {
  const ops = [
    { type: 'stop.add', day: 'd1', track: 'all', after: 'b', stop: { id: 'x', name: 'X' } },
    { type: 'stop.move', day: 'd1', track: 'all', stopId: 'a', after: 'c' },
    { type: 'stop.delete', day: 'd1', track: 'all', stopId: 'b' },
    { type: 'check.update', id: 'k1', patch: { done: true } },
  ];
  const once = applyOps(base(), ops).data;
  const twice = applyOps(once, ops).data;
  assert.deepEqual(twice, once);
  assert.equal(names(once), 'xca');
});
await t('상대가 먼저 고친 것 위에 내 수정 다시 적용 → 둘 다 남음', () => {
  const server = applyOps(base(), [{ type: 'stop.update', day: 'd1', track: 'all', stopId: 'a', patch: { time: '10:00' } }]).data;
  const mine = [{ type: 'stop.update', day: 'd1', track: 'all', stopId: 'a', patch: { name: 'A2' } }, { type: 'check.update', id: 'k1', patch: { done: true } }];
  const { data, rejected } = applyOps(server, mine);
  assert.equal(rejected.length, 0);
  assert.equal(data.days[0].tracks[0].stops[0].time, '10:00');
  assert.equal(data.days[0].tracks[0].stops[0].name, 'A2');
  assert.equal(data.checklist[0].done, true);
});
await t('상대가 지운 장소를 고치면 거절 목록으로', () => {
  const server = applyOps(base(), [{ type: 'stop.delete', day: 'd1', track: 'all', stopId: 'b' }]).data;
  const { rejected } = applyOps(server, [{ type: 'stop.update', day: 'd1', track: 'all', stopId: 'b', patch: { name: 'B2' } }]);
  assert.equal(rejected.length, 1);
});
await t('허용 안 된 필드는 무시', () => {
  const { data } = applyOps(base(), [{ type: 'stop.update', day: 'd1', track: 'all', stopId: 'a', patch: { id: 'hack', name: 'ok', evil: 1 } }]);
  const s = data.days[0].tracks[0].stops[0];
  assert.equal(s.id, 'a');
  assert.equal(s.name, 'ok');
  assert.equal(s.evil, undefined);
});
await t('원본은 바뀌지 않음', () => {
  const b = base();
  applyOps(b, [{ type: 'stop.delete', day: 'd1', track: 'all', stopId: 'a' }]);
  assert.equal(names(b), 'abc');
});
await t('정보 섹션 이동', () => {
  const { data } = applyOps(base(), [{ type: 'info.move', id: 'i1', after: 'i2' }]);
  assert.deepEqual(data.info.map(x => x.id), ['i2', 'i1']);
});
await t('수정 기록 메시지', () => {
  const msg = describeOps([{ type: 'stop.update', day: 'd1', track: 'all', stopId: 'b', patch: { time: '1' } }, { type: 'check.update', id: 'k1', patch: { done: true } }], base());
  assert.equal(msg, 'Day1 B 수정 외 1건');
});

console.log('고덕 링크');
const hotel = { name: '숙소', zh: '测试酒店', lat: 31.20912, lng: 121.520476 };
const park = { name: '루쉰공원', zh: '上海鲁迅公园', lat: 31.271766, lng: 121.483535 };
await t('길찾기 (앱 → intent, 현재위치 출발)', () => {
  const u = A.routeUrl(park, { kind: 'transit', linkMode: 'app' });
  assert.ok(u.startsWith('intent://route/plan/?sourceApplication=tripplanner&dlat=31.271766&dlon=121.483535&dname=%E4%B8%8A'));
  assert.ok(u.includes('&dev=0&t=1#Intent;scheme=amapuri;package=com.autonavi.minimap;S.browser_fallback_url=https%3A%2F%2Furi.amap.com%2Fnavigation%3F'));
  assert.ok(!u.includes('slat='));
  assert.ok(u.endsWith(';end'));
});
await t('길찾기 (출발지 지정, 도보)', () => {
  const u = A.routeUrl(park, { from: hotel, kind: 'walk', linkMode: 'app' });
  assert.ok(u.includes('slat=31.209120&slon=121.520476&sname=%E6%B5%8B%E8%AF%95%E9%85%92%E5%BA%97'));
  assert.ok(u.includes('&t=2#Intent'));
});
await t('길찾기 (웹)', () => {
  const u = A.routeUrl(park, { from: hotel, kind: 'transit', linkMode: 'web' });
  const q = new URL(u).searchParams;
  assert.equal(new URL(u).host, 'uri.amap.com');
  assert.equal(q.get('from'), '121.520476,31.209120,测试酒店');
  assert.equal(q.get('to'), '121.483535,31.271766,上海鲁迅公园');
  assert.equal(q.get('mode'), 'bus');
  assert.equal(q.get('coordinate'), 'gaode');
  assert.equal(q.get('callnative'), '1');
});
await t('위치 보기 / 검색', () => {
  const m = A.markerUrl(park, { linkMode: 'app' });
  assert.ok(m.startsWith('intent://viewMap?sourceApplication=tripplanner&poiname='));
  assert.ok(m.includes('&lat=31.271766&lon=121.483535&dev=0#Intent;scheme=androidamap;package=com.autonavi.minimap;'));
  const s = A.searchUrl(park, { linkMode: 'app' });
  assert.ok(s.startsWith('intent://poi?sourceApplication=tripplanner&keywords='));
  assert.ok(s.includes('scheme=androidamap'));
  const w = new URL(A.searchUrl(park, { linkMode: 'web' }));
  assert.equal(w.searchParams.get('keyword'), '上海鲁迅公园');
  assert.equal(w.searchParams.get('center'), '121.483535,31.271766');
});
await t('전체 보기 (최대 10곳, 건너뛴 곳 제외)', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ zh: `p${i}`, lat: 31 + i / 100, lng: 121, skip: i === 0 }));
  const u = new URL(A.multiMarkerUrl(many));
  const pts = u.searchParams.get('markers').split('|');
  assert.equal(pts.length, 10);
  assert.ok(pts[0].endsWith(',p1'));
});
await t('붙여넣은 디스코드 고덕 링크에서 좌표 뽑기', () => {
  const ssr = 'https://www.amap.com/ssr/dir?fname=测试酒店&flat=31.209120&flon=121.520476&dname=上海鲁迅公园&dlat=31.271766&dlon=121.483535&fid=B0HU1ZB1NA-from&type=1';
  assert.deepEqual(A.parseCoords(ssr), { lat: 31.271766, lng: 121.483535, name: '上海鲁迅公园' });
  const dir = 'https://www.amap.com/dir?from%5Bid%5D=B00155IMN4-from&from%5Bname%5D=南翔馒头店&from%5Blnglat%5D=121.491510%2C31.226577&to%5Bid%5D=BV10030419-to&to%5Bname%5D=豫园(地铁站)&to%5Blnglat%5D=121.487426%2C31.228005&type=walk';
  const p = A.parseCoords(dir);
  assert.equal(p.lat, 31.228005);
  assert.equal(p.lng, 121.487426);
  assert.equal(p.name, '豫园(地铁站)');
  assert.deepEqual(A.parseCoords('31.2304, 121.4737'), { lat: 31.2304, lng: 121.4737, name: undefined });
  assert.deepEqual(A.parseCoords('121.4737,31.2304'), { lat: 31.2304, lng: 121.4737, name: undefined });
  assert.equal(A.parseCoords('그냥 글자'), null);
});

console.log('좌표 변환');
await t('GPS → 고덕 좌표 (상하이 오차 약 500m 보정)', () => {
  const [lat, lng] = wgs2gcj(31.2304, 121.4737);
  const d = distM({ lat: 31.2304, lng: 121.4737 }, { lat, lng });
  assert.ok(d > 300 && d < 700, `offset ${d}`);
});
await t('한국(대구)·대만은 보정하지 않음, 쑤저우·항저우는 보정', () => {
  assert.deepEqual(wgs2gcj(35.87, 128.6), [35.87, 128.6]);
  assert.deepEqual(wgs2gcj(25.03, 121.56), [25.03, 121.56]);
  assert.notDeepEqual(wgs2gcj(31.32, 120.62), [31.32, 120.62]);
  assert.notDeepEqual(wgs2gcj(30.25, 120.15), [30.25, 120.15]);
});

console.log(`\n${passed}개 통과${process.exitCode ? ' · 실패 있음' : ''}`);
