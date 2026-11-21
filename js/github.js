// GitHub 저장소의 일정 파일 하나를 읽고 쓰는 최소 클라이언트 (Contents API)
import { b64ToBytes } from './crypto.js';

const td = new TextDecoder();

export class HttpError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.status = status;
  }
}

export class Repo {
  constructor(cfg, token) {
    this.api = String(cfg.api || 'https://api.github.com').replace(/\/$/, '');
    this.owner = cfg.repo.owner;
    this.name = cfg.repo.name;
    this.branch = cfg.repo.branch || 'main';
    this.path = cfg.repo.path || 'data/trip.enc.json';
    this.token = token;
  }

  url(withRef) {
    const p = this.path.split('/').map(encodeURIComponent).join('/');
    const base = `${this.api}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/contents/${p}`;
    return withRef ? `${base}?ref=${encodeURIComponent(this.branch)}` : base;
  }

  headers(extra = {}) {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  // etag를 주면 바뀐 게 없을 때 {notModified:true}
  async get(etag) {
    const res = await fetch(this.url(true), {
      headers: this.headers(etag ? { 'If-None-Match': etag } : {}),
      cache: 'no-store',
    });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new HttpError(res.status, await safeMsg(res));
    const j = await res.json();
    const text = td.decode(b64ToBytes(j.content || ''));
    return { text, sha: j.sha, etag: res.headers.get('ETag') };
  }

  // 충돌(다른 사람이 먼저 저장)이면 {conflict:true}
  async put(text, sha, message) {
    const body = { message, content: btoa(text), branch: this.branch };
    if (sha) body.sha = sha;
    const res = await fetch(this.url(false), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (res.status === 409 || res.status === 422) return { conflict: true, status: res.status };
    if (!res.ok) throw new HttpError(res.status, await safeMsg(res));
    const j = await res.json();
    return { sha: j.content && j.content.sha };
  }
}

async function safeMsg(res) {
  try {
    const j = await res.json();
    return `HTTP ${res.status}: ${j.message || ''}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
