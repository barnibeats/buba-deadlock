const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const pkg = require('./package.json');
const UA = 'Soulsmith-updater';
const COPY_DIRS = ['public', 'build'];
const isCode = name => /\.(js|json)$/.test(name) && name !== 'package-lock.json';
const MUST_HAVE = ['package.json', 'desktop.js', 'server.js', 'public/index.html'];
const MAX_ZIP = 60 * 1024 * 1024;
const CHECK_TTL = 5 * 60 * 1000;

const current = () => process.env.SOULSMITH_FORCE_VERSION || pkg.version;
const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const repoId = () => Number(process.env.SOULSMITH_REPO_ID) || Number(pkg.soulsmith?.updateRepoId) || 0;
const apiBase = () => process.env.SOULSMITH_UPDATE_API || 'https://api.github.com';
const updateDir = () => path.join(process.env.SOULSMITH_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Soulsmith'), 'update');

async function latest() {
  const id = repoId();
  if (!id) throw new Error('Источник обновлений не настроен');
  const res = await fetch(`${apiBase()}/repositories/${id}/releases/latest`, {
    headers: { 'user-agent': UA, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error('GitHub временно ограничил запросы, попробуйте позже');
  if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);
  const r = await res.json();
  const version = String(r.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return { version, notes: String(r.body || '').slice(0, 1500), page: r.html_url, zip: r.zipball_url, published: r.published_at };
}

let cache = null;
async function check(force = false) {
  const cur = current();
  if (!force && cache && Date.now() - cache.t < CHECK_TTL) return { ...cache.v, current: cur, available: !!cache.v.latest && isNewer(cache.v.latest, cur) };
  try {
    const rel = await latest();
    const v = rel ? { latest: rel.version, notes: rel.notes, page: rel.page, published: rel.published } : { latest: null };
    cache = { t: Date.now(), v };
    return { ...v, current: cur, available: !!v.latest && isNewer(v.latest, cur) };
  } catch (e) {
    return { current: cur, latest: null, available: false, error: e.message };
  }
}

function extract(zip, dest) {
  const bin = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return new Promise((resolve, reject) => execFile(bin, ['-xf', zip, '-C', dest], { windowsHide: true, timeout: 120000 },
    err => err ? reject(new Error('Не удалось распаковать обновление')) : resolve()));
}

function tidy(base, keep) {
  try {
    const dirs = fs.readdirSync(base).filter(n => /^v\d+\.\d+\.\d+$/.test(n) && n !== keep)
      .map(n => ({ n, t: fs.statSync(path.join(base, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const d of dirs.slice(1)) fs.rmSync(path.join(base, d.n), { recursive: true, force: true });
  } catch {}
}

let busy = false;
async function install() {
  if (busy) throw new Error('Обновление уже устанавливается');
  busy = true;
  let work = null;
  try {
    const rel = await latest();
    if (!rel || !isNewer(rel.version, current())) throw new Error('Установлена последняя версия');
    if (!process.env.SOULSMITH_UPDATE_API) {
      const host = new URL(rel.zip).hostname;
      if (host !== 'api.github.com' && host !== 'codeload.github.com') throw new Error('Неожиданный адрес архива обновления');
    }
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'soulsmith-'));
    const res = await fetch(rel.zip, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Не удалось скачать обновление (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ZIP) throw new Error('Архив обновления слишком большой');
    const zipPath = path.join(work, 'update.zip');
    fs.writeFileSync(zipPath, buf);
    const out = path.join(work, 'src');
    fs.mkdirSync(out);
    await extract(zipPath, out);

    const tops = fs.readdirSync(out).map(n => path.join(out, n)).filter(p => fs.statSync(p).isDirectory());
    const src = tops.length === 1 ? tops[0] : out;
    for (const f of MUST_HAVE) if (!fs.existsSync(path.join(src, f))) throw new Error(`В архиве обновления нет файла ${f}`);
    const next = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    if (next.version !== rel.version) throw new Error('Версия в архиве не совпадает с версией релиза');

    const base = updateDir();
    const name = 'v' + rel.version;
    const dest = path.join(base, name);
    fs.mkdirSync(base, { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest);
    const entries = fs.readdirSync(src).filter(n => COPY_DIRS.includes(n) || (isCode(n) && fs.statSync(path.join(src, n)).isFile()));
    for (const n of entries) fs.cpSync(path.join(src, n), path.join(dest, n), { recursive: true });

    const tmp = path.join(base, 'current.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify({ version: rel.version, dir: name, installedAt: Date.now() }));
    fs.renameSync(tmp, path.join(base, 'current.json'));
    tidy(base, name);
    cache = null;
    return { ok: true, version: rel.version };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
    busy = false;
  }
}

module.exports = { check, install, current };
