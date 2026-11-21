#!/usr/bin/env node
// PC 미리보기 서버: http://localhost:8080
// - 앱 파일을 그대로 보여주고
// - GitHub 대신 가짜 저장소(/__gh)를 붙여서 편집·동기화까지 PC에서 시험할 수 있게 함 (서버를 끄면 미리보기 수정은 사라짐)
//   node tools/serve.mjs [--port 8080] [--prod]   (--prod: 실제 config.js 그대로 사용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, ROOT, C, loadConfig, readJSON, configSource } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = Number(opt('--port', 8080));
const PROD = args.includes('--prod');
const DEV_TOKEN = 'devtoken-local-preview';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const BLOCK = ['private', '.git', 'node_modules', '.devtools'];

let devConfig = null;
const mock = { text: null, sha: null, n: 0, puts: [] };

function blobSha(text) {
  const buf = Buffer.from(text, 'utf8');
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function resetMock() {
  mock.text = fs.existsSync(P.data) ? fs.readFileSync(P.data, 'utf8') : null;
  mock.sha = mock.text ? blobSha(mock.text) : null;
  mock.puts = [];
}

async function buildDevConfig() {
  const cfg = await loadConfig();
  if (!cfg) throw new Error('config.js 가 없어요. 먼저 node tools/trip.mjs seal');
  if (PROD) return null;
  const sec = readJSON(P.secrets, null);
  if (!sec || !sec.pass) {
    console.log('⚠ private/secrets.json 이 없어 보기 전용으로 실행해요');
    return null;
  }
  const key = await C.deriveKey(sec.pass, cfg.kdf.salt, cfg.kdf.iter);
  try {
    await C.openText(key, cfg.check);
  } catch {
    console.log('⚠ secrets.json 비밀번호가 config.js 와 맞지 않아요 (seal 을 다시 하세요). 보기 전용으로 실행');
    return null;
  }
  return {
    ...cfg,
    repo: { owner: 'local', name: 'preview', branch: 'main', path: 'data/trip.enc.json' },
    api: '/__gh',
    token: await C.sealText(key, DEV_TOKEN),
    sw: false,
    build: `${cfg.build}-preview`,
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function mockGitHub(req, res, url) {
  if (url.pathname === '/__gh/_state') return send(res, 200, JSON.stringify({ sha: mock.sha, puts: mock.puts }));
  if (url.pathname === '/__gh/_reset' && req.method === 'POST') {
    resetMock();
    return send(res, 200, '{"ok":true}');
  }
  if (url.pathname === '/__gh/_delay' && req.method === 'POST') {
    mock.n = Number(url.searchParams.get('ms') || 0);
    return send(res, 200, '{"ok":true}');
  }
  if (url.pathname === '/__gh/_fail' && req.method === 'POST') {
    mock.down = url.searchParams.get('on') === '1';
    return send(res, 200, '{"ok":true}');
  }
  if (mock.down) {
    req.socket.destroy(); // 연결 끊김 흉내 → 브라우저에선 Failed to fetch
    return;
  }
  const m = url.pathname.match(/^\/__gh\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
  if (!m) return send(res, 404, '{"message":"Not Found"}');
  if ((req.headers.authorization || '') !== `Bearer ${DEV_TOKEN}`) return send(res, 401, '{"message":"Bad credentials"}');
  if (mock.n) await new Promise(r => setTimeout(r, mock.n));
  if (req.method === 'GET') {
    if (!mock.text) return send(res, 404, '{"message":"Not Found"}');
    const etag = `W/"${mock.sha}"`;
    if (req.headers['if-none-match'] === etag) return send(res, 304, '', 'text/plain', { ETag: etag });
    const content = Buffer.from(mock.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
    return send(res, 200, JSON.stringify({ type: 'file', encoding: 'base64', path: m[3], sha: mock.sha, content }), undefined, { ETag: etag });
  }
  if (req.method === 'PUT') {
    const body = JSON.parse(await readBody(req));
    if (mock.sha && body.sha !== mock.sha) {
      return send(res, 409, JSON.stringify({ message: `${m[3]} does not match ${body.sha}` }));
    }
    mock.text = Buffer.from(body.content, 'base64').toString('utf8');
    mock.sha = blobSha(mock.text);
    mock.puts.push({ message: body.message, at: new Date().toISOString() });
    console.log(`  [가짜 저장소] 저장: ${body.message}`);
    return send(res, 200, JSON.stringify({ content: { sha: mock.sha }, commit: { sha: crypto.randomBytes(20).toString('hex') } }));
  }
  return send(res, 405, '{"message":"Method Not Allowed"}');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (BLOCK.includes(top)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/__gh')) return await mockGitHub(req, res, url);
    if (url.pathname === '/config.js' && devConfig) return send(res, 200, configSource(devConfig), MIME['.js']);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, String(e), 'text/plain');
  }
});

resetMock();
devConfig = await buildDevConfig();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  미리보기: http://localhost:${PORT}/   (끄려면 Ctrl+C)`);
  console.log(devConfig ? '  편집 모드: 가능 (가짜 저장소 — 서버를 끄면 미리보기 수정은 사라져요)\n' : '  보기 전용\n');
});
