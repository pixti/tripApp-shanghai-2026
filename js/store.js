// 일정 데이터 보관 + 잠금 해제 + GitHub 동기화
import CONFIG from '../config.js';
import * as C from './crypto.js';
import { Repo } from './github.js';
import { applyOps, describeOps } from './ops.js';
import * as idb from './idb.js';
import { sleep } from './util.js';

const K = {
  file: 'tp.file',
  sha: 'tp.sha',
  etag: 'tp.etag',
  pending: 'tp.pending',
  last: 'tp.last',
  me: 'tp.me',
  prefs: 'tp.prefs',
  done: 'tp.done',
  mtime: 'tp.mtime',
};

const ls = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* 저장공간 부족 등 */ }
  },
  del(k) {
    localStorage.removeItem(k);
  },
};

export const DEFAULT_PREFS = { linkMode: 'app', lang: 'zh', rate: 0, edit: false, sync: 'auto' };
const POLL_MS = 30000;

export class Store extends EventTarget {
  constructor() {
    super();
    this.cfg = CONFIG;
    this.key = null;
    this.token = null;
    this.repo = null;
    this.base = null; // 서버에서 받은 일정
    this.data = null; // 화면에 보여줄 일정 (= 서버 일정 + 아직 못 올린 수정)
    this.sha = ls.get(K.sha);
    this.etag = ls.get(K.etag);
    this.pending = ls.get(K.pending, []);
    this.lastSync = ls.get(K.last);
    this.me = ls.get(K.me);
    this.prefs = { ...DEFAULT_PREFS, ...ls.get(K.prefs, {}) };
    this.done = new Set(ls.get(K.done, []));
    this.status = 'idle';
    this.error = null;
    this.flushing = false;
    this.refreshing = false;
    this.timer = null;
  }

