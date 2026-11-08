const NEWS_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=60&maxlength=0';
const OFFICIAL_FEED = 'steam_community_announcements';
const MAX_POSTS = 25;

const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = html => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

function balance(html) {
  const open = [];
  const out = html.replace(/<(\/?)([biu])>/g, (m, close, tag) => {
    if (!close) { open.push(tag); return m; }
    const i = open.lastIndexOf(tag);
    if (i === -1) return '';
    open.splice(i, 1);
    return m;
  });
  return out + open.reverse().map(t => `</${t}>`).join('');
}

function parseBlocks(src) {
  const blocks = [];
  let buf = '', mode = 'p', skip = 0;
  const flush = () => {
    for (const part of buf.split(/\n{2,}/)) {
      const html = balance(part.trim().replace(/\n/g, '<br>')).replace(/https?:\/\/\S+/g, '').trim();
      if (plain(html)) blocks.push({ t: mode, html });
    }
    buf = '';
  };
  const re = /\[(\/?)([a-z0-9*]+)(?:[= ][^\]]*)?\]/gi;
  let last = 0;
  for (let m; (m = re.exec(src));) {
    if (!skip) buf += escText(src.slice(last, m.index));
    last = re.lastIndex;
    const close = !!m[1], tag = m[2].toLowerCase();
    if (tag === 'img') { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (skip) continue;
    if (/^h[1-6]$/.test(tag)) { flush(); mode = close ? 'p' : 'h'; }
    else if (tag === 'p' || tag === 'list' || tag === 'olist' || tag === 'quote' || tag === 'table' || tag === 'tr') { flush(); mode = 'p'; }
    else if (tag === '*') { flush(); mode = 'li'; }
    else if (tag === 'b' || tag === 'i' || tag === 'u') buf += close ? `</${tag}>` : `<${tag}>`;
    else if (tag === 'strike') buf += close ? '</i>' : '<i>';
  }
  if (!skip) buf += escText(src.slice(last));
  flush();
  return blocks;
}

const GLUE = /(?<=[a-z0-9%).!"'])- (?=[A-Z][A-Za-z0-9'’ &.]{1,40}: )/;
const splitGlued = b => (b.t === 'h' ? [b] : b.html.split(GLUE).map(html => ({ ...b, html: html.trim() })).filter(x => plain(x.html)));

const classify = (title, changes) => (/season|ranked/i.test(title) ? 'season' : changes || /update|patch|hotfix|fix|balance/i.test(title) ? 'update' : 'news');

module.exports = function createNews({ fetchJson, cached, heroes, items, onNew }) {
  let lastGid = null;

  async function load() {
    const data = await fetchJson(NEWS_URL);
    const posts = (data.appnews?.newsitems || []).filter(n => n.feedname === OFFICIAL_FEED).slice(0, MAX_POSTS);
    if (posts.length) {
      if (lastGid && lastGid !== posts[0].gid && onNew) onNew();
      lastGid = posts[0].gid;
    }
    return posts;
  }

  function mentions(text, list) {
    const seen = new Set(), found = [];
    for (const e of list) {
      if (e.name.length < 4 || seen.has(e.id)) continue;
      const safe = e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^A-Za-z0-9])${safe}(?![A-Za-z0-9])`).test(text)) { seen.add(e.id); found.push(e); }
    }
    return found;
  }

  function shape(n, heroList, itemList) {
    const blocks = parseBlocks(n.contents || '').flatMap(splitGlued);
    const heroByName = new Map(heroList.map(h => [h.name, h]));
    const itemByName = new Map(itemList.map(i => [i.name, i]));
    const groups = new Map(), body = [];
    let changes = 0;
    for (const b of blocks) {
      const text = plain(b.html);
      const m = b.t !== 'h' && text.match(/^([-–•·*]\s*)?([A-Za-z][A-Za-z0-9'’ .&-]{1,45}?):\s+\S/);
      const subject = m && m[2].trim();
      const known = subject && (heroByName.get(subject) || itemByName.get(subject));
      if (m && (known || m[1] || b.t === 'li')) {
        const rest = b.html.replace(/^[-–•·*\s]*(?:<[^>]+>)*[^:<]{1,48}?:\s*/, '');
        let g = groups.get(subject);
        if (!g) {
          const h = heroByName.get(subject), it = itemByName.get(subject);
          g = { name: subject, kind: h ? 'hero' : it ? 'item' : 'other', id: (h || it)?.id || null, lines: [] };
          groups.set(subject, g);
        }
        g.lines.push(rest);
        changes++;
      } else body.push(b);
    }
    const all = blocks.map(b => plain(b.html)).join('\n');
    return {
      id: n.gid, title: n.title, date: n.date, url: n.url, tag: classify(n.title, changes), changes,
      groups: [...groups.values()], body,
      heroes: mentions(all, heroList), items: mentions(all, itemList),
    };
  }

  const list = () => cached('news:list', 10 * 60 * 1000, async () => {
    const [raw, heroList, itemList] = await Promise.all([load(), heroes(), items()]);
    return raw.map(n => shape(n, heroList, itemList));
  });

  return { list };
};
