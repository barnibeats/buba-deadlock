const $ = s => document.querySelector(s);
const state = { period: 'week', rank: 0, hero: 'overview', heroes: [], filter: '', meta: {}, favs: [], cmp: [], f: { type: 'all', budget: 0 } };
const periodName = () => ({ day: '24 часа', week: '7 дней', month: '28 дней' }[state.period] || state.meta[state.period]?.hint || state.period);
const DEFAULT_FAVS = [17, 1]; 
let reqToken = 0, pollTimer = null, autoTimer = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const fmt = n => n.toLocaleString('ru-RU');
const signed = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1);
const api = async url => { const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); };
const timeFmt = t => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

try { Object.assign(state, JSON.parse(localStorage.getItem('dl-state') || '{}')); } catch {}
const save = () => { try { localStorage.setItem('dl-state', JSON.stringify({ period: state.period, rank: state.rank, hero: state.hero })); } catch {} };

try { const f = JSON.parse(localStorage.getItem('dl-favs')); state.favs = Array.isArray(f) ? f.map(Number) : DEFAULT_FAVS.slice(); } catch { state.favs = DEFAULT_FAVS.slice(); }
const isFav = id => state.favs.includes(Number(id));
const favRank = id => { const i = state.favs.indexOf(Number(id)); return i === -1 ? 9999 : i; };
function toggleFav(id) {
  id = Number(id);
  state.favs = isFav(id) ? state.favs.filter(x => x !== id) : [...state.favs, id];
  try { localStorage.setItem('dl-favs', JSON.stringify(state.favs)); } catch {}
  renderHeroList();
  document.querySelectorAll('.favbtn').forEach(b => { const on = isFav(b.dataset.fav); b.classList.toggle('on', on); b.textContent = on ? '★ В избранном' : '☆ В избранное'; });
  if (state.hero === 'overview' || state.hero === 'picks') go(true);
}

function renderHeroList() {
  const q = state.filter.toLowerCase();
  const sorted = [...state.heroes].sort((a, b) => favRank(a.id) - favRank(b.id) || a.name.localeCompare(b.name, 'ru'));
  const list = sorted.filter(h => h.name.toLowerCase().includes(q));
  const favCount = list.filter(h => isFav(h.id)).length;
  $('#heroes').innerHTML = list.map((h, i) => {
    const fav = isFav(h.id);
    const sep = !q && favCount && i === favCount ? '<div class="sep"></div>' : '';
    return `${sep}<button class="hero-btn${fav ? ' pri' : ''}${state.hero == h.id ? ' on' : ''}" data-hero="${h.id}">
      <img src="${esc(h.img)}" alt="" loading="lazy"><span class="n">${esc(h.name)}</span><span class="star${fav ? ' on' : ''}" data-fav="${h.id}" role="button" title="${fav ? 'Убрать из избранного' : 'Добавить в избранное — герой переместится наверх списка'}">${fav ? '★' : '☆'}</span></button>`;
  }).join('');
  document.querySelectorAll('.hero-btn').forEach(b => b.classList.toggle('on', b.dataset.hero == state.hero));
}

function go(silent = false) {
  save();
  document.querySelectorAll('#period button').forEach(b => b.classList.toggle('on', b.dataset.v === state.period));
  $('#rank').value = String(state.rank);
  document.querySelectorAll('.hero-btn').forEach(b => b.classList.toggle('on', b.dataset.hero == state.hero));
  clearTimeout(pollTimer);
  clearInterval(autoTimer);
  if (state.hero === 'my') { reqToken++; updateCmpBar(); return MyBuilds.show(); } 
  autoTimer = setInterval(() => go(true), 5 * 60 * 1000); 
  if (state.hero === 'picks') return loadPicks(silent);
  if (state.hero === 'hotfixes') return loadHotfixes(silent);
  state.hero === 'overview' ? loadOverview(silent) : loadHero(Number(state.hero), silent);
}

const detailCache = new Map();
const getDetail = (heroId, id) => {
  const k = `${heroId}:${id}`;
  if (!detailCache.has(k)) detailCache.set(k, api(`/api/build/${heroId}/${id}`).catch(e => { detailCache.delete(k); throw e; }));
  return detailCache.get(k);
};
const SLOT = { spirit: 'Дух', weapon: 'Оружие', vitality: 'Живучесть' };
const CAT_NAMES = { '#Citadel_HeroBuilds_EarlyGame': 'Начало игры', '#Citadel_HeroBuilds_MidGame': 'Середина игры', '#Citadel_HeroBuilds_LateGame': 'Поздняя игра' };
const catName = n => CAT_NAMES[n] || n;
const isOptional = n => /optional|по желанию|опцион/i.test(n || '');

function analyze(d) {
  const calc = skipOpt => {
    const seen = new Set(), slots = { spirit: 0, weapon: 0, vitality: 0 }; let cost = 0;
    for (const c of d.categories) {
      if (skipOpt && isOptional(c.name)) continue;
      for (const m of c.mods) { if (seen.has(m.id)) continue; seen.add(m.id); if (slots[m.slot] != null) slots[m.slot]++; cost += m.cost || 0; }
    }
    return { slots, cost, total: slots.spirit + slots.weapon + slots.vitality };
  };
  let a = calc(true); if (!a.total) a = calc(false);
  a.main = a.total ? Object.keys(a.slots).sort((x, y) => a.slots[y] - a.slots[x])[0] : null;
  return a;
}
const mixHtml = a => !a ? '<span class="muted">считаю состав…</span>' : !a.total ? '<span class="muted">состав не указан</span>'
  : `<span class="slots" title="Дух / Оружие / Живучесть (основные предметы)">${['spirit', 'weapon', 'vitality'].map(k => `<i class="${k}" style="flex:${Math.max(a.slots[k], 0.05)}"></i>`).join('')}</span>
     <span>Дух ${a.slots.spirit} · Оружие ${a.slots.weapon} · Жив. ${a.slots.vitality}</span><span title="Сумма цен основных предметов (без блоков «optional»)">≈ ${fmt(a.cost)} душ</span>`;

