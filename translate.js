const VERB = {
  increased: ['увеличен', 'увеличена', 'увеличено', 'увеличены'],
  reduced: ['уменьшен', 'уменьшена', 'уменьшено', 'уменьшены'],
};
const VERB_ALIAS = { decreased: 'reduced', lowered: 'reduced', raised: 'increased' };

const MANUAL = {
  'damage': ['урон', 'm'],
  'bullet damage': ['урон пуль', 'm'],
  'base bullet damage': ['базовый урон пуль', 'm'],
  'weapon damage': ['урон от оружия', 'm'],
  'spirit damage': ['спиритический урон', 'm'],
  'melee damage': ['урон в ближнем бою', 'm'],
  'heavy melee damage': ['урон тяжёлой атаки в ближнем бою', 'm'],
  'light melee damage': ['урон лёгкой атаки в ближнем бою', 'm'],
  'impact damage': ['урон при попадании', 'm'],
  'dps': ['урон в секунду', 'm'],
  'burn dps': ['урон от горения в секунду', 'm'],
  'cooldown': ['перезарядка', 'f'],
  'duration': ['длительность', 'f'],
  'range': ['дальность', 'f'],
  'cast range': ['дальность применения', 'f'],
  'radius': ['радиус', 'm'],
  'bounce range': ['дальность отскока', 'f'],
  'falloff range': ['дальность спада урона', 'f'],
  'gun falloff range': ['дальность спада урона оружия', 'f'],
  'speed': ['скорость', 'f'],
  'move speed': ['скорость передвижения', 'f'],
  'movement speed': ['скорость передвижения', 'f'],
  'velocity': ['скорость', 'f'],
  'health': ['здоровье', 'n'],
  'max health': ['максимальное здоровье', 'n'],
  'heal': ['лечение', 'n'],
  'healing': ['лечение', 'n'],
  'heal on cast': ['лечение при применении', 'n'],
  'heal on hit': ['лечение при попадании', 'n'],
  'melee hit heal': ['лечение от удара в ближнем бою', 'n'],
  'health regen': ['восстановление здоровья', 'n'],
  'regen': ['восстановление', 'n'],
  'bullet resist': ['сопротивляемость пулям', 'f'],
  'spirit resist': ['сопротивляемость спиритическому урону', 'f'],
  'spirit resistance': ['сопротивляемость спиритическому урону', 'f'],
  'melee resist': ['сопротивляемость урону в ближнем бою', 'f'],
  'debuff resist': ['сопротивляемость ослаблениям', 'f'],
  'slow resist': ['сопротивляемость замедлению', 'f'],
  'spirit power': ['спиритическая мощь', 'f'],
  'fire rate': ['скорострельность', 'f'],
  'lifesteal': ['кража здоровья', 'f'],
  'bullet lifesteal': ['кража здоровья пулями', 'f'],
  'cast time': ['время применения', 'n'],
  'precast time': ['время подготовки', 'n'],
  'cycle time': ['время цикла', 'n'],
  'delay': ['задержка', 'f'],
  'cast delay': ['задержка применения', 'f'],
  'stun duration': ['длительность оглушения', 'f'],
  'slow duration': ['длительность замедления', 'f'],
  'silence duration': ['длительность безмолвия', 'f'],
  'sleep duration': ['длительность сна', 'f'],
  'slow': ['замедление', 'n'],
  'bounce': ['отскок', 'm'],
  'angle': ['угол', 'm'],
  'vertical angle': ['вертикальный угол', 'm'],
  'charge time': ['время зарядки', 'n'],
  'souls per minute': ['души в минуту', 'p'],
  'bounty': ['награда', 'f'],
  'stacks': ['накопления', 'p'],
  'max stacks': ['максимум накоплений', 'm'],
  'threshold': ['порог', 'm'],
  'bonus': ['бонус', 'm'],
  'bonus damage': ['дополнительный урон', 'm'],
  'spirit scaling': ['масштабирование от спиритической мощи', 'n'],
  'spirit amp': ['усиление спиритической мощи', 'n'],
  'damage amp': ['усиление урона', 'n'],
  'weapon damage reduction': ['снижение урона от оружия', 'n'],
  'health per boon': ['здоровье за каждое усиление', 'n'],
  'melee damage per boon': ['урон в ближнем бою за каждое усиление', 'm'],
  'bullet resist reduction': ['снижение сопротивляемости пулям', 'n'],
  'bullet damage growth': ['рост урона пуль', 'm'],
  'base gun damage': ['базовый урон оружия', 'm'],
  'alt fire damage per boon': ['урон альтернативного огня за каждое усиление', 'm'],
  'alt fire damage': ['урон альтернативного огня', 'm'],
  'alt fire base damage': ['базовый урон альтернативного огня', 'm'],
  'max health per second': ['максимальное здоровье в секунду', 'n'],
  'cooldown reduction': ['сокращение перезарядки', 'n'],
  'move speed slow': ['замедление скорости передвижения', 'n'],
  'heal from heroes': ['лечение от героев', 'n'],
  'damage radius': ['радиус урона', 'm'],
  'health per kill': ['здоровье за убийство', 'n'],
  'damage penalty': ['штраф к урону', 'm'],
  'channel time': ['длительность применения', 'f'],
  'base health regen': ['базовое восстановление здоровья', 'n'],
  'base hp regen': ['базовое восстановление здоровья', 'n'],
  'base cooldown': ['базовая перезарядка', 'f'],
  'charge duration': ['длительность заряда', 'f'],
  'damage reduction': ['снижение урона', 'n'],
  'stack range': ['дальность накопления', 'f'],
  'max health regen': ['восстановление от максимального здоровья', 'n'],
  'stamina cooldown': ['перезарядка выносливости', 'f'],
  'stamina regen': ['восстановление выносливости', 'n'],
  'max amp': ['максимальное усиление', 'n'],
  'resists': ['сопротивления', 'p'],
  'time to expand': ['время расширения', 'n'],
  'headshot damage': ['урон в голову', 'm'],
  'damage vs troopers': ['урон по крипам', 'm'],
};
const SUFFIXES = {
  'per boon': ['за каждое усиление'],
  'per stack': ['за накопление'],
  'per hit': ['за попадание'],
};