  emit(type = 'change', detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get canEdit() {
    return !!this.repo;
  }

  get rate() {
    return Number(this.prefs.rate) || Number(this.prefs.rateLive && this.prefs.rateLive.rate) || Number(this.data && this.data.trip && this.data.trip.wonPerYuan) || 200;
  }

  // ── 잠금 ──────────────────────────────────────────────
  async tryRestoreKey() {
    try {
      const key = await idb.get('key');
      if (!key) return false;
      await C.openText(key, this.cfg.check);
      await this.setKey(key);
      return true;
    } catch {
      return false;
    }
  }

  async unlock(pass, remember = true) {
    const key = await C.deriveKey(C.normPass(pass), this.cfg.kdf.salt, this.cfg.kdf.iter);
    try {
      await C.openText(key, this.cfg.check);
    } catch {
      throw new Error('WRONG_PASS');
    }
    if (remember) {
      try { await idb.set('key', key); } catch { /* 사생활 보호 모드 등 */ }
    }
    await this.setKey(key);
  }

  async setKey(key) {
    this.key = key;
    this.token = null;
    this.repo = null;
    if (this.cfg.token) {
      try { this.token = await C.openText(key, this.cfg.token); } catch { this.token = null; }
    }
    if (this.token && this.cfg.repo) this.repo = new Repo(this.cfg, this.token);
  }

  async lock() {
    this.stopPolling();
    try { await idb.del('key'); } catch { /* 무시 */ }
    this.key = null;
    this.token = null;
    this.repo = null;
    this.base = null;
    this.data = null;
  }

  // ── 데이터 ────────────────────────────────────────────
  // 일정 파일을 이 기기에 저장 (IndexedDB + localStorage 두 군데)
  saveFile(file) {
    ls.set(K.file, file);
    idb.set('file', file).catch(() => {});
  }

  async loadCached() {
    let file = ls.get(K.file);
    if (!file) {
      try { file = await idb.get('file'); } catch { file = null; }
    }
    if (!file || !this.key) return false;
    try {
      this.base = await C.openJSON(this.key, file);
      this.recompute();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  recompute() {
    if (!this.base) {
      this.data = null;
      return;
    }
    const { data } = applyOps(this.base, this.pending);
    this.data = data;
  }

  setStatus(s) {
    if (this.status !== s) {
      this.status = s;
      this.emit('status');
    }
  }

  markSynced() {
    this.lastSync = Date.now();
    ls.set(K.last, this.lastSync);
    this.error = null;
    this.setStatus(this.pending.length ? 'pending' : 'ok');
    this.emit('status');
  }

  fail(e) {
    console.warn('[sync]', e);
    this.error = e;
    if (e && (e.status === 401 || e.status === 403)) this.setStatus('auth');
    else this.setStatus(navigator.onLine === false ? 'offline' : 'error');
    this.emit('status');
  }

  // 앱에 같이 들어있는 일정 저장본 (인터넷 없이 처음 열어도 보이게)
  async loadBundled() {
    if (!this.key || this.base) return !!this.base;
    try {
      const res = await fetch(this.cfg.dataUrl || 'data/trip.enc.json');
      if (!res.ok) return false;
      const file = await res.text();
      this.base = await C.openJSON(this.key, file);
      if (!ls.get(K.file)) this.saveFile(file);
      this.recompute();
      this.emit('change');
      return true;
    } catch {
      return false;
    }
  }

  get manual() {
    return this.prefs.sync === 'manual';
  }

  async refresh({ force = false } = {}) {
    if (!this.key || this.refreshing || this.flushing) return;
    if (navigator.onLine === false) {
      this.setStatus('offline');
      if (!this.base) await this.loadBundled();
      return;
    }
    this.refreshing = true;
    if (!this.base) this.setStatus('syncing');
    try {
      let file;
      let sha = null;
      let etag = null;
      if (this.repo) {
        const r = await this.repo.get(force || !this.base ? null : this.etag);
        if (r.notModified) {
          this.markSynced();
          return;
        }
        ({ text: file, sha, etag } = r);
      } else {
        const url = this.cfg.dataUrl || 'data/trip.enc.json';
        const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        file = await res.text();
      }
      const base = await C.openJSON(this.key, file);
      const changed = !this.base || JSON.stringify(base.meta) !== JSON.stringify(this.base.meta);
      this.base = base;
      this.sha = sha;
      this.etag = etag;
      this.saveFile(file);
      ls.set(K.sha, sha);
      ls.set(K.etag, etag);
      this.recompute();
      this.markSynced();
      if (changed) this.emit('change', { remote: true });
    } catch (e) {
      this.fail(e);
      if (!this.base) await this.loadBundled();
    } finally {
      this.refreshing = false;
      if (this.pending.length && this.status !== 'auth') this.flushSoon(200);
    }
  }

  commit(ops) {
    const list = [].concat(ops).map(op => ({ ...op, by: this.me || '?', at: Date.now() }));
    this.pending.push(...list);
    ls.set(K.pending, this.pending);
    this.recompute();
    this.emit('change');
    this.setStatus('pending');
    this.flushSoon();
  }

  flushSoon(ms = 500) {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), ms);
  }

  async flush() {
    if (!this.repo || !this.pending.length || this.flushing) return;
    if (navigator.onLine === false) {
      this.setStatus('offline');
      return;
    }
    if (this.refreshing) {
      this.flushSoon(400);
      return;
    }
    this.flushing = true;
    this.setStatus('syncing');
    const batch = this.pending.slice();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const r = await this.repo.get(null);
        const server = await C.openJSON(this.key, r.text);
        const { data, rejected } = applyOps(server, batch);
        data.meta = {
          ...(data.meta || {}),
          rev: ((server.meta && server.meta.rev) || 0) + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: this.me || '?',
        };
        const file = await C.sealJSON(this.key, data);
        // 공개 저장소라 기록 메시지엔 이름·내용을 남기지 않음 (내용은 암호화된 파일 안에만)
        const put = await this.repo.put(file, r.sha, `일정 수정 ${batch.length}건`);
        if (put.conflict) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        this.base = data;
        this.sha = put.sha;
        this.etag = null;
        this.saveFile(file);
        ls.set(K.sha, put.sha);
        ls.set(K.etag, null);
        this.pending = this.pending.slice(batch.length);
        ls.set(K.pending, this.pending);
        this.recompute();
        this.markSynced();
        this.emit('change');
        if (rejected.length) this.emit('rejected', rejected);
        if (this.pending.length) this.flushSoon(150);
        return;
      }
      throw new Error('저장 충돌이 계속돼요. 잠시 후 다시 시도할게요.');
    } catch (e) {
      this.fail(e);
      if (e && e.status !== 401 && e.status !== 403) this.flushSoon(15000);
    } finally {
      this.flushing = false;
    }
  }

  // 지금 보이는 일정을 파일로 내려받기 (암호 풀린 JSON — 개인 보관용)
  exportBackup() {
    if (!this.data) return false;
    const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trip-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  async storageInfo() {
    const out = { persisted: null, usage: null };
    try { out.persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch { /* */ }
    try {
      const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      if (e) out.usage = e.usage;
    } catch { /* */ }
    return out;
  }

  discardPending() {
    this.pending = [];
    ls.set(K.pending, []);
    this.recompute();
    this.emit('change');
    this.setStatus(this.lastSync ? 'ok' : 'idle');
  }

  startPolling() {
    this.stopPolling();
    // 수동 모드: 새 일정은 [업데이트 받기]를 눌렀을 때만. 내가 고친 건 연결되면 계속 자동으로 올림
    const pull = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.manual) {
        if (this.pending.length) this.flush();
      } else {
        this.refresh();
      }
    };
    this.timer = setInterval(pull, POLL_MS);
    this._vis = pull;
    this._on = () => { this.setStatus(this.lastSync ? 'ok' : 'idle'); pull(); };
    this._off = () => this.setStatus('offline');
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('online', this._on);
    window.addEventListener('offline', this._off);
  }

  stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
    if (this._on) window.removeEventListener('online', this._on);
    if (this._off) window.removeEventListener('offline', this._off);
  }

  // ── 기기별 설정 ───────────────────────────────────────
  setPref(k, v, { silent = false } = {}) {
    this.prefs[k] = v;
    ls.set(K.prefs, this.prefs);
    if (!silent) this.emit('change');
  }

  setMe(name) {
    this.me = name;
    ls.set(K.me, name);
    this.emit('change');
  }

  toggleDone(id) {
    if (this.done.has(id)) this.done.delete(id);
    else this.done.add(id);
    ls.set(K.done, [...this.done]);
    this.emit('change');
  }

  clearDone(ids) {
    for (const id of ids) this.done.delete(id);
    ls.set(K.done, [...this.done]);
    this.emit('change');
  }
}