const seenBase = {};
function flagger(heroId, builds) {
  const key = `dl-seen-${heroId}-${state.period}-${state.rank}`;
  if (!(key in seenBase)) { try { seenBase[key] = JSON.parse(localStorage.getItem(key)); } catch { seenBase[key] = null; } }
  const base = seenBase[key];
  try {
    const merged = { ...(base || {}) };
    for (const b of builds) merged[b.id] = b.updated || 0;
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(merged).slice(-300))));
  } catch {}
  const patchFrom = state.meta.patch?.from || 0;
  return b => {
    if (base) {
      if (base[b.id] === undefined) return 'new';
      if (base[b.id] !== (b.updated || 0)) return 'changed';
    }
    return patchFrom && b.updated >= patchFrom ? 'patch' : '';
  };
}
const TIER_TIPS = { S: 'S — преимущество над средним по герою статистически доказано', A: 'A — винрейт выше среднего на 1.5 п.п. и больше', B: 'B — небольшое, но стабильное преимущество' };
const FLAGS = {
  new: ['Новая', 'Появилась в топе с момента вашего прошлого просмотра'],
  changed: ['Изменена', 'Автор обновил сборку с момента вашего прошлого просмотра'],
  patch: ['После патча', 'Обновлена после последнего крупного обновления игры'],
};

let rowsById = new Map(), heroNow = null, analysis = new Map(), cmpHero = null;

async function loadHero(id, silent) {
  const token = ++reqToken;
  if (!silent) $('#main').innerHTML = '<div class="loading">Считаю топ сборок… (первый запрос по периоду может занять до 10–15 сек)</div>';
  try {
    const d = await api(`/api/hero/${id}?period=${state.period}&rank=${state.rank}`);
    if (token !== reqToken) return;
    renderHero(d, token);
  } catch (e) {
    if (token === reqToken) $('#main').innerHTML = `<div class="err">Не удалось получить данные: ${esc(e.message)}</div>`;
  }
}

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });
function sparkline(b, unit) {
  if (!b.slices.length) return '<div class="spark-cap">—</div>';
  const bars = b.slices.map(s => {
    if (s.wr == null) return '<span class="na" title="мало игр"></span>';
    const h = Math.max(6, Math.min(34, 6 + (s.wr - 0.40) / 0.2 * 28));
    const cls = s.wr > s.base ? 'up' : 'dn';
    const label = `${dayFmt.format(new Date((s.to - (unit === 'week' ? 7 : 1) * 86400) * 1000))} — ${dayFmt.format(new Date(s.to * 1000))}: ${pct(s.wr)} (${s.matches} игр, средн. героя ${pct(s.base)})`;
    return `<span class="${cls}" style="height:${h}px" title="${esc(label)}"></span>`;
  }).join('');
  return `<div class="spark">${bars}</div><div class="spark-cap">в плюсе ${b.daysAbove} из ${b.daysPlayed} ${unit === 'week' ? 'нед.' : 'дн.'}</div>`;
}

