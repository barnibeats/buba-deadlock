const MyBuilds = (() => {
  let ed = null;      
  let cat = null;     
  let dirty = false;
  let token = 0;
  const main = () => document.querySelector('#main');
  const heroOf = id => state.heroes.find(h => h.id === Number(id));
  const SLOT = { weapon: 'Оружие', vitality: 'Живучесть', spirit: 'Дух' };
  const FIT = { core: 'берут в топ-сборках', ok: 'логично', warn: 'сомнительно', bad: 'нелогично', unknown: '' };

  const send = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || r.status), { status: r.status });
    return d;
  };

  function toast(msg, label, fn) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${esc(msg)}</span>${label ? `<button class="btn small gold">${esc(label)}</button>` : ''}`;
    if (label) t.querySelector('button').onclick = () => { t.remove(); fn(); };
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  const setDirty = v => { dirty = v; window.onbeforeunload = v ? () => true : null; };
  const canLeave = () => !ed || !dirty || confirm('Есть несохранённые изменения. Выйти без сохранения?');

  const info = id => cat?.byId.get(id) || ed?.info?.get(id) || { id, name: '#' + id, img: null };
  const hydrate = b => ({
    id: b.id || null, heroId: b.heroId, name: b.name, description: b.description || '', source: b.source || { type: 'manual' },
    categories: b.categories.map(c => ({ name: c.name, description: c.description || '', items: c.items.map(x => ({ id: x.id, note: x.note || '' })) })),
    abilityOrder: b.abilityOrder || [], meta: b.meta || null,
    info: new Map(b.categories.flatMap(c => c.items).map(x => [x.id, x])),
  });
  const body = () => ({
    heroId: ed.heroId, name: ed.name, description: ed.description, source: ed.source,
    categories: ed.categories.map(c => ({ name: c.name, description: c.description, items: c.items.map(x => ({ id: x.id, note: x.note })) })),
    abilityOrder: ed.abilityOrder.map(a => a.id),
  });
  const reason = i => {
    const a = cat?.profile.archetype;
    if (a === 'spirit' && i.slot === 'weapon') return 'оружейный предмет у героя-мага';
    if (a === 'weapon' && i.slot === 'spirit') return 'духовный предмет у героя-стрелка';
    return 'не используется в сильных сборках';
  };

  async function show() {
    const my = ++token;
    ed = null; setDirty(false);
    main().innerHTML = '<div class="loading">Загрузка…</div>';
    let list;
    try { list = await api('/api/my'); } catch (e) { main().innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    if (my !== token) return;
    const opts = state.heroes.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
    const cards = list.map(b => {
      const h = heroOf(b.heroId);
      const src = b.source?.type === 'auto' ? '✦ авто' : b.source?.type === 'top' ? 'копия топ-сборки' : 'вручную';
      return `<div class="my-card" data-act="open" data-id="${b.id}">
        <img src="${esc(h?.img)}" alt=""><div class="my-info"><b>${esc(b.name)}</b>
        <div class="sub">${esc(h?.name || '')} · ${b.count} предм. · ${fmt(b.cost)} душ · ${src} · ${new Date(b.updatedAt).toLocaleDateString('ru-RU')}</div></div>
        <button class="btn small danger" data-act="delete" data-id="${b.id}" title="Удалить сборку">Удалить</button></div>`;
    }).join('');
    main().innerHTML = `<div class="hero-head"><div><h1>Мои сборки</h1>
      <div class="meta">Хранятся на этом компьютере и остаются после перезапуска. Сборку можно создать вручную, скопировать из топа или собрать автоматически.</div></div></div>
      <div class="my-new"><select id="myHero">${opts}</select>
        <button class="btn gold" data-act="new">＋ Новая сборка</button>
        <button class="btn" data-act="auto-pick">✦ Авто‑сборка</button></div>
      ${list.length ? `<div class="my-list">${cards}</div>` : '<div class="empty">Пока пусто. Создайте сборку, запустите авто‑сборку или нажмите «★ В мои сборки» у любой топ‑сборки.</div>'}`;
    const sel = document.querySelector('#myHero'); if (sel) sel.value = String(state.lastHero || state.favs[0] || state.heroes[0]?.id);
  }

  async function loadCatalog(heroId) {
    const c = await api(`/api/catalog/${heroId}`);
    c.byId = new Map(c.items.map(i => [i.id, i]));
    cat = c;
  }
  async function openSaved(id) {
    const my = ++token;
    main().innerHTML = '<div class="loading">Открываю сборку…</div>';
    try {
      const b = await api(`/api/my/${id}`);
      await loadCatalog(b.heroId);
      if (my !== token) return;
      ed = hydrate(b); setDirty(false); render();
    } catch (e) { main().innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  async function newBlank(heroId) {
    const my = ++token;
    try { await loadCatalog(heroId); } catch (e) { toast('Не удалось загрузить предметы: ' + e.message); return; }
    if (my !== token) return;
    state.lastHero = heroId;
    ed = hydrate({ heroId, name: 'Новая сборка', categories: ['1. Старт и лайнинг', '2. Мид-гейм', '3. Лейт-гейм'].map(n => ({ name: n, items: [] })) });
    setDirty(true); render();
  }
  async function generate(heroId) {
    const my = ++token;
    const h = heroOf(heroId);
    main().innerHTML = `<div class="loading">Собираю сборку для ${esc(h?.name || '')}: анализирую лучшие сборки и статистику покупок… (до 20 сек)</div>`;
    try {
      const [g] = await Promise.all([api(`/api/auto/${heroId}`), loadCatalog(heroId)]);
      if (my !== token) return;
      state.lastHero = heroId;
      ed = hydrate(g); setDirty(true); render();
    } catch (e) {
      if (my !== token) return;
      main().innerHTML = `<div class="hero-head"><div><h1>Авто‑сборка не получилась</h1><div class="meta">${esc(e.message)}</div></div></div>
        <p class="note">Это сознательно: лучше отказаться, чем выдать случайный набор предметов. Попробуйте другого героя или зайдите позже, когда накопится статистика.</p>
        <button class="btn" data-act="list">← К моим сборкам</button>`;
    }
  }

  function stats() {
    const all = ed.categories.flatMap(c => c.items).map(x => info(x.id));
    const slots = { weapon: 0, spirit: 0, vitality: 0 };
    let cost = 0; const rels = [];
    for (const i of all) { cost += i.cost || 0; if (i.slot in slots) slots[i.slot]++; if (i.tierRel != null) rels.push(i.tierRel); }
    return { n: all.length, cost, slots, avgRel: rels.length ? rels.reduce((a, b) => a + b, 0) / rels.length : null, warns: all.filter(i => i.fit === 'warn' || i.fit === 'bad') };
  }

  function itemRow(x, ci, ii, last) {
    const i = info(x.id);
    const fit = i.fit === 'bad' || i.fit === 'warn' ? ` fit-${i.fit}` : '';
    const stat = i.wr != null ? `<span class="istat" title="Винрейт игроков с этим предметом / относительно предметов того же тира">${pct(i.wr)} <em class="${i.tierRel >= 0 ? 'pos' : 'neg'}">${signed(i.tierRel)}</em></span>` : '<span class="istat muted">нет данных</span>';
    return `<div class="irow ${i.slot || ''}${fit}">
      ${i.img ? `<img src="${esc(i.img)}" alt="" data-iid="${x.id}" title="Показать описание">` : '<span class="noimg"></span>'}
      <div class="iname" data-iid="${x.id}" title="Показать описание"><b>${esc(i.name)}</b><small>${esc(SLOT[i.slot] || '')}${i.tier ? ` · T${i.tier}` : ''}${i.cost ? ` · ${fmt(i.cost)}` : ''}${fit ? ` · <span class="warn">⚠ ${esc(reason(i))}</span>` : ''}</small></div>
      <input class="inote" data-f="note" data-c="${ci}" data-i="${ii}" value="${esc(x.note)}" placeholder="Заметка…" maxlength="400" title="${esc(x.note)}">
      ${stat}
      <div class="ibtn"><button data-act="iup" data-c="${ci}" data-i="${ii}" ${ii === 0 ? 'disabled' : ''} title="Выше">↑</button><button data-act="idown" data-c="${ci}" data-i="${ii}" ${last ? 'disabled' : ''} title="Ниже">↓</button><button data-act="irm" data-c="${ci}" data-i="${ii}" title="Убрать">✕</button></div></div>`;
  }

  function render() {
    const y = window.scrollY;
    const h = heroOf(ed.heroId), s = stats();
    const m = ed.meta;
    const autoBox = m ? `<div class="auto-box"><b>Авто‑сборка — ещё не сохранена.</b> Профиль героя: <b>${esc(m.profile.label)}</b> · уверенность: <b>${esc(m.confidence)}</b>.
      Источники: ${m.sources.map(x => `<span class="chip" title="винрейт ${pct(x.wr)}, ${fmt(x.matches)} игр">${esc(x.name)}</span>`).join(' ')}
      ${m.abilityOrderFrom ? `<br>Порядок прокачки способностей — из сборки «${esc(m.abilityOrderFrom.name)}».` : ''}
      <br><span class="muted">У каждого предмета в заметке указано, почему он выбран. Сборку можно править как обычную.</span></div>` : '';
    const prof = cat?.profile;
    const warn = s.warns.length ? `<div class="warnbox">⚠ Нелогично для героя (${esc(prof?.label.split(' — ')[0] || '')}): ${s.warns.map(i => `<b>${esc(i.name)}</b> — ${esc(reason(i))}`).join('; ')}.</div>` : '';
    const cats = ed.categories.map((c, ci) => `<div class="ecat">
      <div class="ecat-h"><input class="cname" data-f="cname" data-c="${ci}" value="${esc(c.name)}" maxlength="60" placeholder="Название категории">
        <div class="ibtn"><button data-act="cup" data-c="${ci}" ${ci === 0 ? 'disabled' : ''} title="Выше">↑</button><button data-act="cdown" data-c="${ci}" ${ci === ed.categories.length - 1 ? 'disabled' : ''} title="Ниже">↓</button><button data-act="cdel" data-c="${ci}" title="Удалить категорию">✕</button></div></div>
      <input class="cdesc" data-f="cdesc" data-c="${ci}" value="${esc(c.description)}" maxlength="300" placeholder="Описание категории (необязательно)">
      <div class="ilist">${c.items.map((x, ii) => itemRow(x, ci, ii, ii === c.items.length - 1)).join('') || '<div class="muted" style="padding:6px 2px">Пусто</div>'}</div>
      <button class="btn small" data-act="add" data-c="${ci}">＋ Добавить предмет</button></div>`).join('');
    const order = ed.abilityOrder.length ? `<div class="ecat"><div class="ecat-h"><b>Порядок прокачки способностей</b><button class="btn small" data-act="clearab">Очистить</button></div>
      <div class="order">${ed.abilityOrder.map((a, i) => `<div class="o" title="${esc(a.name)}"><img src="${esc(a.img)}" alt=""><b>${i + 1}</b></div>`).join('')}</div></div>` : '';

    main().innerHTML = `<div class="ed-top"><button class="btn" data-act="back">← Назад</button>
      <div class="ed-hero"><img src="${esc(h?.img)}" alt=""><b>${esc(h?.name)}</b></div>
      <div class="ed-actions"><button class="btn" data-act="copy">Скопировать списком</button>
        ${ed.id ? '<button class="btn danger" data-act="delete-cur">Удалить</button>' : ''}<button class="btn gold" data-act="save">${ed.id ? 'Сохранить' : 'Сохранить в мои сборки'}${dirty ? ' •' : ''}</button></div></div>
      ${autoBox}
      <input class="ed-name" data-f="name" value="${esc(ed.name)}" maxlength="80" placeholder="Название сборки">
      <textarea class="ed-desc" data-f="desc" maxlength="2000" rows="2" placeholder="Описание, на что обращать внимание…">${esc(ed.description)}</textarea>
      <div class="sumbar"><span><b>${s.n}</b> предметов</span><span><b>${fmt(s.cost)}</b> душ</span>
        <span class="slots" title="Оружие / Живучесть / Дух">${['weapon', 'vitality', 'spirit'].map(k => `<i class="${k}" style="flex:${Math.max(s.slots[k], 0.05)}" title="${SLOT[k]}: ${s.slots[k]}"></i>`).join('')}</span>
        <span>О ${s.slots.weapon} · Ж ${s.slots.vitality} · Д ${s.slots.spirit}</span>
        ${s.avgRel != null ? `<span title="Средний винрейт предметов относительно предметов того же тира у этого героя">предметы к тиру: <b class="${s.avgRel >= 0 ? 'pos' : 'neg'}">${signed(s.avgRel)} п.п.</b></span>` : ''}
        ${prof && prof.archetype !== 'unknown' ? `<span class="muted">${esc(prof.label)}</span>` : ''}</div>
      ${warn}${order}${cats}
      <button class="btn" data-act="addcat">＋ Новая категория</button>`;
    window.scrollTo(0, y);
  }

  function picker(ci) {
    const f = { q: '', slot: '', tier: '', hide: true };
    const ov = document.createElement('div');
    ov.className = 'modal';
    ov.innerHTML = `<div class="modal-box"><div class="modal-h"><b>Добавить предмет → ${esc(ed.categories[ci].name)}</b><button class="btn small" data-x>Готово</button></div>
      <div class="modal-f"><input id="pq" type="search" placeholder="Поиск предмета…">
        <select id="ps"><option value="">Все типы</option><option value="weapon">Оружие</option><option value="vitality">Живучесть</option><option value="spirit">Дух</option></select>
        <select id="pt"><option value="">Все тиры</option>${[1, 2, 3, 4].map(t => `<option value="${t}">Тир ${t}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="ph" checked> скрыть нелогичные для героя</label></div>
      <div class="modal-l" id="pl"></div></div>`;
    document.body.appendChild(ov);
    const have = () => new Set(ed.categories.flatMap(c => c.items.map(x => x.id)));
    const draw = () => {
      const h = have();
      const list = cat.items.filter(i => (!f.q || i.name.toLowerCase().includes(f.q)) && (!f.slot || i.slot === f.slot) && (!f.tier || i.tier == f.tier) && !(f.hide && (i.fit === 'warn' || i.fit === 'bad')))
        .sort((a, b) => (b.pres - a.pres) || ((b.pop ?? -1) - (a.pop ?? -1)) || a.tier - b.tier).slice(0, 120);
      ov.querySelector('#pl').innerHTML = list.map(i => `<div class="prow ${i.slot} ${i.fit}" data-id="${i.id}">
        <img src="${esc(i.img)}" alt=""><div class="iname"><b>${esc(i.name)}</b><small>${esc(SLOT[i.slot] || '')} · T${i.tier} · ${fmt(i.cost || 0)}${i.pres > 0 ? ` · в ${Math.round(i.pres * 100)}% топ-сборок` : ''}${FIT[i.fit] && (i.fit === 'warn' || i.fit === 'bad') ? ` · <span class="warn">⚠ ${esc(reason(i))}</span>` : ''}</small></div>
        <span class="istat">${i.wr != null ? `${pct(i.wr)} <em class="${i.tierRel >= 0 ? 'pos' : 'neg'}">${signed(i.tierRel)}</em>` : '<span class="muted">—</span>'}</span>
        ${h.has(i.id) ? '<span class="muted">в сборке</span>' : '<button class="btn small gold">＋</button>'}</div>`).join('') || '<div class="empty">Ничего не найдено</div>';
    };
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-x]')) { ov.remove(); render(); return; }
      const row = e.target.closest('.prow'); const btn = e.target.closest('.prow button');
      if (row && btn) { ed.categories[ci].items.push({ id: Number(row.dataset.id), note: '' }); setDirty(true); draw(); }
    });
    ov.querySelector('#pq').addEventListener('input', e => { f.q = e.target.value.toLowerCase(); draw(); });
    ov.querySelector('#ps').addEventListener('change', e => { f.slot = e.target.value; draw(); });
    ov.querySelector('#pt').addEventListener('change', e => { f.tier = e.target.value; draw(); });
    ov.querySelector('#ph').addEventListener('change', e => { f.hide = e.target.checked; draw(); });
    draw(); ov.querySelector('#pq').focus();
  }

  async function saveBuild() {
    try {
      const saved = ed.id ? await send('PUT', `/api/my/${ed.id}`, body()) : await send('POST', '/api/my', body());
      const meta = ed.meta;
      ed = hydrate(saved); ed.meta = null; setDirty(false); render();
      toast(meta ? 'Сохранено в «Мои сборки»' : 'Сохранено');
    } catch (e) { toast('Не удалось сохранить: ' + e.message); }
  }
  async function remove(id, name) {
    if (!confirm(`Удалить сборку «${name}»? Это нельзя отменить.`)) return;
    try { await send('DELETE', `/api/my/${id}`); setDirty(false); toast('Сборка удалена'); show(); } catch (e) { toast('Не удалось удалить: ' + e.message); }
  }
  function asText() {
    const h = heroOf(ed.heroId);
    return [`${h?.name} — ${ed.name}`, ...ed.categories.flatMap(c => [`\n[${c.name}]`, ...c.items.map((x, i) => { const n = info(x.id); return `${i + 1}. ${n.name}${n.cost ? ` (${n.cost})` : ''}`; })])].join('\n');
  }
  const swap = (arr, a, b) => { [arr[a], arr[b]] = [arr[b], arr[a]]; };

  async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, c = Number(el.dataset.c), i = Number(el.dataset.i);
    if (a === 'open') { if (!e.target.closest('[data-act="delete"]')) openSaved(el.dataset.id); return; }
    if (a === 'delete') { e.stopPropagation(); const card = el.closest('.my-card'); remove(el.dataset.id, card.querySelector('b').textContent); return; }
    if (a === 'new') return newBlank(Number(document.querySelector('#myHero').value));
    if (a === 'auto-pick') return generate(Number(document.querySelector('#myHero').value));
    if (a === 'list') return show();
    if (a === 'auto') { 
      if (!canLeave()) return;
      state.hero = 'my'; reqToken++; save(); clearInterval(autoTimer); clearTimeout(pollTimer);
      document.querySelectorAll('.hero-btn').forEach(b => b.classList.toggle('on', b.dataset.hero === 'my'));
      return generate(Number(el.dataset.hid));
    }
    if (a === 'save-top') {
      el.disabled = true;
      try { const b = await send('POST', '/api/my', { heroId: Number(el.dataset.hid), importTop: Number(el.dataset.id) }); toast('Скопировано в «Мои сборки»', 'Открыть', () => { state.hero = 'my'; reqToken++; clearTimeout(pollTimer); document.querySelectorAll('.hero-btn').forEach(x => x.classList.toggle('on', x.dataset.hero === 'my')); clearInterval(autoTimer); openSaved(b.id); }); }
      catch (err) { toast('Не удалось скопировать: ' + err.message); }
      el.disabled = false; return;
    }
    if (!ed) return;
    switch (a) {
      case 'back': if (canLeave()) show(); return;
      case 'save': return saveBuild();
      case 'delete-cur': return remove(ed.id, ed.name);
      case 'copy': navigator.clipboard?.writeText(asText()).then(() => toast('Список скопирован')); return;
      case 'addcat': ed.categories.push({ name: 'Новая категория', description: '', items: [] }); break;
      case 'cdel': if (ed.categories[c].items.length && !confirm('Удалить категорию вместе с предметами?')) return; ed.categories.splice(c, 1); break;
      case 'cup': swap(ed.categories, c, c - 1); break;
      case 'cdown': swap(ed.categories, c, c + 1); break;
      case 'iup': swap(ed.categories[c].items, i, i - 1); break;
      case 'idown': swap(ed.categories[c].items, i, i + 1); break;
      case 'irm': ed.categories[c].items.splice(i, 1); break;
      case 'clearab': ed.abilityOrder = []; break;
      case 'add': return picker(c);
      default: return;
    }
    setDirty(true); render();
  }

  function onInput(e) {
    const f = e.target.dataset.f;
    if (!f || !ed) return;
    const c = Number(e.target.dataset.c), i = Number(e.target.dataset.i), v = e.target.value;
    if (f === 'name') ed.name = v; else if (f === 'desc') ed.description = v;
    else if (f === 'cname') ed.categories[c].name = v; else if (f === 'cdesc') ed.categories[c].description = v;
    else if (f === 'note') { ed.categories[c].items[i].note = v; e.target.title = v; }
    if (!dirty) { setDirty(true); const sb = document.querySelector('[data-act="save"]'); if (sb && !sb.textContent.includes('•')) sb.textContent += ' •'; }
  }

  let bound = false;
  const bind = () => { if (bound) return; bound = true; main().addEventListener('click', onClick); main().addEventListener('input', onInput); };
  document.addEventListener('DOMContentLoaded', bind);
  if (document.readyState !== 'loading') bind();

  return { show, canLeave, generate };
})();
