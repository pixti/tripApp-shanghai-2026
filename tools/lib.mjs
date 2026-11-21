// PC 도구 공용 함수
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from '../js/crypto.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P = {
  config: path.join(ROOT, 'config.js'),
  data: path.join(ROOT, 'data', 'trip.enc.json'),
  sw: path.join(ROOT, 'sw.js'),
  private: path.join(ROOT, 'private'),
  trip: path.join(ROOT, 'private', 'trip.json'),
  seed: path.join(ROOT, 'private', 'seed.mjs'),
  secrets: path.join(ROOT, 'private', 'secrets.json'),
  backup: path.join(ROOT, 'private', 'backup'),
};

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function loadSecrets() {
  const s = readJSON(P.secrets, null);
  if (!s || !s.pass) {
    throw new Error(`비밀번호 설정이 없어요: ${P.secrets} 에 {"pass": "..."} 를 만들어 주세요`);
  }
  return { repo: 'tripApp-shanghai-2026', branch: 'main', owner: '', token: '', ...s };
}

export async function loadConfig() {
  if (!fs.existsSync(P.config)) return null;
  const mod = await import(`${pathToFileURL(P.config).href}?t=${Date.now()}`);
  return mod.default;
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function configSource(cfg) {
  return `// 자동 생성 파일 — node tools/trip.mjs seal 로 다시 만듦. 직접 고치지 마세요.
// (일정·토큰은 여행 비밀번호로 암호화되어 있음)
export default ${JSON.stringify(cfg, null, 2)};
`;
}

export async function keyFor(pass, cfg) {
  return C.deriveKey(pass, cfg.kdf.salt, cfg.kdf.iter);
}

export function ghHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'trip-planner-tools',
  };
}

export function contentsUrl(s, withRef = true) {
  const base = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/data/trip.enc.json`;
  return withRef ? `${base}?ref=${encodeURIComponent(s.branch)}` : base;
}

export async function ghGet(s) {
  const res = await fetch(contentsUrl(s), { headers: ghHeaders(s.token) });
  if (!res.ok) throw new Error(`GitHub 읽기 실패 HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { text: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}

export async function ghPut(s, text, sha, message) {
  const body = { message, content: Buffer.from(text, 'utf8').toString('base64'), branch: s.branch };
  if (sha) body.sha = sha;
  const res = await fetch(contentsUrl(s, false), {
    method: 'PUT',
    headers: { ...ghHeaders(s.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub 저장 실패 HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export { C };