function renderHero(d, token) {
  const h = d.hero;
  heroNow = h;
  rowsById = new Map(d.builds.map(b => [String(b.id), b]));
  if (cmpHero !== h.id) { state.cmp = []; cmpHero = h.id; }
  state.cmp = state.cmp.filter(id => rowsById.has(id));
  const fav = isFav(h.id);
  const head = `<div class="hero-head"><img src="${esc(h.card || h.img)}" alt="">
    <div><h1>${esc(h.name)}</h1>
    <div class="meta">${esc(d.periodLabel)} · <b>${fmt(d.totalMatches)}</b> игроко-матчей в выборке · средний винрейт героя <b>${pct(d.baseline)}</b> · проанализировано сборок: <b>${d.buildsAnalyzed}</b> · обновлено <b>${timeFmt(d.generatedAt)}</b> (авто, каждые 5 мин)</div></div>
    <div class="head-actions"><button class="btn favbtn${fav ? ' on' : ''}" data-fav="${h.id}" title="Избранные герои показываются наверху списка слева">${fav ? '★ В избранном' : '☆ В избранное'}</button>
    <button class="btn gold" data-act="auto" data-hid="${h.id}" title="Соберёт сборку автоматически из лучших сборок и статистики предметов">✦ Авто‑сборка</button></div></div>`;
  if (!d.builds.length) { $('#main').innerHTML = head + '<div class="empty">За этот период нет сборок с достаточной выборкой. Попробуйте период побольше или снимите фильтр по рангу.</div>'; updateCmpBar(); return; }

  const flagOf = flagger(h.id, d.builds);
  const abil = d.abilities && d.abilities.length ? `<div class="abil-strip"><span class="fl">Способности героя</span>${d.abilities.map(a => `<button class="abil" type="button" data-iid="${a.id}" title="Описание: ${esc(a.name)}"><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span></button>`).join('')}</div>` : '';
  const filters = `<div class="fbar">
    <div class="fgroup"><span class="fl">Основной тип</span><div class="seg sm" id="ftype">${[['all', 'Все'], ['spirit', 'Дух'], ['weapon', 'Оружие'], ['vitality', 'Живучесть']].map(([v, t]) => `<button data-t="${v}"${state.f.type === v ? ' class="on"' : ''}>${t}</button>`).join('')}</div></div>
    <label class="fgroup sel" title="Сумма цен основных предметов сборки (без блоков «optional»)"><span class="fl">Бюджет</span><select id="fbudget">${[[0, 'любой'], [90000, 'до 90 000'], [120000, 'до 120 000'], [150000, 'до 150 000']].map(([v, t]) => `<option value="${v}"${state.f.budget === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <span class="fstat" id="fstat"></span></div>`;

  $('#main').innerHTML = head + abil + filters + '<div class="builds">' + d.builds.map((b, i) => {
    const barW = Math.max(0, Math.min(100, (b.wr - 0.40) / 0.2 * 100)), baseW = (d.baseline - 0.40) / 0.2 * 100;
    const fl = flagOf(b), id = String(b.id);
    return `<div class="card${i === 0 ? ' first' : ''}" data-id="${b.id}">
      <div class="row" data-toggle>
        <div class="rank">${i + 1}<div class="score" title="Составной рейтинг: винрейт + популярность + урон">${b.score}</div></div>
        <div class="title"><div class="name"><span class="tier ${b.tier}" title="${TIER_TIPS[b.tier]}">${b.tier}</span><span class="t">${esc(b.name)}</span>${fl ? `<span class="flag ${fl}" title="${esc(FLAGS[fl][1])}">${FLAGS[fl][0]}</span>` : ''}</div>
          <div class="sub">${b.version ? 'v' + b.version : 'сборка'}${b.favorites ? ' · ★ ' + fmt(b.favorites) : ''}${b.updated ? ' · обновлена ' + new Date(b.updated * 1000).toLocaleDateString('ru-RU') : ''}</div>
          <div class="mix" data-mix>${mixHtml(analysis.get(id))}</div>
          <div class="acts"><button class="btn small copyid" data-copy="${b.id}" title="Копирует только цифры: ${b.id}">Скопировать ID</button>
            <label class="cmp" title="Отметьте две сборки, чтобы сравнить их предметы"><input type="checkbox" data-cmp="${b.id}"${state.cmp.includes(id) ? ' checked' : ''}> Сравнить</label></div></div>
        <div class="wr"><div class="num">${pct(b.wr)}<small>${signed(b.edge)} п.п.</small></div>
          <div class="bar"><i style="width:${barW}%"></i><u style="left:${baseW}%" title="средний винрейт героя"></u></div></div>
        <div class="stat">${fmt(b.matches)} игр<div>${pct(b.pick, 1)} игр героя${b.dmgIdx ? ` · урон/мин ${b.dmgIdx >= 1 ? '+' : '−'}${Math.abs((b.dmgIdx - 1) * 100).toFixed(0)}%` : ''}</div></div>
        <div class="sparkwrap">${sparkline(b, d.sliceUnit)}</div>
      </div><div class="detail" hidden></div></div>`;
  }).join('') + '</div><div class="empty" id="fempty" hidden>Нет сборок под выбранные условия. Ослабьте фильтры.</div>';

  document.querySelectorAll('[data-toggle]').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('button, label, input, a')) return; 
    toggleDetail(row.parentElement, h.id);
  }));
  const first = document.querySelector('.card.first'); if (first) toggleDetail(first, h.id);
  applyFilters();
  updateCmpBar();
  enrich(d.builds.map(b => String(b.id)), h.id, token);
}

async function enrich(ids, heroId, token) {
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      if (analysis.has(id)) { applyFilters(); continue; }
      let a;
      try { a = analyze(await getDetail(heroId, id)); } catch { a = { slots: { spirit: 0, weapon: 0, vitality: 0 }, cost: 0, total: 0, main: null }; }
      if (token !== reqToken) return;
      analysis.set(id, a);
      const el = document.querySelector(`.card[data-id="${id}"] [data-mix]`);
      if (el) el.innerHTML = mixHtml(a);
      applyFilters();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

function applyFilters() {
  const cards = [...document.querySelectorAll('.builds .card')];
  if (!cards.length) return;
  const { type, budget } = state.f, active = type !== 'all' || budget > 0;
  let shown = 0, pending = 0;
  for (const card of cards) {
    const a = analysis.get(card.dataset.id);
    let ok = true;
    if (active) {
      if (!a) { pending++; ok = false; }
      else {
        if (type !== 'all' && a.main !== type) ok = false;
        if (budget && a.cost > budget) ok = false;
      }
    }
    card.hidden = !ok;
    if (ok) shown++;
  }
  const st = $('#fstat'); if (st) st.textContent = active ? `Показано ${shown} из ${cards.length}${pending ? ' · считаю состав…' : ''}` : '';
  const em = $('#fempty'); if (em) em.hidden = !(active && !shown && !pending);
}

async function toggleDetail(card, heroId) {
  const box = card.querySelector('.detail');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.loaded) return;
  box.innerHTML = '<div class="loading" style="padding:14px">Загружаю состав сборки…</div>';
  try {
    const d = await getDetail(heroId, card.dataset.id);
    box.dataset.loaded = '1';
    const item = m => `<div class="item ${m.slot || ''}" data-iid="${m.id}" ${m.note ? `title="${esc(m.note)}"` : ''}>${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : ''}${esc(m.name)}${m.cost ? ` <small style="color:var(--muted)">${m.cost}</small>` : ''}</div>`;
    const cats = d.categories.map(c => `<div class="cat"><h4>${esc(catName(c.name))}</h4>${c.description ? `<p>${esc(c.description)}</p>` : ''}<div class="items">${c.mods.map(item).join('')}</div></div>`).join('');
    const order = d.abilityOrder.length ? `<div class="cat"><h4>Порядок прокачки способностей</h4><div class="order">${d.abilityOrder.map((a, i) => `<div class="o" data-iid="${a.id}" title="${esc(a.name)}"><img src="${esc(a.img)}" alt=""><b>${i + 1}</b></div>`).join('')}</div></div>` : '';
    box.innerHTML = `<div class="detail-actions"><button class="btn small gold" data-act="save-top" data-hid="${heroId}" data-id="${card.dataset.id}">★ В мои сборки</button> <button class="btn small" data-copy="${card.dataset.id}" title="Копирует только цифры: ${card.dataset.id}">Скопировать ID</button> <button class="btn small" data-textcopy="${card.dataset.id}" title="Название, предметы по этапам и порядок прокачки — обычным текстом, чтобы отправить другу">Скопировать текстом</button></div>${d.description ? `<p class="desc">${esc(d.description)}</p>` : ''}${order}${cats || '<p class="note">Автор не добавил предметы.</p>'}
      <div class="link">В игре: Heroes → ${esc(state.heroes.find(x => x.id === heroId)?.name || '')} → Builds → поиск по «${esc(d.name)}» (ID ${d.id})</div>`;
  } catch (e) { box.innerHTML = `<div class="err" style="padding:14px">${esc(e.message)}</div>`; }
}

function copyOut(text, btn) {
  const done = () => { const t = btn.dataset.label || btn.textContent; btn.dataset.label = t; btn.textContent = 'Скопировано ✓'; clearTimeout(btn._t); btn._t = setTimeout(() => btn.textContent = t, 1400); };
  const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); done(); } catch {} ta.remove(); };
  navigator.clipboard ? navigator.clipboard.writeText(text).then(done, fallback) : fallback();
}

function buildText(heroName, row, d) {
  const L = [`${d.name} — ${heroName}`, `ID сборки: ${d.id}`];
  if (row) L.push(`Винрейт ${pct(row.wr)} (${signed(row.edge)} п.п. к среднему героя) · ${fmt(row.matches)} игр · период: ${periodName()}`);
  for (const c of d.categories) L.push('', `${catName(c.name)}:`, c.mods.map(m => m.name + (m.cost ? ` (${m.cost})` : '')).join(', '));
  if (d.abilityOrder.length) L.push('', 'Порядок прокачки: ' + d.abilityOrder.map(a => a.name).join(' → '));
  return L.join('\n');
}

function updateCmpBar() {
  let bar = $('#cmpbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'cmpbar'; bar.className = 'cmpbar'; document.body.append(bar); }
  const onHero = /^\d+$/.test(state.hero);
  bar.hidden = !(onHero && state.cmp.length);
  bar.innerHTML = `<span>Выбрано для сравнения: <b>${state.cmp.length} из 2</b></span>
    <button class="btn small gold" data-cmp-go ${state.cmp.length === 2 ? '' : 'disabled'}>Сравнить</button><button class="btn small" data-cmp-clear>Сбросить</button>`;
}
function setCmp(id, on) {
  id = String(id);
  state.cmp = state.cmp.filter(x => x !== id);
  if (on) {
    state.cmp.push(id);
    if (state.cmp.length > 2) { const drop = state.cmp.shift(); const cb = document.querySelector(`[data-cmp="${drop}"]`); if (cb) cb.checked = false; }
  }
  updateCmpBar();
}

function showModal(html, cls = 'wide') {
  const id = cls === 'item-box' ? 'itemmodal' : 'cmpmodal';
  $('#' + id)?.remove();
  const m = document.createElement('div');
  m.className = 'modal'; m.id = id;
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="modal-box ${cls}">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  document.body.append(m);
}
function closeModal() { ($('#itemmodal') || $('#cmpmodal'))?.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function openCompare() {
  if (state.cmp.length !== 2 || !heroNow) return;
  const [a, b] = state.cmp;
  showModal('<div class="loading">Загружаю обе сборки…</div>');
  try {
    const [da, db] = await Promise.all([getDetail(heroNow.id, a), getDetail(heroNow.id, b)]);
    const ra = rowsById.get(a), rb = rowsById.get(b), aa = analyze(da), ab = analyze(db);
    const mods = d => { const m = new Map(); for (const c of d.categories) for (const x of c.mods) if (!m.has(x.id)) m.set(x.id, x); return m; };
    const ma = mods(da), mb = mods(db);
    const common = [...ma.values()].filter(x => mb.has(x.id)), onlyA = [...ma.values()].filter(x => !mb.has(x.id)), onlyB = [...mb.values()].filter(x => !ma.has(x.id));
    const chip = m => `<div class="item ${m.slot || ''}" data-iid="${m.id}">${m.img ? `<img src="${esc(m.img)}" alt="">` : ''}${esc(m.name)}${m.cost ? ` <small style="color:var(--muted)">${m.cost}</small>` : ''}</div>`;
    const grp = (title, list, cls = '') => `<div class="cat ${cls}"><h4>${title} <span class="muted">(${list.length})</span></h4><div class="items">${list.map(chip).join('') || '<span class="muted">—</span>'}</div></div>`;
    const best = (x, y, hi = true) => x === y ? ['', ''] : (hi ? x > y : x < y) ? ['win', ''] : ['', 'win'];
    const line = (label, x, y, w) => `<tr><th>${label}</th><td class="${w[0]}">${x}</td><td class="${w[1]}">${y}</td></tr>`;
    const oa = da.abilityOrder.map(x => x.name), ob = db.abilityOrder.map(x => x.name);
    let diffAt = -1; for (let i = 0; i < Math.max(oa.length, ob.length); i++) if (oa[i] !== ob[i]) { diffAt = i; break; }
    const orderTxt = !oa.length && !ob.length ? 'не указан' : diffAt === -1 ? 'совпадает' : `отличается, начиная с ${diffAt + 1}-й прокачки`;
    const mix = x => `Дух ${x.slots.spirit} · Оружие ${x.slots.weapon} · Жив. ${x.slots.vitality}`;
    showModal(`<div class="modal-h"><b>Сравнение сборок · ${esc(heroNow.name)}</b><button class="btn small" data-close>Закрыть</button></div>
      <div class="modal-l cmp-body">
        <table class="cmp-table"><thead><tr><th></th><td><span class="tier ${ra.tier}">${ra.tier}</span> ${esc(ra.name)}<br><small class="muted">ID ${ra.id}</small></td><td><span class="tier ${rb.tier}">${rb.tier}</span> ${esc(rb.name)}<br><small class="muted">ID ${rb.id}</small></td></tr></thead><tbody>
          ${line('Винрейт', pct(ra.wr), pct(rb.wr), best(ra.wr, rb.wr))}
          ${line('Игр в выборке', fmt(ra.matches), fmt(rb.matches), best(ra.matches, rb.matches))}
          ${line('Доля игр героя', pct(ra.pick), pct(rb.pick), best(ra.pick, rb.pick))}
          ${line('Урон в минуту', ra.dmgIdx ? (ra.dmgIdx >= 1 ? '+' : '−') + Math.abs((ra.dmgIdx - 1) * 100).toFixed(0) + '%' : '—', rb.dmgIdx ? (rb.dmgIdx >= 1 ? '+' : '−') + Math.abs((rb.dmgIdx - 1) * 100).toFixed(0) + '%' : '—', best(ra.dmgIdx || 0, rb.dmgIdx || 0))}
          ${line('Состав (основные)', mix(aa), mix(ab), ['', ''])}
          ${line('Стоимость основных', '≈ ' + fmt(aa.cost), '≈ ' + fmt(ab.cost), best(aa.cost, ab.cost, false))}
          ${line('Порядок прокачки', `<span class="muted">${orderTxt}</span>`, '', ['', ''])}
        </tbody></table>
        ${grp('Общие предметы', common)}
        ${grp('Только в первой сборке', onlyA, 'only-a')}
        ${grp('Только во второй сборке', onlyB, 'only-b')}
      </div>`);
  } catch (e) { showModal(`<div class="err">Не удалось загрузить сборки: ${esc(e.message)}</div><div class="modal-f"><button class="btn small" data-close>Закрыть</button></div>`); }
}

const itemCache = new Map();
async function showItem(id) {
  showModal('<div class="loading">Загружаю описание…</div>', 'item-box');
  try {
    let d = itemCache.get(id);
    if (!d) { d = await api(`/api/item/${id}`); itemCache.set(id, d); }
    const tags = [
      d.kind === 'ability' ? (d.hero ? `Способность: ${esc(d.hero)}` : 'Способность') : 'Предмет',
      d.slot ? SLOT[d.slot] : '', d.tier ? `Уровень ${d.tier}` : '', d.cost ? `${fmt(d.cost)} душ` : '', d.active ? 'Активный' : '',
    ].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const sections = d.sections.map(x => `<div class="desc-sec">${x.title ? `<h4>${esc(x.title)}</h4>` : ''}<p>${x.html}</p></div>`).join('');
    const upgrades = d.upgrades.length ? `<div class="desc-sec"><h4>Улучшения способности</h4><ul class="upg">${d.upgrades.map(u => `<li><b>${esc(u.tier)}</b><span>${u.html}</span></li>`).join('')}</ul></div>` : '';
    const stats = d.stats.length ? `<div class="stats">${d.stats.map(s => `<div><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`).join('')}</div>` : '';
    showModal(`<div class="modal-h"><div class="item-head">${d.img ? `<img src="${esc(d.img)}" alt="">` : ''}<div><b>${esc(d.name)}</b>${d.nameEn ? `<small>${esc(d.nameEn)}</small>` : ''}</div></div><button class="btn small" data-close>Закрыть</button></div>
      <div class="modal-l item-body"><div class="tags">${tags}</div>${sections || '<p class="muted">Описание в игровых данных отсутствует.</p>'}${upgrades}${stats}<p class="muted src">Тексты и числа берутся из данных игры и обновляются автоматически.</p></div>`, 'item-box');
  } catch (e) { showModal(`<div class="err">Не удалось загрузить описание: ${esc(e.message)}</div><div class="modal-f"><button class="btn small" data-close>Закрыть</button></div>`, 'item-box'); }
}

let hfLang = 'ru';
try { hfLang = localStorage.getItem('dl-hf-lang') === 'en' ? 'en' : 'ru'; } catch {}
let hfLast = null;
const hfOpen = new Set();
let hfFirst = true;
document.addEventListener('toggle', e => {
  const c = e.target.closest && e.target.closest('.hf-card');
  if (c) { c.open ? hfOpen.add(c.dataset.id) : hfOpen.delete(c.dataset.id); hfFirst = false; }
}, true);

async function loadHotfixes(silent) {
  const token = ++reqToken;
  updateCmpBar();
  if (!silent) $('#main').innerHTML = '<div class="loading">Загружаю официальные заметки об обновлениях…</div>';
  try {
    const d = await api('/api/hotfixes');
    hfLast = d;
    if (token === reqToken) renderHotfixes(d);
  } catch (e) { if (token === reqToken) $('#main').innerHTML = `<div class="err">Не удалось получить данные: ${esc(e.message)}</div>`; }
}

function renderHotfixes(d) {
  const TAG = { update: 'Обновление', season: 'Сезон', news: 'Новость' };
  const ru = hfLang === 'ru';
  const tip = html => esc(html.replace(/<[^>]+>/g, ''));
  const heroBtn = (id, name) => `<button class="chip-btn hero" type="button" data-hero="${id}" title="Открыть лучшие сборки героя">${esc(name)}</button>`;
  const itemBtn = (id, name) => `<button class="chip-btn item" type="button" data-iid="${id}" title="Прочитать описание предмета">${esc(name)}</button>`;
  const body = blocks => {
    let out = '', list = '';
    const close = () => { if (list) { out += `<ul>${list}</ul>`; list = ''; } };
    for (const b of blocks) {
      if (b.t === 'li') { list += `<li>${b.html}</li>`; continue; }
      close();
      out += b.t === 'h' ? `<h4 class="hf-h">${b.html}</h4>` : `<p>${b.html}</p>`;
    }
    close();
    return out;
  };
  const cards = d.posts.map((p, i) => {
    const open = hfOpen.has(String(p.id)) || (hfFirst && i === 0);
    const date = new Date(p.date * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const line = l => !ru ? `<li>${l.html}</li>` : l.ru ? `<li title="Оригинал: ${tip(l.html)}">${l.ru}</li>` : `<li class="en" title="Не переведено: показан оригинал">${l.html}</li>`;
    const groups = p.groups.map(g => {
      const nm = ru && g.nameRu ? g.nameRu : g.name;
      return `<div class="hf-group"><h4>${g.kind === 'hero' ? heroBtn(g.id, nm) : g.kind === 'item' ? itemBtn(g.id, nm) : esc(nm)}</h4><ul>${g.lines.map(line).join('')}</ul></div>`;
    }).join('');
    const chips = p.heroes.length || p.items.length
      ? `<div class="hf-aff"><span class="fl">Упомянуты в заметках</span>${p.heroes.map(h => heroBtn(h.id, ru && h.ru ? h.ru : h.name)).join('')}${p.items.map(x => itemBtn(x.id, ru && x.ru ? x.ru : x.name)).join('')}</div>` : '';
    const link = /^https:\/\//.test(p.url || '') ? `<a class="hf-src" href="${esc(p.url)}" target="_blank" rel="noopener">Оригинал в Steam</a>` : '';
    return `<details class="hf-card${p.tag === 'update' ? ' upd' : ''}" data-id="${esc(p.id)}"${open ? ' open' : ''}>
      <summary><span class="hf-tag ${p.tag}">${TAG[p.tag]}</span><b>${esc(ru && p.titleRu ? p.titleRu : p.title)}</b><span class="hf-meta">${p.changes ? `изменений: ${p.changes}${ru ? `, на русском: ${p.translated}` : ''}` : ''}</span><time>${esc(date)}</time></summary>
      <div class="hf-body">${chips}${body(p.body)}${groups}${link}</div></details>`;
  }).join('');
  $('#main').innerHTML = `<div class="hero-head"><div><h1>Хотфиксы и обновления</h1>
    <div class="meta">Источник: ${esc(d.source)} · обновлено <b>${timeFmt(d.generatedAt)}</b></div></div></div>
    <p class="note">Здесь только официальные заметки разработчиков. Нажмите на героя, чтобы открыть его актуальные сборки, или на предмет, чтобы прочитать описание: так проще понять, что изменилось, и пересобрать билд под новый баланс.</p>
    <div class="hf-tools"><div class="seg sm" id="hflang"><button data-lang="ru"${ru ? ' class="on"' : ''}>Русский</button><button data-lang="en"${ru ? '' : ' class="on"'}>English</button></div>
      <span class="muted">${ru ? 'Названия берутся из русской версии игры. Что не удалось перевести надёжно, показано на английском (при наведении видно оригинал у переведённых строк).' : 'Оригинальный текст разработчиков.'}</span></div>
    <div class="hf-list">${cards || '<div class="empty">Официальных заметок пока нет.</div>'}</div>`;
}

async function loadPicks(silent) {
  const token = ++reqToken;
  updateCmpBar();
  if (!silent) $('#main').innerHTML = '<div class="loading">Считаю самых популярных героев…</div>';
  try {
    const d = await api(`/api/picks?period=${state.period}&rank=${state.rank}`);
    if (token === reqToken) renderPicks(d);
  } catch (e) { if (token === reqToken) $('#main').innerHTML = `<div class="err">Не удалось получить данные: ${esc(e.message)}</div>`; }
}

function trendBadge(x, hasPrev) {
  if (!hasPrev || !x.prevPlace) return '<span class="trend new" title="Не было в топе прошлого периода">новый</span>';
  const move = x.prevPlace - x.place;
  const dp = (x.pick - (x.prevPick || 0)) * 100;
  const tip = `Прошлый период такой же длины: ${x.prevPlace}-е место, ${pct(x.prevPick || 0)} пиков (${dp >= 0 ? '+' : '−'}${Math.abs(dp).toFixed(1)} п.п.)`;
  if (move > 0) return `<span class="trend up" title="${esc(tip)}">▲ ${move}</span>`;
  if (move < 0) return `<span class="trend dn" title="${esc(tip)}">▼ ${-move}</span>`;
  return `<span class="trend eq" title="${esc(tip)}">без изменений</span>`;
}

function renderPicks(d) {
  const max = Math.max(...d.items.map(x => x.pick), 0.0001);
  const rows = d.items.map(x => `<div class="pk-row${isFav(x.heroId) ? ' pri' : ''}" data-hero="${x.heroId}" title="Открыть сборки: ${esc(x.name)}">
      <div class="pk-place">${x.place}</div>
      <img src="${esc(x.img)}" alt="">
      <div class="pk-name"><b>${esc(x.name)}</b><small>${fmt(x.matches)} игр</small></div>
      <div class="pk-share"><div class="pk-num">${pct(x.pick)}</div><div class="bar"><i style="width:${x.pick / max * 100}%"></i></div></div>
      <div class="pk-wr ${x.wr >= 0.5 ? 'pos' : 'neg'}"><b>${pct(x.wr)}</b><small>винрейт</small></div>
      <div class="pk-trend">${trendBadge(x, d.hasPrev)}</div>
    </div>`).join('');
  $('#main').innerHTML = `<div class="hero-head"><div><h1>Топ‑10 пиков</h1>
    <div class="meta">${esc(d.periodLabel || periodName())} · герои, которых берут чаще всего · около <b>${fmt(d.games)}</b> матчей · обновлено <b>${timeFmt(d.generatedAt)}</b></div></div></div>
    <p class="note"><b>Доля пиков</b> — какую часть всех выборов героев занимает этот герой (в сумме по всем героям 100%). Стрелка показывает, как изменилось место по сравнению с предыдущим периодом такой же длины. Нажмите на героя, чтобы открыть его лучшие сборки.</p>
    <div class="pk-list">${rows || '<div class="empty">Нет данных за выбранный период и ранг.</div>'}</div>`;
}

async function loadOverview(silent) {
  const token = ++reqToken;
  updateCmpBar();
  const tick = async () => {
    try {
      const d = await api(`/api/overview?period=${state.period}&rank=${state.rank}`);
      if (token !== reqToken) return;
      renderOverview(d);
      if (!d.finished) pollTimer = setTimeout(tick, 2000);
    } catch (e) { if (token === reqToken) $('#main').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  if (!silent) $('#main').innerHTML = '<div class="loading">Собираю данные по героям…</div>';
  tick();
}

function renderOverview(d) {
  const items = [...d.items].sort((a, b) => favRank(a.heroId) - favRank(b.heroId) || (b.best?.score || 0) - (a.best?.score || 0));
  const line = (b, i) => `<div class="ov-b"><span class="ov-n">${i + 1}</span><span class="tier ${b.tier}">${b.tier}</span>
      <span class="ov-name" title="${esc(b.name)}">${esc(b.name || '#' + b.id)}</span>
      <span class="ov-wr"><b>${pct(b.wr)}</b> <span class="pos">${signed(b.edge)}</span></span>
      <span class="ov-m">${fmt(b.matches)} игр${b.dmgIdx ? ` · дмг ${b.dmgIdx >= 1 ? '+' : '−'}${Math.abs((b.dmgIdx - 1) * 100).toFixed(0)}%` : ''}</span>
      <button class="idbtn" data-copy="${b.id}" title="Копирует только цифры (${b.id}) — вставьте в «Поиск по тексту/ID» в игре">Скопировать ID</button></div>`;
  const cards = items.map(x => {
    const fav = isFav(x.heroId);
    const builds = x.best ? [x.best, ...(x.alt || [])] : [];
    const body = builds.length ? builds.map(line).join('')
      : `<div class="ov-b" style="color:var(--muted)">${x.error ? 'ошибка загрузки' : 'нет сборок с достаточной выборкой'}</div>`;
    return `<div class="ov-card${fav ? ' pri' : ''}"><div class="ov-h" data-hero="${x.heroId}"><img src="${esc(x.img)}" alt=""><b>${esc(x.name)}</b>${fav ? '<span style="color:var(--gold)">★</span>' : ''}
      <small>средн. ${x.baseline ? pct(x.baseline) : '—'}</small><span class="more">все сборки →</span></div>${body}</div>`;
  }).join('');
  $('#main').innerHTML = `<div class="hero-head"><div><h1>Топ‑3 сборки у каждого героя</h1>
    <div class="meta">Период: <b>${esc(periodName())}</b> · сборки из раздела «От сообщества» (те же ID, что в игре) · избранные герои — сверху.</div></div></div>
    ${d.finished ? '' : `<div class="progress"><i style="width:${d.total ? d.done / d.total * 100 : 5}%"></i></div>`}
    <div class="ov-grid">${cards}</div>`;
}

async function loadMeta() {
  try { state.meta = await api('/api/meta'); } catch { return; }
  for (const k of ['patch', 'season']) {
    const b = document.querySelector(`#period [data-v="${k}"]`), m = state.meta[k];
    if (!b) continue;
    b.hidden = !m;
    if (m) { b.textContent = k === 'season' ? 'Сезон' : m.label; b.title = m.hint; }
  }
  if ((state.period === 'patch' || state.period === 'season') && !state.meta[state.period]) state.period = 'week';
  const bar = $('#metatext'), parts = [];
  if (state.meta.season) parts.push(`<b>${esc(state.meta.season.name)}</b>`);
  const l = state.meta.latest;
  if (l) parts.push(`обновление игры: <a href="${esc(l.link)}" target="_blank" rel="noopener" title="Открыть заметки к обновлению">${esc(l.title.trim())}</a> (${new Date(l.date * 1000).toLocaleDateString('ru-RU')})`);
  bar.innerHTML = parts.length ? parts.join(' · ') + ' · ' : '';
}

