const SECTION_TITLES = { passive: 'Пассивно', active: 'Активно', innate: 'Всегда' };
const TIER_KEYS = [['t1_desc', 'T1'], ['t2_desc', 'T2'], ['t3_desc', 'T3']];

const escText = s => String(s).replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cleanHtml(src) {
  if (!src) return '';
  const h = String(src).replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/\[i\]\s*/g, '');
  const stack = [];
  let out = '', last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  for (let m; (m = re.exec(h));) {
    out += escText(h.slice(last, m.index));
    last = re.lastIndex;
    const close = m[1], tag = m[2].toLowerCase(), attrs = m[3];
    if (tag === 'br') { out += '<br>'; continue; }
    if (tag !== 'span' && tag !== 'panel') continue;
    if (close) { out += stack.pop() || ''; continue; }
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    let open = '', end = '';
    if (tag === 'span') {
      if (/highlight/i.test(cls)) { open = '<b>'; end = '</b>'; }
      else if (/diminish/i.test(cls)) { open = '<em class="dim">'; end = '</em>'; }
      else if (/attribute/i.test(cls)) { open = '<i class="attr">'; end = '</i>'; }
    }
    out += open; stack.push(end);
  }
  out += escText(h.slice(last));
  while (stack.length) out += stack.pop();
  return out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\b(или|and|or)\s*,/gi, '$1')
    .replace(/(<br>\s*){3,}/g, '<br><br>')
    .replace(/^(<br>\s*)+|(<br>\s*)+$/g, '')
    .trim();
}

const statValue = p => `${String(p.value).replace(/m$/, '')}${p.postfix ? (/^[\s%]/.test(p.postfix) ? '' : ' ') + p.postfix : ''}`.trim();
const nonZero = v => { const n = parseFloat(v); return Number.isNaN(n) ? !!v : n !== 0 && n !== 9999; };

module.exports = function createDescriber({ fetchJson, cached, api, ttl, loadHeroes }) {
  const raw = lang => cached(`raw:${lang}`, ttl, () => fetchJson(`${api}/v1/assets/items?language=${lang}`));
  const maps = () => cached('raw:maps', ttl, async () => {
    const [ru, en] = await Promise.all([raw('russian').catch(() => []), raw('english')]);
    const byId = list => new Map(list.map(i => [i.id, i]));
    return { ru: byId(ru), en: byId(en), enList: en };
  });

  async function get(id) {
    const { ru, en } = await maps();
    const r = ru.get(id), e = en.get(id), it = r || e;
    if (!it) return null;
    const isAbility = it.type === 'ability';

    const sections = [];
    const sec = (r?.tooltip_sections?.length ? r : e)?.tooltip_sections || [];
    for (const s of sec) {
      for (const a of s.section_attributes || []) {
        const html = cleanHtml(a.loc_string);
        if (html) sections.push({ title: SECTION_TITLES[s.section_type] || null, html });
      }
    }
    const d = r?.description || e?.description || {};
    if (!sections.length) { const html = cleanHtml(d.desc || e?.description?.desc); if (html) sections.push({ title: null, html }); }

    const upgrades = [];
    for (const [key, label] of TIER_KEYS) {
      const html = cleanHtml(r?.description?.[key] || e?.description?.[key]);
      if (html) upgrades.push({ tier: label, html });
    }

    const props = { ...(e?.properties || {}), ...(r?.properties || {}) };
    const stats = [];
    for (const p of Object.values(props)) {
      if (!p || !p.label || !nonZero(p.value) || p.value == null) continue;
      stats.push({ label: p.label, value: statValue(p) });
      if (stats.length >= 12) break;
    }

    let hero = null;
    const heroId = Array.isArray(it.heroes) ? it.heroes[0] : null;
    if (isAbility && heroId) hero = (await loadHeroes().catch(() => [])).find(h => h.id === heroId)?.name || null;

    return {
      id: it.id, kind: isAbility ? 'ability' : 'item', name: it.name, nameEn: e?.name && e.name !== it.name ? e.name : null,
      img: it.image_webp || it.image || null,
      slot: it.item_slot_type || null, tier: it.item_tier || null, cost: it.cost || null,
      active: !isAbility && (it.is_active_item === true || it.activation === 'press'),
      abilityType: it.ability_type || null, hero, sections, upgrades, stats,
    };
  }

  async function heroAbilities(hero) {
    if (!hero?.abilities?.length) return [];
    const { ru, enList } = await maps();
    const byClass = new Map(enList.map(i => [i.class_name, i]));
    return hero.abilities.map(c => byClass.get(c)).filter(Boolean)
      .map(i => ({ id: i.id, name: ru.get(i.id)?.name || i.name, img: i.image_webp || i.image }));
  }

  async function names() {
    const { enList } = await maps();
    return enList.filter(i => i.type === 'upgrade' && i.name && i.shopable !== false).map(i => ({ id: i.id, name: i.name }));
  }

  async function glossary() {
    const { ru, enList } = await maps();
    const heroes = lang => cached(`raw:heroes-${lang}`, ttl, () => fetchJson(`${api}/v1/assets/heroes?language=${lang}`).catch(() => []));
    const [heroesEn, heroesRu] = await Promise.all([heroes('english'), heroes('russian')]);
    const names = new Map(), labels = new Map();
    const add = (en, loc) => { if (en && loc && en.length > 2 && loc !== en && !names.has(en)) names.set(en, loc); };
    const heroRu = new Map(heroesRu.map(h => [h.id, h.name]));
    for (const h of heroesEn) add(h.name, heroRu.get(h.id));
    for (const e of enList) {
      const r = ru.get(e.id);
      if (!r) continue;
      add(e.name, r.name);
      for (const [key, p] of Object.entries(e.properties || {})) {
        const rp = (r.properties || {})[key];
        if (p?.label && rp?.label && p.label !== rp.label && !labels.has(p.label.toLowerCase())) labels.set(p.label.toLowerCase(), rp.label);
      }
    }
    return { names: [...names], labels: [...labels] };
  }

  return { get, heroAbilities, names, glossary };
};
