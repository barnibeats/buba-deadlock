const API = 'https://api.deadlock-api.com';
const OPTIONAL_RE = /optional|option|situat|ситуат|maybe|swap|alternativ|flex|good\s/i;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const median = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

class NotEnoughData extends Error { constructor(m) { super(m); this.code = 'not_enough_data'; } }

const ARCH_LABEL = { spirit: 'Маг — упор на духовную мощь', weapon: 'Стрелок — упор на оружие', hybrid: 'Гибрид — и дух, и оружие', unknown: 'Профиль не определён (мало данных)' };

function fitOf(it, prof, pres) {
  if (!prof || prof.archetype === 'unknown') return 'unknown';
  if (!it.slot || it.slot === 'vitality') return pres >= 0.3 ? 'core' : 'ok';
  const off = prof.archetype === 'spirit' ? 'weapon' : prof.archetype === 'weapon' ? 'spirit' : null;
  if (it.slot !== off) return pres >= 0.3 ? 'core' : 'ok';
  const need = it.tier === 1 ? 0.25 : 0.4; 
  if (pres >= need) return 'ok';
  return pres >= 0.1 ? 'warn' : 'bad';
}

module.exports = function create({ fetchJson, cached, loadItems, loadHeroes, heroTopCached, fetchBuild, ttl }) {
  async function rawItemStats(heroId, rank) {
    const to = Math.floor(Date.now() / 600000) * 600, from = to - 14 * 86400;
    const q = new URLSearchParams({ hero_id: String(heroId), min_unix_timestamp: String(from), max_unix_timestamp: String(to), min_matches: rank ? '60' : '150' });
    if (rank) q.set('min_average_badge', String(rank));
    return cached(`itemstats:${heroId}:${rank}:${to}`, ttl, () => fetchJson(`${API}/v1/analytics/item-stats?${q}`));
  }

  async function itemMetrics(heroId) {
    const items = await loadItems();
    let rank = 70, rows = await rawItemStats(heroId, 70);
    if (rows.length < 30 || Math.max(0, ...rows.map(r => r.matches)) < 1500) { rank = 0; rows = await rawItemStats(heroId, 0); }
    const valid = rows.filter(r => r.matches >= 100 && items.get(r.item_id)?.type === 'upgrade' && items.get(r.item_id)?.tier);
    const byTier = {};
    for (const r of valid) (byTier[items.get(r.item_id).tier] ||= []).push(r);
    const med = {}, maxM = {};
    for (const [t, arr] of Object.entries(byTier)) { med[t] = median(arr.map(r => r.wins / r.matches)); maxM[t] = Math.max(...arr.map(r => r.matches)); }
    const map = new Map();
    for (const r of valid) {
      const t = items.get(r.item_id).tier, wr = r.wins / r.matches;
      map.set(r.item_id, {
        wr, tierRel: wr - med[t], matches: r.matches, popTier: r.matches / maxM[t],
        buyMin: r.avg_buy_time_s ? r.avg_buy_time_s / 60 : null, buyRel: r.avg_buy_time_relative ?? null,
      });
    }
    return { rank, map };
  }

  async function sources(heroId) {
    return cached(`aisrc:${heroId}`, ttl, async () => {
      const items = await loadItems();
      let src = null, srcRank = 0, srcPeriod = '';
      for (const [per, rank] of [['week', 70], ['week', 0], ['month', 0]]) {
        const r = await heroTopCached(heroId, per, rank, { withSlices: false, topN: 8 });
        const ok = r.builds.filter(b => b.matches >= (rank ? 60 : 150));
        if (ok.length >= 3) { src = ok.slice(0, 6); srcRank = rank; srcPeriod = per; break; }
      }
      if (!src) return null;
      const details = (await Promise.all(src.map(async b => ({ b, d: (await fetchBuild(heroId, b.id)).hero_build })))).filter(x => x.d?.details);
      if (details.length < 3) return null;
      const weights = new Map(details.map(({ b }) => [b.id, Math.pow(b.score / 100, 1.5) + 0.05]));
      const wSum = [...weights.values()].reduce((a, c) => a + c, 0);

      const presence = new Map();
      for (const { b, d } of details) {
        const seen = new Map();
        for (const c of d.details.mod_categories || []) {
          const k = OPTIONAL_RE.test(c.name || '') ? 0.4 : 1;
          for (const m of c.mods || []) seen.set(m.ability_id, Math.max(seen.get(m.ability_id) || 0, k));
        }
        for (const [id, k] of seen) presence.set(id, (presence.get(id) || 0) + weights.get(b.id) * k);
      }
      for (const [id, v] of presence) presence.set(id, v / wSum);

      let spirit = 0, weapon = 0;
      for (const [id, v] of presence) {
        const it = items.get(id);
        if (!it || it.type !== 'upgrade' || (it.tier || 0) < 2) continue;
        if (it.slot === 'spirit') spirit += v; else if (it.slot === 'weapon') weapon += v;
      }
      const share = spirit + weapon > 0 ? spirit / (spirit + weapon) : 0.5;
      const archetype = spirit + weapon < 1 ? 'unknown' : share >= 0.62 ? 'spirit' : share <= 0.38 ? 'weapon' : 'hybrid';
      return { details, weights, presence, srcRank, srcPeriod, profile: { archetype, label: ARCH_LABEL[archetype], spiritShare: share } };
    });
  }

  async function catalog(heroId) {
    const [items, m, s] = await Promise.all([loadItems(), itemMetrics(heroId).catch(() => ({ rank: 0, map: new Map() })), sources(heroId).catch(() => null)]);
    const prof = s?.profile || { archetype: 'unknown', label: ARCH_LABEL.unknown, spiritShare: 0.5 };
    const out = [];
    for (const it of items.values()) {
      if (it.type !== 'upgrade' || !it.tier || it.shopable === false) continue;
      const st = m.map.get(it.id), pres = s?.presence.get(it.id) || 0;
      out.push({
        id: it.id, name: it.name, img: it.img, slot: it.slot, tier: it.tier, cost: it.cost,
        wr: st?.wr ?? null, tierRel: st?.tierRel ?? null, pop: st?.popTier ?? null, buyMin: st?.buyMin ?? null, matches: st?.matches ?? 0,
        pres, fit: fitOf(it, s?.profile, pres),
      });
    }
    return { statsRank: m.rank, profile: prof, items: out };
  }

  async function generate(heroId) {
    const heroes = await loadHeroes();
    const hero = heroes.find(h => h.id === heroId);
    if (!hero) throw new Error('Неизвестный герой');
    const items = await loadItems();

    const S = await sources(heroId);
    if (!S) throw new NotEnoughData(`Для героя ${hero.name} сейчас слишком мало данных о сильных сборках — автосборка не берётся собирать на пустом месте.`);
    const { details, presence, srcRank, srcPeriod, profile } = S;
    if (profile.archetype === 'unknown') throw new NotEnoughData(`Не удалось определить профиль героя ${hero.name} по сильным сборкам.`);
    const st = await itemMetrics(heroId);
    if (st.map.size < 20) throw new NotEnoughData(`Мало статистики покупок для героя ${hero.name}.`);

    const cands = [];
    for (const id of new Set([...presence.keys(), ...st.map.keys()])) {
      const it = items.get(id);
      if (!it || it.type !== 'upgrade' || !it.tier || it.shopable === false) continue;
      const s = st.map.get(id), pres = presence.get(id) || 0;
      const fit = fitOf(it, profile, pres);
      if (fit === 'bad' || fit === 'warn') continue;           
      if (!s && pres < 0.5) continue;
      const qWR = s ? clamp(0.5 + s.tierRel / 0.06) : 0.5;
      const pop = s ? s.popTier : 0.3;
      if (!(pres >= 0.2 || (pop >= 0.8 && qWR >= 0.65 && it.tier >= 2))) continue;
      if (qWR < 0.25 && pres < 0.6) continue;                  
      cands.push({ it, s, pres, qWR, pop, fit, score: 0.55 * pres + 0.25 * qWR + 0.2 * pop });
    }
    const offSlot = profile.archetype === 'spirit' ? 'weapon' : profile.archetype === 'weapon' ? 'spirit' : null;
    const phaseOf = c => {
      const rel = c.s?.buyRel, t = c.it.tier;
      if (t === 1) return 'early';
      if (t === 2) return rel != null && rel > 45 ? 'mid' : 'early';
      if (t === 3) return rel != null && rel > 70 ? 'late' : 'mid';
      return 'late';
    };
    for (const c of cands) c.phase = phaseOf(c);

    const SIZES = { early: 6, mid: 5, late: 5 };
    const chosen = { early: [], mid: [], late: [] };
    const used = new Set();
    for (const ph of Object.keys(SIZES)) {
      const pool = cands.filter(c => c.phase === ph).sort((a, b) => b.score - a.score);
      const cap = Math.ceil(SIZES[ph] * 0.67), cnt = {};
      const take = (c, strict) => {
        if (chosen[ph].length >= SIZES[ph] || used.has(c.it.id)) return;
        if (c.it.slot === offSlot && (cnt[offSlot] || 0) >= 2) return;
        if (strict && (cnt[c.it.slot] || 0) >= cap) return;
        chosen[ph].push(c); cnt[c.it.slot] = (cnt[c.it.slot] || 0) + 1; used.add(c.it.id);
      };
      pool.forEach(c => take(c, true));
      pool.forEach(c => take(c, false));
    }
    const core = [...chosen.mid, ...chosen.late];
    if (core.length && !core.some(c => c.it.slot === 'vitality')) {
      const vit = cands.filter(c => c.it.slot === 'vitality' && !used.has(c.it.id) && c.it.tier >= 3 && c.score >= 0.3).sort((a, b) => b.score - a.score)[0];
      if (vit) {
        const grp = chosen[vit.phase === 'late' ? 'late' : 'mid'];
        if (grp.length) { const worst = grp.reduce((w, c) => (c.score < w.score ? c : w)); grp.splice(grp.indexOf(worst), 1, vit); used.delete(worst.it.id); used.add(vit.it.id); }
      }
    }
    const optional = cands.filter(c => !used.has(c.it.id) && c.score >= 0.3 && !(c.it.slot === offSlot && c.pres < 0.4)).sort((a, b) => b.score - a.score).slice(0, 5);

    const byBuy = (a, b) => (a.s?.buyMin ?? 1e9) - (b.s?.buyMin ?? 1e9) || b.score - a.score;
    for (const ph of Object.keys(chosen)) chosen[ph].sort(byBuy);

    for (const c of [...core, ...chosen.early, ...optional]) {
      if (['bad', 'warn'].includes(fitOf(c.it, profile, c.pres))) throw new Error(`самопроверка не пройдена: ${c.it.name}`);
    }
    const total = core.length + chosen.early.length;
    if (total < 10) throw new NotEnoughData(`Для героя ${hero.name} набралось слишком мало надёжных предметов (${total}) — сборка вышла бы неполной.`);

    const pct = x => (x * 100).toFixed(1) + '%';
    const note = c => {
      const parts = [];
      if (c.pres > 0) parts.push(`есть в ${Math.round(c.pres * 100)}% лучших сборок`);
      if (c.s) parts.push(`винрейт с предметом ${pct(c.s.wr)} (${c.s.tierRel >= 0 ? '+' : '−'}${Math.abs(c.s.tierRel * 100).toFixed(1)} п.п. к ${c.it.tier}-му тиру)`);
      if (c.s?.buyMin) parts.push(`обычно покупают на ${Math.round(c.s.buyMin)}-й минуте`);
      return parts.join(' · ');
    };
    const cat = (name, description, arr) => ({ name, description, items: arr.map(c => ({ id: c.it.id, note: note(c) })) });

    let abilityOrder = [], abilitySource = null;
    for (const { b, d } of [...details].sort((x, y) => y.b.score - x.b.score)) {
      const ids = (d.details.ability_order?.currency_changes || []).map(x => x.ability_id);
      if (ids.length >= 14 && ids.every(id => items.get(id)?.type === 'ability')) { abilityOrder = ids.slice(0, 40); abilitySource = b; break; }
    }

    const rankLabel = srcRank >= 70 ? 'Archon+' : 'все ранги';
    const srcList = details.map(({ b, d }) => ({ id: b.id, name: d.name, wr: b.wr, matches: b.matches, score: b.score }));
    const confidence = details.length >= 5 && srcRank >= 70 && st.rank >= 70 ? 'высокая' : details.length >= 4 ? 'средняя' : 'низкая';
    const categories = [
      cat('1. Старт и лайнинг', 'Покупать слева направо. Ранние предметы обычно продаются, когда не хватает слотов.', chosen.early),
      cat('2. Мид-гейм', 'Основа сборки после лайнинга.', chosen.mid),
      cat('3. Лейт-гейм', 'Ядро на поздней стадии.', chosen.late),
    ];
    if (optional.length) categories.push(cat('Ситуативно', 'Подбирайте под состав врагов и ход матча.', optional));

    return {
      heroId,
      name: `Авто: ${hero.name} — ${new Date().toLocaleDateString('ru-RU')}`,
      description: `Профиль героя: ${profile.label} (дух ${Math.round(profile.spiritShare * 100)}% / оружие ${Math.round((1 - profile.spiritShare) * 100)}% в лучших сборках). Собрано на основе ${details.length} лучших сборок (${rankLabel}, ${srcPeriod === 'week' ? '7 дней' : '28 дней'}) и статистики покупок (${st.rank >= 70 ? 'Archon+' : 'все ранги'}, 14 дней). Уверенность: ${confidence}.`,
      categories,
      abilityOrder,
      source: { type: 'auto', buildId: abilitySource?.id || null, label: `Авто · ${profile.label.split(' — ')[0]} · ${rankLabel} · уверенность ${confidence}` },
      meta: { confidence, profile, rank: srcRank, itemStatsRank: st.rank, sources: srcList, abilityOrderFrom: abilitySource ? { id: abilitySource.id, name: details.find(x => x.b.id === abilitySource.id)?.d.name } : null },
    };
  }

  return { generate, catalog, NotEnoughData };
};