const post = async url => {
  const r = await fetch(url, { method: 'POST' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.status);
  return body;
};
function flash(msg) {
  const el = document.createElement('div');
  el.className = 'flash'; el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 4200);
}
let upd = null, updStage = 'idle', updHidden = null;
const cleanNotes = t => String(t || '').replace(/https?:\/\/\S+/g, '').replace(/[#*`>]/g, '').trim();

function renderUpdbar(msg) {
  const bar = $('#updbar');
  if (!upd || !upd.available || updHidden === upd.latest) { bar.hidden = true; return; }
  const notes = cleanNotes(upd.notes);
  const notesHtml = notes ? `<span class="notes">${esc(notes)}</span>` : '';
  let body;
  if (updStage === 'installing') body = `<b>Устанавливаю версию ${esc(upd.latest)}…</b><span class="spacer"></span><button class="btn small" disabled>Подождите</button>`;
  else if (updStage === 'restarting') body = `<b>Перезапускаю приложение…</b>`;
  else if (updStage === 'done') body = upd.canRestart
    ? `<b>Версия ${esc(upd.latest)} установлена.</b> Перезапустите приложение, чтобы начать пользоваться новой версией.<span class="spacer"></span><button class="btn small gold" data-upd="restart">Перезапустить</button>`
    : `<b>Версия ${esc(upd.latest)} установлена.</b> Закройте приложение и откройте снова.`;
  else body = `<b>Есть доступное обновление — версия ${esc(upd.latest)}</b>${notesHtml}<span class="spacer"></span>${msg ? `<span class="neg">${esc(msg)}</span>` : ''}<button class="btn small gold" data-upd="install">Обновить</button><button class="btn small" data-upd="later">Позже</button>`;
  bar.innerHTML = body;
  bar.hidden = false;
}

async function checkUpdate(manual = false) {
  let r;
  try { r = await api(`/api/update${manual ? '?force=1' : ''}`); }
  catch { if (manual) flash('Не удалось проверить обновления'); return; }
  upd = r;
  $('#verbtn').textContent = 'v' + r.current;
  if (manual) updHidden = null;
  renderUpdbar();
  if (manual) flash(r.error ? `Не удалось проверить обновления: ${r.error}` : r.available ? `Есть новая версия — ${r.latest}` : 'Установлена последняя версия');
}

async function updateAction(act) {
  if (!upd) return;
  if (act === 'later') { updHidden = upd.latest; return renderUpdbar(); }
  if (act === 'install') {
    updStage = 'installing'; renderUpdbar();
    try { await post('/api/update/install'); updStage = 'done'; renderUpdbar(); }
    catch (e) { updStage = 'idle'; renderUpdbar(e.message); }
  }
  if (act === 'restart') {
    updStage = 'restarting'; renderUpdbar();
    try { await post('/api/update/restart'); }
    catch (e) { updStage = 'done'; renderUpdbar(); flash(e.message); }
  }
}

document.addEventListener('click', e => {
  const t = e.target;
  const lg = t.closest('#hflang button');
  if (lg) {
    hfLang = lg.dataset.lang === 'en' ? 'en' : 'ru';
    try { localStorage.setItem('dl-hf-lang', hfLang); } catch {}
    if (hfLast) renderHotfixes(hfLast);
    return;
  }

  const ia = t.closest('[data-iid]');
  if (ia) return showItem(Number(ia.dataset.iid));

  const ua = t.closest('[data-upd]');
  if (ua) return updateAction(ua.dataset.upd);
  if (t.closest('#verbtn')) return checkUpdate(true);

  const fav = t.closest('[data-fav]');
  if (fav) { e.preventDefault(); e.stopPropagation(); toggleFav(fav.dataset.fav); return; }

  const c = t.closest('[data-copy]');
  if (c) { e.stopPropagation(); copyOut(String(c.dataset.copy).replace(/\D/g, ''), c); return; } 

  const tc = t.closest('[data-textcopy]');
  if (tc) {
    e.stopPropagation();
    const id = tc.dataset.textcopy;
    getDetail(heroNow.id, id).then(d => copyOut(buildText(heroNow.name, rowsById.get(id), d), tc)).catch(() => {});
    return;
  }
  if (t.closest('[data-cmp-go]')) return openCompare();
  if (t.closest('[data-cmp-clear]')) { state.cmp = []; document.querySelectorAll('[data-cmp]').forEach(x => x.checked = false); return updateCmpBar(); }

  const ft = t.closest('#ftype button');
  if (ft) { state.f.type = ft.dataset.t; document.querySelectorAll('#ftype button').forEach(b => b.classList.toggle('on', b === ft)); return applyFilters(); }

  const hb = t.closest('[data-hero]');
  if (hb) { if (!MyBuilds.canLeave()) return; state.hero = hb.dataset.hero; go(); }
});
document.addEventListener('change', e => {
  const cb = e.target.closest('[data-cmp]');
  if (cb) return setCmp(cb.dataset.cmp, cb.checked);
  if (e.target.id === 'fbudget') { state.f.budget = Number(e.target.value); applyFilters(); }
});
$('#period').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { if (!MyBuilds.canLeave()) return; state.period = b.dataset.v; go(); } });
$('#rank').addEventListener('change', e => { if (!MyBuilds.canLeave()) { e.target.value = String(state.rank); return; } state.rank = Number(e.target.value); go(); });
$('#search').addEventListener('input', e => { state.filter = e.target.value; renderHeroList(); });

(async () => {
  await loadMeta();
  try { state.heroes = await api('/api/heroes'); } catch (e) { $('#main').innerHTML = `<div class="err">Нет связи с сервером данных: ${esc(e.message)}</div>`; return; }
  const firstHero = String(state.favs[0] ?? state.heroes[0]?.id);
  if (state.hero !== 'overview' && state.hero !== 'my' && state.hero !== 'picks' && state.hero !== 'hotfixes' && !state.heroes.some(h => h.id == state.hero)) state.hero = firstHero;
  if (!localStorage.getItem('dl-state')) state.hero = firstHero; 
  renderHeroList();
  go();
  checkUpdate();                                   
  setInterval(() => checkUpdate(), 6 * 60 * 60 * 1000);
  setInterval(async () => {
    await loadMeta();
    detailCache.clear(); analysis.clear(); itemCache.clear();
    try { state.heroes = await api('/api/heroes'); renderHeroList(); } catch {}
  }, 60 * 60 * 1000);
})();