const UNIT = [[/(\d)\s*s\b/g, '$1 с'], [/(\d)\s*m\b/g, '$1 м']];
const ruNum = s => {
  let v = s.trim().replace(/(\d)\.(\d)/g, '$1,$2');
  for (const [re, to] of UNIT) v = v.replace(re, to);
  return v;
};
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

function genderOf(ru) {
  const head = ru.trim().split(/\s+/)[0].toLowerCase();
  if (/(ый|ий|ой)$/.test(head)) return 'm';
  if (/(ая|яя)$/.test(head)) return 'f';
  if (/(ое|ее)$/.test(head)) return 'n';
  if (/(ые|ие)$/.test(head)) return 'p';
  if (head === 'время') return 'n';
  if (/(а|я)$/.test(head)) return 'f';
  if (/(ость|сть)$/.test(head)) return 'f';
  if (/(о|е|ё)$/.test(head)) return 'n';
  if (/(ы|и)$/.test(head)) return 'p';
  return 'm';
}

module.exports = function createTranslator({ names, labels }) {
  const entities = [...names].sort((a, b) => b[0].length - a[0].length);
  const dict = new Map();
  for (const [en, ru] of labels) {
    if (/[.…]/.test(ru) || !/^[^a-zA-Z]*$/.test(ru)) continue;
    dict.set(en, [lowerFirst(ru), genderOf(ru)]);
  }
  for (const [en, v] of Object.entries(MANUAL)) dict.set(en, v);

  const ruName = new Map(entities);

  function attr(phrase) {
    let p = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!p) return null;
    if (dict.has(p)) return dict.get(p);
    for (const [suffix, [ru]] of Object.entries(SUFFIXES)) {
      if (p.endsWith(' ' + suffix)) {
        const base = dict.get(p.slice(0, -suffix.length - 1));
        if (base) return [`${base[0]} ${ru}`, base[1]];
      }
    }
    return null;
  }

  function note(n) {
    if (!n) return '';
    const m = n.match(/^moved to (T\d)$/i);
    return m ? ` (перенесено на ${m[1].toUpperCase()})` : null;
  }

  function amount(v) {
    const m = v.trim().match(/^([-+−]?\d+(?:[.,]\d+)?(?:\s*(?:%|s|m|x))?(?:-\d+(?:[.,]\d+)?)?)(?:\s+(.+))?$/);
    if (!m) return null;
    const label = m[2] ? attr(m[2]) : null;
    if (m[2] && !label) return null;
    return { num: ruNum(m[1]), label: label && label[0] };
  }

  function compose(subj, verbKey, from, to, by, noteRaw, name) {
    let tier = null;
    const tm = subj.match(/^(T[1-3])\b\s*(?:-\s*)?/);
    if (tm) { tier = tm[1]; subj = subj.slice(tm[0].length); }

    let phrase = null, gender = 'n';
    if (subj) {
      const a = attr(subj);
      if (!a) return null;
      phrase = a[0]; gender = a[1];
    } else if (!tier) return null;

    const nn = note(noteRaw);
    if (nn === null) return null;

    let tail, inner = null;
    if (by !== undefined) {
      const v = amount(by);
      if (!v) return null;
      tail = `на ${v.num}`;
      inner = v.label;
    } else {
      const fa = amount(from), fb = amount(to);
      if (!fa || !fb) return null;
      if (fa.label && fb.label && fa.label !== fb.label) return null;
      tail = `с ${fa.num} до ${fb.num}`;
      inner = fa.label || fb.label;
    }
    if (inner && phrase) return null;

    const forms = VERB[verbKey];
    const verb = forms[{ m: 0, f: 1, n: 2, p: 3 }[gender]];
    const head = [name, tier].filter(Boolean).join(', ');
    const core = phrase ? `${phrase} ${verb} ${tail}` : `${verb} ${tail}${inner ? ` (${inner})` : ''}`;
    const out = head ? `${head}: ${core}` : core;
    return (out.charAt(0).toUpperCase() + out.slice(1)) + nn;
  }

  function translate(line) {
    const text = line.replace(/\s+/g, ' ').trim();
    const m = text.match(/^(.+?) (increased|reduced|decreased|lowered|raised) (?:from (.+?) to (.+?)|by (.+?))(?: \((.+)\))?$/i);
    if (!m) return null;
    const [, subjRaw, verbRaw, from, to, by, noteRaw] = m;
    const verbKey = VERB_ALIAS[verbRaw.toLowerCase()] || verbRaw.toLowerCase();
    const subj = subjRaw.replace(/^[-–]\s*/, '').trim();

    const whole = compose(subj, verbKey, from, to, by, noteRaw, null);
    if (whole) return whole;
    for (const [en, ru] of entities) {
      if (subj === en || subj.startsWith(en + ' ')) {
        const rest = subj.slice(en.length).replace(/^\s*-\s*/, '').trim();
        const r = compose(rest, verbKey, from, to, by, noteRaw, ru);
        if (r) return r;
      }
    }
    return null;
  }

  function title(t) {
    const m = t.match(/^Minor Update - (\d\d)-(\d\d)-(\d{4})$/);
    return m ? `Небольшое обновление от ${m[2]}.${m[1]}.${m[3]}` : null;
  }

  return { line: translate, title, ruName: en => ruName.get(en) || null };
};
