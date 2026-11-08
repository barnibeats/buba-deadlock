const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const baseDir = () => process.env.APPDATA || path.join(os.homedir(), '.config');
const dataDir = () => process.env.SOULSMITH_DATA_DIR || path.join(baseDir(), 'Soulsmith');
const file = () => path.join(dataDir(), 'my-builds.json');
const legacyFiles = () => ['BubaLock', 'DeadlockTopBuilds'].map(d => path.join(baseDir(), d, 'my-builds.json')); 

let store = null; 

function load() {
  if (store) return store;
  try {
    const old = !process.env.SOULSMITH_DATA_DIR && !fs.existsSync(file()) ? legacyFiles().find(f => fs.existsSync(f)) : null;
    if (old) {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.copyFileSync(old, file());
    }
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!parsed || !Array.isArray(parsed.builds)) throw new Error('bad format');
    store = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { fs.renameSync(file(), path.join(dataDir(), `my-builds.corrupt-${Date.now()}.json`)); } catch {}
      console.error('my-builds.json повреждён, сохранён как .corrupt:', e.message);
    }
    store = { version: 1, builds: [] };
  }
  return store;
}

function persist() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file()); 
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function sanitize(input, items, heroIds) {
  const heroId = Number(input?.heroId);
  if (!heroIds.has(heroId)) throw Object.assign(new Error('Неизвестный герой'), { status: 400 });
  const seen = new Set();
  const categories = (Array.isArray(input.categories) ? input.categories : []).slice(0, 12).map(c => ({
    name: str(c?.name, 60) || 'Категория',
    description: str(c?.description, 300),
    items: (Array.isArray(c?.items) ? c.items : []).slice(0, 24).flatMap(x => {
      const id = Number(x?.id);
      const it = items.get(id);
      if (!it || it.type !== 'upgrade' || seen.has(id)) return []; 
      seen.add(id);
      return [{ id, note: str(x?.note, 400) }];
    }),
  }));
  const abilityOrder = (Array.isArray(input.abilityOrder) ? input.abilityOrder : []).slice(0, 40)
    .map(Number).filter(id => items.get(id)?.type === 'ability');
  const src = input.source || {};
  return {
    heroId,
    name: str(input.name, 80) || 'Моя сборка',
    description: str(input.description, 2000),
    categories,
    abilityOrder,
    source: { type: ['manual', 'top', 'auto'].includes(src.type) ? src.type : 'manual', buildId: Number(src.buildId) || null, label: str(src.label, 160) },
  };
}

const list = () => load().builds;
const get = id => load().builds.find(b => b.id === id) || null;

function upsert(id, clean) {
  const s = load();
  const now = Date.now();
  let b = id ? s.builds.find(x => x.id === id) : null;
  if (id && !b) return null;
  if (b) Object.assign(b, clean, { updatedAt: now });
  else { b = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...clean }; s.builds.push(b); }
  persist();
  return b;
}

function remove(id) {
  const s = load();
  const i = s.builds.findIndex(b => b.id === id);
  if (i === -1) return false;
  s.builds.splice(i, 1);
  persist();
  return true;
}

module.exports = { list, get, upsert, remove, sanitize, dataDir, file };
