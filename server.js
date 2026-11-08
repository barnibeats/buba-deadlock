const http = require('http');
const fs = require('fs');
const path = require('path');
const myBuilds = require('./mybuilds');
const createAutoBuilder = require('./autobuild');
const updater = require('./updater');
const createDescriber = require('./describe');
const createNews = require('./news');
const createTranslator = require('./translate');

const PORT = Number(process.env.PORT) || 5177;
const API = 'https://api.deadlock-api.com';
const PUBLIC = path.join(__dirname, 'public');
const PRIORITY = [17, 1]; 

const PERIODS = {
  day:   { label: '24 часа', seconds: 86400,      minMatches: 30,  slices: null },
  week:  { label: '7 дней',  seconds: 7 * 86400,  minMatches: 100, slices: { n: 7, seconds: 86400,     unit: 'day' } },
  month: { label: '28 дней', seconds: 28 * 86400, minMatches: 250, slices: { n: 4, seconds: 7 * 86400, unit: 'week' } },
};
const META_TTL = 60 * 60 * 1000;
const ASSET_TTL = 30 * 60 * 1000;       
const CACHE_TTL = 9.5 * 60 * 1000;      
const REFRESH_EVERY = 10 * 60 * 1000;   

let active = 0;
const waiting = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => { active--; if (waiting.length) waiting.shift()(); });
    };
    active < 4 ? run() : waiting.push(run);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchJson(url) {
  return limit(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Soulsmith/1.0' }, signal: AbortSignal.timeout(30000) });
        if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return await res.json();
      } catch (e) {
        if (attempt < 2 && (e.name === 'TimeoutError' || e.name === 'TypeError')) { await sleep(1000 * (attempt + 1)); continue; }
        throw e;
      }
    }
  });
}

