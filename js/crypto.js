// 일정 데이터/토큰 암호화 (브라우저와 Node 양쪽에서 같은 코드 사용)
// 비밀번호 → PBKDF2-SHA256 → AES-GCM 256bit 키
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_ITER = 600000;

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(String(b64).replace(/\s/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function newSalt() {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
}

export function normPass(p) {
  return String(p ?? '').normalize('NFC').trim();
}

export async function deriveKey(pass, saltB64, iter = KDF_ITER, extractable = false) {
  const base = await crypto.subtle.importKey('raw', te.encode(normPass(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64), iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

export async function sealText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return { iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

export async function openText(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.ct));
  return td.decode(pt);
}

async function pipeBytes(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 일정 파일: {"v":1,"z":"gzip","iv":"…","ct":"…"} (JSON → gzip → AES-GCM)
export async function sealJSON(key, obj) {
  const raw = te.encode(JSON.stringify(obj));
  let z = null;
  let payload = raw;
  if (typeof CompressionStream !== 'undefined') {
    payload = await pipeBytes(raw, new CompressionStream('gzip'));
    z = 'gzip';
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload));
  return JSON.stringify({ v: 1, z, iv: bytesToB64(iv), ct: bytesToB64(ct) });
}

export async function openJSON(key, fileText) {
  const box = typeof fileText === 'string' ? JSON.parse(fileText) : fileText;
  if (!box || box.v !== 1) throw new Error('BAD_FILE');
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.ct)));
  const raw = box.z === 'gzip' ? await pipeBytes(pt, new DecompressionStream('gzip')) : pt;
  return JSON.parse(td.decode(raw));
}
