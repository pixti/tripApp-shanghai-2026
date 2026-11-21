#!/usr/bin/env node
// GitHub에 올리기 (처음 한 번 + 앱 코드를 고쳤을 때)
//   node tools/deploy.mjs
// 필요: private/secrets.json 에 pass, owner(GitHub 아이디), repo, token
// - 처음: 일정을 새 비밀번호로 암호화해서 함께 올리고 GitHub Pages 켜기
// - 이후: 앱 코드만 올림 (폰에서 고친 일정은 건드리지 않음)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, P, loadSecrets, ghHeaders } from './lib.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...opts }).toString().trim();
}

function gitAuth(s, args, opts = {}) {
  const basic = Buffer.from(`${s.owner}:${s.token}`).toString('base64');
  return git(['-c', 'credential.helper=', '-c', `http.extraHeader=Authorization: Basic ${basic}`, ...args], opts);
}

function node(args) {
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
}

async function gh(s, method, url, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { ...ghHeaders(s.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, json };
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const s = loadSecrets();
  if (!s.owner || !s.token) fail('private/secrets.json 에 owner(GitHub 아이디)와 token 을 넣어 주세요 (README 참고)');
  const remote = `https://github.com/${s.owner}/${s.repo}.git`;

  console.log(`\n▶ 저장소 확인: ${s.owner}/${s.repo}`);
  const repo = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}`);
  if (repo.status === 401) fail('토큰이 틀렸거나 만료됐어요');
  if (repo.status === 404) fail(`저장소 ${s.owner}/${s.repo} 를 찾지 못했어요. GitHub에서 먼저 만들고, 토큰에 이 저장소 권한을 줬는지 확인하세요`);
  if (repo.status !== 200) fail(`저장소 확인 실패 HTTP ${repo.status}`);
  if (repo.json.private) console.log('  ⚠ 비공개 저장소예요. 무료 계정은 비공개 저장소로 GitHub Pages를 못 써요 → Public 으로 바꿔 주세요 (일정은 암호화돼 있어서 공개돼도 안전)');

  const remoteData = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}/contents/data/trip.enc.json?ref=${s.branch}`);
  const first = remoteData.status === 404;
  console.log(first ? '  처음 올리는 거예요 → 일정도 함께 암호화해서 올려요' : '  이미 올라간 일정이 있어요 → 앱 코드만 올려요 (폰에서 고친 일정 유지)');

  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    git(['init', '-b', s.branch]);
    console.log('  git 저장소 만듦');
  }
  try { git(['config', 'user.name']); } catch { git(['config', 'user.name', s.owner]); }
  try { git(['config', 'user.email']); } catch { git(['config', 'user.email', `${s.owner}@users.noreply.github.com`]); }

  let remoteHead = null;
  try {
    remoteHead = gitAuth(s, ['ls-remote', remote, `refs/heads/${s.branch}`]).split(/\s+/)[0] || null;
  } catch (e) {
    fail(`GitHub 연결 실패: ${e.stderr || e.message}`);
  }

  if (!first && remoteHead) {
    // 일정 파일은 항상 GitHub 쪽(폰에서 고친 최신)을 따름 — 로컬 일정 파일 변경은 올리지 않음
    gitAuth(s, ['fetch', '-q', remote, s.branch]);
    let hasLocal = true;
    try { git(['rev-parse', '--verify', '-q', 'HEAD']); } catch { hasLocal = false; }
    if (hasLocal) {
      try { git(['checkout', '--', 'data/trip.enc.json']); } catch { /* 변경 없음 */ }
    } else {
      git(['reset', '-q', 'FETCH_HEAD']); // 로컬 파일은 그대로 두고 기록만 맞춤
      git(['checkout', 'FETCH_HEAD', '--', 'data/trip.enc.json']);
    }
  }

  console.log('\n▶ 설정 만들기 (토큰·확인값 암호화)');
  node([path.join(ROOT, 'tools', 'trip.mjs'), 'seal', ...(first ? ['--data'] : [])]);

  console.log('\n▶ 커밋');
  git(['add', '-A']);
  const staged = git(['diff', '--cached', '--name-only']);
  if (/(^|\n)private\//.test(staged)) fail('private/ 폴더가 커밋에 들어가려고 해요. 중단합니다 (.gitignore 확인)');
  if (staged) git(['commit', '-q', '-m', first ? '여행 앱 처음 올림' : '앱 업데이트']);
  else console.log('  바뀐 파일 없음');

  console.log('\n▶ 올리기');
  if (!first && remoteHead) {
    try {
      gitAuth(s, ['pull', '--rebase', '-q', remote, s.branch]);
    } catch (e) {
      fail(`GitHub 내용과 합치다가 충돌했어요: ${e.stderr || e.message}`);
    }
  }
  try {
    gitAuth(s, ['push', '-q', remote, `HEAD:refs/heads/${s.branch}`]);
  } catch (e) {
    if (first && remoteHead) {
      // 새로 만든 저장소에 README만 있는 경우 → 덮어써도 안전한지 확인
      const tree = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}/git/trees/${remoteHead}`);
      const names = (tree.json && tree.json.tree || []).map(t => t.path);
      const commits = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}/commits?per_page=3&sha=${s.branch}`);
      const safe = names.every(n => /^(README\.md|LICENSE|\.gitignore)$/i.test(n)) && (commits.json || []).length <= 1;
      if (!safe) fail(`저장소에 다른 내용이 있어서 덮어쓰지 않았어요: ${names.join(', ')}`);
      console.log('  새 저장소의 기본 README를 앱으로 교체해요');
      gitAuth(s, ['push', '-q', '--force', remote, `HEAD:refs/heads/${s.branch}`]);
    } else {
      fail(`올리기 실패: ${e.stderr || e.message}`);
    }
  }
  console.log('  ✔ 올림');

  console.log('\n▶ GitHub Pages 켜기');
  let pages = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}/pages`);
  if (pages.status === 404) {
    const r = await gh(s, 'POST', `/repos/${s.owner}/${s.repo}/pages`, { build_type: 'legacy', source: { branch: s.branch, path: '/' } });
    if (r.status === 201 || r.status === 409) console.log('  ✔ 켬');
    else console.log(`  ⚠ 자동으로 못 켰어요 (HTTP ${r.status}). GitHub 저장소 → Settings → Pages → Branch: ${s.branch} / (root) → Save 를 직접 눌러 주세요`);
    pages = await gh(s, 'GET', `/repos/${s.owner}/${s.repo}/pages`);
  } else if (pages.status === 200) {
    console.log('  이미 켜져 있음');
  } else {
    console.log(`  ⚠ Pages 상태 확인 불가 (HTTP ${pages.status}) — 토큰에 Pages 권한이 없으면 직접 켜 주세요`);
  }
  const url = (pages.json && pages.json.html_url) || `https://${s.owner.toLowerCase()}.github.io/${s.repo}/`;

  console.log(`\n▶ 사이트 반영 기다리는 중 (보통 1~2분): ${url}`);
  const cfgText = fs.readFileSync(P.config, 'utf8');
  const build = (cfgText.match(/"build":\s*"([^"]+)"/) || [])[1];
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}config.js?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok && (await r.text()).includes(build)) {
        console.log(`\n✔ 완료! 휴대폰에서 이 주소를 여세요:\n\n   ${url}\n`);
        return;
      }
    } catch { /* 계속 */ }
    await sleep(5000);
    process.stdout.write('.');
  }
  console.log(`\n⚠ 아직 반영이 안 됐어요. 몇 분 뒤 ${url} 를 열어 보세요.`);
}

main().catch(e => fail(e.stack || String(e)));