const cache = new Map(); 
function cached(key, ttl, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = producer();
  cache.set(key, { t: Date.now(), p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}

let heroesP, itemsP, heroesAt = 0, itemsAt = 0;
function loadHeroes() {
  if (heroesP && Date.now() - heroesAt > ASSET_TTL) heroesP = null;
  if (!heroesP) heroesAt = Date.now();
  return (heroesP ||= fetchJson(`${API}/v1/assets/heroes`).then(list =>
    list.filter(h => h.player_selectable && !h.disabled && !h.in_development)
      .map(h => ({
        id: h.id, name: h.name,
        img: h.images?.icon_image_small_webp || h.images?.icon_image_small,
        card: h.images?.icon_hero_card_webp || h.images?.icon_hero_card,
        bg: h.images?.background_image_webp || h.images?.background_image,
        abilities: ['signature1', 'signature2', 'signature3', 'signature4'].map(k => h.items?.[k]).filter(Boolean),
      }))
      .sort((a, b) => {
        const pa = PRIORITY.indexOf(a.id), pb = PRIORITY.indexOf(b.id);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return a.name.localeCompare(b.name);
      })
  ).catch(e => { heroesP = null; throw e; }));
}
function loadItems() {
  if (itemsP && Date.now() - itemsAt > ASSET_TTL) itemsP = null;
  if (!itemsP) itemsAt = Date.now();
  return (itemsP ||= fetchJson(`${API}/v1/assets/items`).then(list => {
    const m = new Map();
    for (const i of list) {
      m.set(i.id, {
        id: i.id, name: i.name, type: i.type,
        img: i.image_webp || i.image,
        slot: i.item_slot_type || null, tier: i.item_tier || null, cost: i.cost || null,
        shopable: i.shopable,
      });
    }
    return m;
  }).catch(e => { itemsP = null; throw e; }));
}

const ruDate = sec => new Date(sec * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
function loadMeta() {
  return cached('meta', META_TTL, async () => {
    const now = Math.floor(Date.now() / 1000);
    const [big, seasons, notes] = await Promise.all([
      fetchJson(`${API}/v1/patches/big-days`).catch(() => null),
      fetchJson(`${API}/v1/assets/ranked-seasons`).catch(() => null),
      news.list().catch(() => null),
    ]);
    const meta = { patch: null, season: null, latest: null };
    const bigTs = (big || []).map(d => Math.floor(Date.parse(d) / 1000)).filter(t => t && t <= now).sort((a, b) => b - a)[0];
    if (bigTs) meta.patch = { from: bigTs, label: `Патч ${ruDate(bigTs)}`, hint: `С крупного обновления от ${ruDate(bigTs)}` };
    for (const se of seasons || []) for (const iv of se.intervals || []) {
      if (iv.start_timestamp <= now && now < iv.end_timestamp) meta.season = { from: iv.start_timestamp, name: se.name, label: 'Сезон', hint: `${se.name}: с ${ruDate(iv.start_timestamp)}` };
    }
    const n = (notes || [])[0];
    if (n) meta.latest = { title: n.title, date: n.date, link: n.url };
    return meta;
  });
}

let metaNow = { patch: null, season: null, latest: null };
function getPeriod(key) {
  if (PERIODS[key]) return PERIODS[key];
  const m = metaNow[key];
  if (!m) return null;
  const to = hourNow(), days = Math.max(0.1, (to - m.from) / 86400);
  const slices = days < 2 ? null : days <= 10 ? { n: Math.ceil(days), seconds: 86400, unit: 'day' } : { n: Math.min(8, Math.ceil(days / 7)), seconds: 7 * 86400, unit: 'week' };
  const minMatches = days <= 3 ? 30 : days <= 8 ? 100 : days <= 16 ? 150 : 250;
  return { label: m.hint, from: m.from, seconds: to - m.from, minMatches, slices };
}
const refreshMeta = async () => { metaNow = await loadMeta(); return metaNow; };
const periodKeyOf = v => (PERIODS[v] || metaNow[v]) ? v : 'week';

const hourNow = () => Math.floor(Date.now() / 600000) * 600; 

function wilsonLB(w, n, z = 1.645) {
  if (!n) return 0;
  const p = w / n, z2 = z * z;
  const centre = p + z2 / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - adj) / (1 + z2 / n);
}

function statsUrl(heroId, from, to, minMatches, rank, perf) {
  const q = new URLSearchParams({ min_matches: String(minMatches), min_unix_timestamp: String(from), max_unix_timestamp: String(to) });
  if (perf) q.set('include_performance', 'true');
  if (rank) q.set('min_average_badge', String(rank));
  return `${API}/v1/analytics/hero-build-stats/${heroId}?${q}`;
}
const fetchStats = (heroId, from, to, minMatches, rank, perf = false) =>
  cached(`stats:${heroId}:${from}:${to}:${minMatches}:${rank}:${perf}`, CACHE_TTL, () => fetchJson(statsUrl(heroId, from, to, minMatches, rank, perf)));

const fetchBuild = (heroId, buildId) =>
  cached(`build:${heroId}:${buildId}`, 60 * 60 * 1000, () => fetchJson(`${API}/v1/builds/${heroId}/${buildId}`));

function baselineOf(rows) {
  let w = 0, n = 0;
  for (const r of rows) { w += r.wins; n += r.matches; }
  return { wr: n ? w / n : 0.5, matches: n };
}

function minMatchesFor(periodKey, rank) {
  const base = getPeriod(periodKey).minMatches;
  return rank ? Math.max(15, Math.round(base / 3)) : base;
}

async function heroTop(heroId, periodKey, rank, { withSlices = true, topN = 10 } = {}) {
  await refreshMeta();
  const P = getPeriod(periodKey);
  const to = hourNow(), from = P.from ?? to - P.seconds;
  const minMatches = minMatchesFor(periodKey, rank);

  const jobs = [fetchStats(heroId, from, to, minMatches, rank, true)];
  if (withSlices && P.slices) {
    for (let i = P.slices.n - 1; i >= 0; i--) {
      const sTo = to - i * P.slices.seconds;
      jobs.push(fetchStats(heroId, sTo - P.slices.seconds, sTo, 5, rank).then(rows => ({ rows, to: sTo })));
    }
  }
  const [rows, ...sliceData] = await Promise.all(jobs);

  const base = baselineOf(rows);
  const sliceBases = sliceData.map(s => ({ to: s.to, base: baselineOf(s.rows).wr, map: new Map(s.rows.map(r => [r.hero_build_id, r])) }));

  const dpm = r => r.total_player_damage && r.total_duration_s ? r.total_player_damage / (r.total_duration_s / 60) : null; 
  const dmgBase = (() => { let d = 0, t = 0; for (const r of rows) if (r.total_duration_s) { d += r.total_player_damage; t += r.total_duration_s / 60; } return t ? d / t : null; })();

  let scored = rows.map(r => {
    const wr = r.wins / r.matches;
    const slices = sliceBases.map(s => {
      const x = s.map.get(r.hero_build_id);
      return x ? { wr: x.wins / x.matches, matches: x.matches, base: s.base, to: s.to } : { wr: null, matches: 0, base: s.base, to: s.to };
    });
    const played = slices.filter(s => s.matches >= 5);
    const above = played.filter(s => s.wr > s.base).length;
    const lb = wilsonLB(r.wins, r.matches);
    const edge = wr - base.wr;
    const tier = lb > base.wr ? 'S' : edge >= 0.015 ? 'A' : 'B';
    const d = dpm(r);
    return {
      id: r.hero_build_id, wins: r.wins, losses: r.losses, matches: r.matches, players: r.players, wr, edge, lb, tier, slices,
      daysAbove: above, daysPlayed: played.length,
      pick: r.matches / base.matches,                                   
      dpm: d, dmgIdx: d && dmgBase ? d / dmgBase : null,                
    };
  });

  const good = scored.filter(b => b.edge >= 0.005 && b.wr >= 0.5);
  const hidden = scored.length - good.length;

  const pr = (arr, key) => {
    const vals = arr.map(x => x[key] ?? -Infinity);
    return x => { const v = x[key] ?? -Infinity; const i = vals.filter(y => y < v).length; return arr.length > 1 ? i / (arr.length - 1) : 1; };
  };
  const prLb = pr(good, 'lb'), prPick = pr(good, 'pick'), prDmg = pr(good, 'dmgIdx');
  for (const b of good) b.score = Math.round(100 * (0.5 * prLb(b) + 0.25 * prPick(b) + 0.25 * (b.dmgIdx == null ? 0.5 : prDmg(b))));
  good.sort((a, b) => b.score - a.score || b.lb - a.lb);
  const top = good.slice(0, topN);

  await Promise.all(top.map(async b => {
    try {
      const d = await fetchBuild(heroId, b.id);
      const hb = d.hero_build;
      b.name = hb.name; b.authorId = hb.author_account_id; b.updated = hb.last_updated_timestamp;
      b.version = hb.version; b.favorites = d.num_favorites ?? null; b.weeklyFavorites = d.num_weekly_favorites ?? null;
    } catch { b.name = `Сборка #${b.id}`; }
  }));

  return {
    heroId, period: periodKey, rank, from, to, minMatches, generatedAt: Date.now(),
    sliceUnit: P.slices?.unit || null,
    baseline: base.wr, totalMatches: base.matches, buildsAnalyzed: scored.length, hidden,
    builds: top,
  };
}

const heroTopCached = (heroId, periodKey, rank, opts = {}) =>
  cached(`top:${heroId}:${periodKey}:${metaNow[periodKey]?.from || ''}:${rank}:${opts.withSlices !== false}:${opts.topN || 10}`, CACHE_TTL, () => heroTop(heroId, periodKey, rank, opts));

async function buildDetails(heroId, buildId) {
  const [d, items] = await Promise.all([fetchBuild(heroId, buildId), loadItems()]);
  const hb = d.hero_build;
  const mapMod = m => {
    const it = items.get(m.ability_id);
    return { id: m.ability_id, name: it?.name || `#${m.ability_id}`, img: it?.img || null, slot: it?.slot || null, tier: it?.tier || null, cost: it?.cost || null, note: m.annotation || null };
  };
  const categories = (hb.details?.mod_categories || [])
    .filter(c => c.mods?.length)
    .map(c => ({ name: c.name, description: c.description, mods: c.mods.map(mapMod) }));
  const abilityOrder = (hb.details?.ability_order?.currency_changes || hb.details?.ability_order || []);
  const order = Array.isArray(abilityOrder)
    ? abilityOrder.map(x => items.get(x.ability_id ?? x)).filter(Boolean).map(i => ({ id: i.id, name: i.name, img: i.img }))
    : [];
  return { id: hb.hero_build_id, name: hb.name, description: hb.description, version: hb.version, updated: hb.last_updated_timestamp, favorites: d.num_favorites ?? null, categories, abilityOrder: order };
}

const overviewJobs = new Map(); 
function overview(periodKey, rank) {
  const key = `${periodKey}:${rank}`;
  let job = overviewJobs.get(key);
  if (job && Date.now() - job.started < CACHE_TTL) return job;
  job = { started: Date.now(), total: 0, done: 0, items: [] };
  overviewJobs.set(key, job);
  (async () => {
    const heroes = await loadHeroes();
    job.total = heroes.length;
    await Promise.all(heroes.map(async h => {
      try {
        const r = await heroTopCached(h.id, periodKey, rank, { withSlices: false, topN: 3 });
        job.items.push({ heroId: h.id, name: h.name, img: h.img, baseline: r.baseline, matches: r.totalMatches, best: r.builds[0] || null, alt: r.builds.slice(1, 3) });
      } catch (e) {
        job.items.push({ heroId: h.id, name: h.name, img: h.img, error: true });
      } finally { job.done++; }
    }));
  })();
  return job;
}

const sumByHero = rows => {
  const m = new Map();
  for (const r of rows) { const x = m.get(r.hero_id) || { wins: 0, matches: 0 }; x.wins += r.wins; x.matches += r.matches; m.set(r.hero_id, x); }
  return m;
};
async function picks(periodKey, rank) {
  await refreshMeta();
  const P = getPeriod(periodKey);
  const to = hourNow(), from = P.from ?? to - P.seconds, span = to - from;
  const get = (a, b) => cached(`picks:${a}:${b}:${rank}`, CACHE_TTL, () => {
    const q = new URLSearchParams({ min_unix_timestamp: String(a), max_unix_timestamp: String(b) });
    if (rank) q.set('min_average_badge', String(rank));
    return fetchJson(`${API}/v1/analytics/hero-stats?${q}`);
  });
  const [cur, prev, heroes] = await Promise.all([get(from, to), get(from - span, from).catch(() => []), loadHeroes()]);
  const c = sumByHero(cur), p = sumByHero(prev);
  const total = [...c.values()].reduce((a, x) => a + x.matches, 0) || 1;
  const prevTotal = [...p.values()].reduce((a, x) => a + x.matches, 0);
  const byId = new Map(heroes.map(h => [h.id, h]));
  const list = [...c].filter(([id]) => byId.has(id)).map(([id, x]) => {
    const h = byId.get(id), pp = p.get(id);
    return {
      heroId: id, name: h.name, img: h.img, matches: x.matches, wr: x.wins / x.matches, pick: x.matches / total,
      prevPick: pp && prevTotal ? pp.matches / prevTotal : null,
    };
  }).sort((a, b) => b.matches - a.matches);
  const prevOrder = [...p].filter(([id]) => byId.has(id)).sort((a, b) => b[1].matches - a[1].matches).map(([id]) => id);
  const items = list.slice(0, 10).map((x, i) => ({ ...x, place: i + 1, prevPlace: prevOrder.indexOf(x.heroId) + 1 || null }));
  const wrAll = [...c.values()].reduce((a, x) => a + x.wins, 0) / total;
  return { periodLabel: P.label, generatedAt: Date.now(), games: Math.round(total / 12), heroCount: list.length, baseline: wrAll, hasPrev: prevTotal > 0, items };
}

const plainText = html => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const translator = () => cached('raw:translator', ASSET_TTL, async () => createTranslator(await describer.glossary()));

const hotfixes = () => cached('hotfixes', 10 * 60 * 1000, async () => {
  const [posts, tr] = await Promise.all([news.list(), translator()]);
  return posts.map(p => {
    let untranslated = 0, translated = 0;
    const groups = p.groups.map(g => ({
      ...g,
      nameRu: tr.ruName(g.name),
      lines: g.lines.map(html => {
        const ru = tr.line(plainText(html));
        ru ? translated++ : untranslated++;
        return { html, ru: ru ? escHtml(ru) : null };
      }),
    }));
    return {
      ...p, groups, translated, untranslated,
      titleRu: tr.title(p.title),
      heroes: p.heroes.map(h => ({ ...h, ru: tr.ruName(h.name) })),
      items: p.items.map(i => ({ ...i, ru: tr.ruName(i.name) })),
    };
  });
});

const flushAssets = () => {
  heroesP = null; itemsP = null;
  for (const k of [...cache.keys()]) if (k.startsWith('raw:') || k === 'hotfixes') cache.delete(k);
};
const describer = createDescriber({ fetchJson, cached, api: API, ttl: ASSET_TTL, loadHeroes });
const news = createNews({ fetchJson, cached, heroes: loadHeroes, items: () => describer.names(), onNew: flushAssets });

const auto = createAutoBuilder({ fetchJson, cached, loadItems, loadHeroes, heroTopCached, fetchBuild, ttl: CACHE_TTL });

async function topToMine(heroId, buildId) {
  const [d, items, heroes] = await Promise.all([fetchBuild(heroId, buildId), loadItems(), loadHeroes()]);
  const hb = d.hero_build;
  const categories = (hb.details?.mod_categories || []).filter(c => c.mods?.length).map(c => ({
    name: c.name, description: c.description || '',
    items: c.mods.map(m => ({ id: m.ability_id, note: m.annotation || '' })),
  }));
  const ao = hb.details?.ability_order?.currency_changes || [];
  return myBuilds.sanitize({
    heroId, name: hb.name, description: hb.description || '', categories,
    abilityOrder: ao.map(x => x.ability_id),
    source: { type: 'top', buildId, label: `Копия сборки #${buildId}` },
  }, items, new Set(heroes.map(h => h.id)));
}

async function hydrateMine(b) {
  const items = await loadItems();
  const it = id => { const x = items.get(id); return x ? { id, name: x.name, img: x.img, slot: x.slot, tier: x.tier, cost: x.cost } : { id, name: `#${id}`, img: null }; };
  return { ...b, categories: b.categories.map(c => ({ ...c, items: c.items.map(x => ({ ...it(x.id), note: x.note })) })), abilityOrder: (b.abilityOrder || []).map(it) };
}

const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 1e6) { reject(Object.assign(new Error('слишком большой запрос'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('некорректный JSON'), { status: 400 })); } });
  req.on('error', reject);
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden host' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'forbidden origin' });
    }
    if (p === '/api/heroes') return send(res, 200, await loadHeroes());

    if (p === '/api/update' && req.method === 'GET') {
      const r = await updater.check(url.searchParams.get('force') === '1');
      return send(res, 200, { current: r.current, latest: r.latest, available: r.available, notes: r.notes || '', error: r.error || null, canRestart: !!hooks.restart });
    }
    if (p === '/api/update/install' && req.method === 'POST') return send(res, 200, await updater.install());
    if (p === '/api/update/restart' && req.method === 'POST') {
      if (!hooks.restart) return send(res, 501, { error: 'Автоматический перезапуск недоступен — закройте и откройте приложение вручную' });
      send(res, 200, { ok: true });
      return void setTimeout(hooks.restart, 400);
    }
    if (p === '/api/meta') {
      const m = await refreshMeta();
      const top = (await news.list().catch(() => []))[0];
      return send(res, 200, { patch: m.patch, season: m.season, latest: top ? { title: top.title, date: top.date, link: top.url } : m.latest });
    }
    if (p === '/api/picks') {
      await refreshMeta();
      return send(res, 200, await picks(periodKeyOf(url.searchParams.get('period')), Number(url.searchParams.get('rank')) || 0));
    }

    let m;
    if ((m = p.match(/^\/api\/item\/(\d+)$/))) {
      const d = await describer.get(Number(m[1]));
      return d ? send(res, 200, d) : send(res, 404, { error: 'unknown item' });
    }
    if (p === '/api/hotfixes') return send(res, 200, { generatedAt: Date.now(), source: 'Официальные анонсы разработчиков (Valve) в Steam', posts: await hotfixes() });

    if ((m = p.match(/^\/api\/hero\/(\d+)$/))) {
      await refreshMeta();
      const period = periodKeyOf(url.searchParams.get('period'));
      const rank = Number(url.searchParams.get('rank')) || 0;
      const heroes = await loadHeroes();
      const hero = heroes.find(h => h.id === Number(m[1]));
      if (!hero) return send(res, 404, { error: 'unknown hero' });
      const data = await heroTopCached(hero.id, period, rank);
      const abilities = await describer.heroAbilities(hero).catch(() => []);
      return send(res, 200, { hero, abilities, periodLabel: getPeriod(period).label, ...data });
    }
    if ((m = p.match(/^\/api\/build\/(\d+)\/(\d+)$/))) return send(res, 200, await buildDetails(Number(m[1]), Number(m[2])));

    if (p === '/api/overview') {
      await refreshMeta();
      const period = periodKeyOf(url.searchParams.get('period'));
      const rank = Number(url.searchParams.get('rank')) || 0;
      const job = overview(period, rank);
      return send(res, 200, { total: job.total, done: job.done, finished: job.total > 0 && job.done >= job.total, items: job.items });
    }

    if ((m = p.match(/^\/api\/auto\/(\d+)$/)) && req.method === 'GET') {
      try {
        const g = await auto.generate(Number(m[1])), items = await loadItems();
        g.abilityOrder = g.abilityOrder.map(id => ({ id, name: items.get(id)?.name, img: items.get(id)?.img }));
        return send(res, 200, g);
      }
      catch (e) {
        if (e.code === 'not_enough_data') return send(res, 422, { error: e.message, code: e.code });
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/catalog\/(\d+)$/)) && req.method === 'GET') return send(res, 200, await auto.catalog(Number(m[1])));

    if (p === '/api/my' && req.method === 'GET') {
      const items = await loadItems();
      return send(res, 200, myBuilds.list().map(b => {
        const all = b.categories.flatMap(c => c.items);
        return { id: b.id, heroId: b.heroId, name: b.name, source: b.source, updatedAt: b.updatedAt, count: all.length, cost: all.reduce((a, x) => a + (items.get(x.id)?.cost || 0), 0) };
      }).sort((a, b) => b.updatedAt - a.updatedAt));
    }
    if (p === '/api/my' && req.method === 'POST') {
      const [items, heroes, body] = await Promise.all([loadItems(), loadHeroes(), readBody(req)]);
      const heroIds = new Set(heroes.map(h => h.id));
      const clean = body.importTop ? await topToMine(Number(body.heroId), Number(body.importTop)) : myBuilds.sanitize(body, items, heroIds);
      return send(res, 201, await hydrateMine(myBuilds.upsert(null, clean)));
    }
    if ((m = p.match(/^\/api\/my\/([0-9a-f-]{36})$/))) {
      const id = m[1];
      if (req.method === 'GET') { const b = myBuilds.get(id); return b ? send(res, 200, await hydrateMine(b)) : send(res, 404, { error: 'not found' }); }
      if (req.method === 'PUT') {
        const [items, heroes, body] = await Promise.all([loadItems(), loadHeroes(), readBody(req)]);
        const b = myBuilds.upsert(id, myBuilds.sanitize(body, items, new Set(heroes.map(h => h.id))));
        return b ? send(res, 200, await hydrateMine(b)) : send(res, 404, { error: 'not found' });
      }
      if (req.method === 'DELETE') return myBuilds.remove(id) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' });
    }

    let rel;
    try { rel = decodeURIComponent(p === '/' ? '/index.html' : p); } catch { return send(res, 400, 'bad request', 'text/plain'); }
    const file = path.resolve(PUBLIC, '.' + rel);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream'));
  } catch (e) {
    console.error(e.message);
    send(res, e.status || 502, { error: e.message });
  }
});

async function refreshPriority() {
  for (const [k, v] of cache) if (Date.now() - v.t > 3 * REFRESH_EVERY) cache.delete(k); 
  await refreshMeta().catch(() => {});
  news.list().catch(() => {});
  for (const id of PRIORITY) for (const per of [...Object.keys(PERIODS), ...['patch', 'season'].filter(k => metaNow[k])]) {
    try { await heroTopCached(id, per, 0); } catch (e) { console.error('refresh', id, per, e.message); }
  }
  try { overview('week', 0); } catch {}
  console.log('обновлено', new Date().toLocaleTimeString('ru-RU'));
}

function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`Soulsmith: http://localhost:${actual}`);
      setInterval(refreshPriority, REFRESH_EVERY).unref();
      loadHeroes().then(() => loadItems()).then(refreshPriority).then(() => console.log('справочники загружены')).catch(e => console.error('справочники:', e.message));
      resolve(actual);
    });
  });
}

const hooks = {};
module.exports = { start, hooks };
if (require.main === module) start().catch(e => { console.error(e.code === 'EADDRINUSE' ? `Порт ${PORT} занят — приложение уже запущено?` : e.message); process.exit(1); });
