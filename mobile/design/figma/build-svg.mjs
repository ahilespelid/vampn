// Генератор SVG-макетов vampn для импорта в Figma.
// Запуск: node build-svg.mjs  ->  файлы появятся в папке svg/ рядом со скриптом.
// Цвета берутся из src/theme.ts, размеры и отступы повторяют src/ui.tsx и экраны.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'svg');

// ---------- токены из theme.ts

const themeSrc = readFileSync(join(here, '..', '..', 'src', 'theme.ts'), 'utf8');

function readTheme(name) {
  const block = themeSrc.match(new RegExp(`export const ${name}: AppTheme = \\{([\\s\\S]*?)\\n\\};`));
  if (!block) {
    throw new Error(`В theme.ts нет ${name}`);
  }
  const t = {};
  for (const m of block[1].matchAll(/^\s*(\w+):\s*'([^']+)',?\s*$/gm)) {
    t[m[1]] = m[2];
  }
  for (const key of ['bg', 'surface', 'surfaceAlt', 'text', 'muted', 'border', 'signal', 'signalText', 'ok', 'button', 'buttonText']) {
    if (!t[key]) {
      throw new Error(`В ${name} нет цвета ${key}`);
    }
  }
  return t;
}

const THEMES = {light: readTheme('lightTheme'), dark: readTheme('darkTheme')};

// ---------- общие размеры (телефон 390 x 844, вырез 47, жест 34)

const W = 390;
const H = 844;
const INSET_TOP = 47;
const INSET_BOTTOM = 34;
const TAB_H = 12 + 6 + 5 + 13 + 12 + INSET_BOTTOM;

const MONO = "Menlo, 'SF Mono', Consolas, 'Courier New', monospace";
const SANS = "-apple-system, 'SF Pro Text', 'Segoe UI', Roboto, Arial, sans-serif";

const TR = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'};
const slug = str =>
  str
    .toLowerCase()
    .replace(/[а-яё]/g, c => TR[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const esc = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = v => String(Math.round(v * 100) / 100);
const monoW = (size, ls = 0) => size * 0.6 + ls;
/** Базовая линия строки: верх строки, размер шрифта, высота строки. */
const baseline = (top, size, lh) => top + (lh - size) / 2 + size * 0.88;

// ---------- холст

class Canvas {
  constructor(theme) {
    this.t = theme;
    this.out = [];
    this.ids = new Map();
  }

  id(prefix, text = '') {
    const tail = text ? slug(text) : '';
    const base = tail ? `${prefix}-${tail}` : prefix;
    const count = (this.ids.get(base) ?? 0) + 1;
    this.ids.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }

  open(id, attrs = '') {
    this.out.push(`<g id="${id}"${attrs ? ` ${attrs}` : ''}>`);
  }

  close() {
    this.out.push('</g>');
  }

  group(id, fn, attrs) {
    this.open(id, attrs);
    fn();
    this.close();
  }

  rectStr({x, y, w, h, r = 0, fill = 'none', stroke, id, opacity}) {
    const a = [];
    if (id) {
      a.push(`id="${id}"`);
    }
    a.push(`x="${num(x)}"`, `y="${num(y)}"`, `width="${num(w)}"`, `height="${num(h)}"`);
    if (r) {
      a.push(`rx="${num(r)}"`);
    }
    a.push(`fill="${fill}"`);
    if (stroke) {
      a.push(`stroke="${stroke}"`, 'stroke-width="1"');
    }
    if (opacity !== undefined) {
      a.push(`opacity="${opacity}"`);
    }
    return `<rect ${a.join(' ')}/>`;
  }

  rect(o) {
    this.out.push(this.rectStr(o));
  }

  /** Прямоугольник с рамкой внутри границы, как border в React Native. */
  boxStr({x, y, w, h, r = 0, fill = 'none', border, id, opacity}) {
    return border
      ? this.rectStr({x: x + 0.5, y: y + 0.5, w: w - 1, h: h - 1, r: Math.max(r - 0.5, 0), fill, stroke: border, id, opacity})
      : this.rectStr({x, y, w, h, r, fill, id, opacity});
  }

  box(o) {
    this.out.push(this.boxStr(o));
  }

  circle(cx, cy, r, fill, id) {
    this.out.push(`<circle${id ? ` id="${id}"` : ''} cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill}"/>`);
  }

  text(x, y, str, {size = 15, fill, mono = false, weight, ls, anchor, id, opacity} = {}) {
    const a = [];
    if (id) {
      a.push(`id="${id}"`);
    }
    a.push(`x="${num(x)}"`, `y="${num(y)}"`, `font-family="${mono ? MONO : SANS}"`, `font-size="${size}"`);
    if (weight) {
      a.push(`font-weight="${weight}"`);
    }
    if (ls) {
      a.push(`letter-spacing="${ls}"`);
    }
    if (anchor) {
      a.push(`text-anchor="${anchor}"`);
    }
    a.push(`fill="${fill ?? this.t.text}"`);
    if (opacity !== undefined) {
      a.push(`opacity="${opacity}"`);
    }
    this.out.push(`<text ${a.join(' ')}>${esc(str)}</text>`);
  }

  svg(title) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<title>${esc(title)}</title>`,
      this.rectStr({x: 0, y: 0, w: W, h: H, fill: this.t.bg, id: 'background'}),
      ...this.out,
      '</svg>',
      '',
    ].join('\n');
  }
}

// ---------- компоненты (повторяют src/ui.tsx)

function label(s, x, y, str, o = {}) {
  s.text(x, baseline(y, 11, 14), str, {size: 11, mono: true, ls: 1.4, fill: o.fill ?? s.t.muted, anchor: o.anchor, id: s.id('label', str)});
  return y + 14;
}

/** Абзац: каждая строка своим текстовым слоем. Возвращает нижнюю границу. */
function para(s, x, y, lines, o = {}) {
  const size = o.mono ? 13 : 15;
  const lh = o.mono ? 19 : 21;
  lines.forEach((line, i) => {
    s.text(x, baseline(y + i * lh, size, lh), line, {
      size,
      mono: o.mono,
      weight: o.bold ? (o.mono ? 700 : 600) : undefined,
      fill: o.muted ? s.t.muted : s.t.text,
      anchor: o.anchor,
    });
  });
  return y + lines.length * lh;
}

function card(s, {x = 20, y, w = 350, pad = 16, border, id, opacity}, draw) {
  s.open(id, opacity !== undefined ? `opacity="${opacity}"` : '');
  const slot = s.out.length;
  s.out.push('');
  const bottom = draw(x + pad, y + pad, w - pad * 2);
  const h = bottom - y + pad;
  s.out[slot] = s.boxStr({x, y, w, h, r: 12, fill: s.t.surface, border: border ?? s.t.border, id: `${id}-bg`});
  s.close();
  return y + h;
}

const btnW = (title, small) => Math.ceil(title.length * monoW(small ? 12 : 14, 1)) + (small ? 32 : 44) + 2;

function btn(s, {x, y, w, title, kind = 'primary', small = false, off = false}) {
  const t = s.t;
  const h = small ? 40 : 52;
  const size = small ? 12 : 14;
  const width = w ?? btnW(title, small);
  const fill = kind === 'primary' ? t.button : kind === 'signal' ? t.signal : 'none';
  const fg = kind === 'primary' ? t.buttonText : kind === 'signal' ? t.signalText : t.text;
  s.group(
    s.id('button', title),
    () => {
      s.box({x, y, w: width, h, r: 24, fill, border: kind === 'ghost' ? t.border : undefined});
      s.text(x + width / 2, y + h / 2 + size * 0.36, title, {size, mono: true, weight: 600, ls: 1, fill: fg, anchor: 'middle'});
    },
    off ? 'opacity="0.45"' : '',
  );
  return {w: width, h, bottom: y + h};
}

/** Ряд кнопок с переносом, как flexWrap в приложении. */
function flow(s, x, y, w, items, gap) {
  let cx = x;
  let cy = y;
  for (const item of items) {
    const bw = btnW(item.title, true);
    if (cx > x && cx + bw > x + w) {
      cx = x;
      cy += 40 + gap;
    }
    btn(s, {...item, x: cx, y: cy, w: bw, small: true});
    cx += bw + gap;
  }
  return cy + 40;
}

const pillW = str => Math.round(str.length * monoW(10, 1) + 20);

function pill(s, x, y, str, tone = 'muted') {
  const t = s.t;
  const color = tone === 'ok' ? t.ok : tone === 'signal' ? t.signal : t.muted;
  const w = pillW(str);
  s.group(s.id('pill', str), () => {
    s.box({x, y, w, h: 20, r: 10, border: color});
    s.text(x + 10, y + 10 + 3.6, str, {size: 10, mono: true, ls: 1, fill: color});
  });
  return w;
}

/** Переключатель. Каждый вариант: массив строк (длинная подпись переносится). */
function seg(s, x, y, w, options, active) {
  const t = s.t;
  const gap = 4;
  const maxLines = Math.max(...options.map(o => o.length));
  const itemH = 18 + 14 * maxLines;
  const itemW = (w - 8 - gap * (options.length - 1)) / options.length;
  s.group(s.id('segmented', options[0].join(' ')), () => {
    s.rect({x, y, w, h: itemH + 8, r: 24, fill: t.surfaceAlt, id: s.id('segmented-bg')});
    options.forEach((lines, i) => {
      const ix = x + 4 + i * (itemW + gap);
      const on = i === active;
      if (on) {
        s.rect({x: ix, y: y + 4, w: itemW, h: itemH, r: 20, fill: t.button});
      }
      lines.forEach((line, k) => {
        s.text(ix + itemW / 2, baseline(y + 4 + 9 + k * 14, 12, 14), line, {size: 12, mono: true, ls: 0.8, fill: on ? t.buttonText : t.text, anchor: 'middle'});
      });
    });
  });
  return y + itemH + 8;
}

function field(s, x, y, w, name, value, o = {}) {
  const t = s.t;
  const inputH = o.big ? 60 : 46;
  const top = label(s, x, y, name) + 6;
  s.group(s.id('field', name), () => {
    s.box({x, y: top, w, h: inputH, r: 12, fill: t.surface, border: t.border});
    if (o.big) {
      s.text(x + w / 2, top + inputH / 2 + 10, value, {size: 28, mono: true, ls: 10, anchor: 'middle'});
    } else {
      s.text(x + 14, top + inputH / 2 + 5.5, value, {size: 16});
    }
  });
  return top + inputH;
}

function kv(s, x, y, w, k, v) {
  s.text(x, baseline(y + 4, 11, 14), k, {size: 11, mono: true, ls: 1.4, fill: s.t.muted});
  s.text(x + w, baseline(y + 4, 13, 19), v, {size: 13, mono: true, anchor: 'end'});
  return y + 27;
}

// ---------- каркас экрана

const TABS = [
  ['service', 'СЕРВИС'],
  ['keys', 'КЛЮЧИ'],
  ['stats', 'СТАТИСТИКА'],
  ['users', 'ЛЮДИ'],
  ['settings', 'ЕЩЁ'],
];

function statusBar(s) {
  const t = s.t;
  s.group('status-bar', () => {
    s.text(32, 31, '9:41', {size: 15, weight: 600});
    s.box({x: 326, y: 20, w: 25, h: 12, r: 4, border: t.muted});
    s.rect({x: 328, y: 22, w: 17, h: 8, r: 2, fill: t.text});
    s.rect({x: 352, y: 24, w: 2, h: 4, r: 1, fill: t.muted});
  });
}

function tabBar(s, active, badges = {}) {
  const t = s.t;
  const top = H - TAB_H;
  s.group('tab-bar', () => {
    s.rect({x: 0, y: top, w: W, h: TAB_H, fill: t.surface, id: 'tab-bar-bg'});
    s.rect({x: 0, y: top, w: W, h: 1, fill: t.border, id: 'tab-bar-border'});
    TABS.forEach(([id, name], i) => {
      const cx = 39 + 78 * i;
      const on = id === active;
      const badge = badges[id] > 0 ? ` ${badges[id]}` : '';
      s.group(`tab-${id}`, () => {
        s.circle(cx, top + 12 + 3, 3, on ? t.signal : 'none');
        s.text(cx, baseline(top + 12 + 6 + 5, 10, 13), `${name}${badge}`, {size: 10, mono: true, ls: 0.8, fill: on ? t.text : t.muted, anchor: 'middle'});
      });
    });
  });
}

/** Заголовок страницы; возвращает верхнюю границу содержимого. */
function pageHead(s, title, right) {
  const top = INSET_TOP + 8;
  const rowH = right ? 40 : 31;
  s.group('header', () => {
    s.text(20, baseline(top + (rowH - 31) / 2, 26, 31), title, {size: 26, mono: true, weight: 700, ls: 0.5, id: 'title'});
    if (right) {
      right(top);
    }
  });
  return top + rowH + 12;
}

/** Плашка над вкладками, пока нет связи с сервером (src/OfflineBar.tsx). */
function offlineBar(s) {
  const t = s.t;
  const h = 83;
  const top = H - TAB_H - h;
  s.group('offline-bar', () => {
    s.rect({x: 0, y: top, w: W, h, fill: t.surface, id: 'offline-bar-bg'});
    s.rect({x: 0, y: top, w: W, h: 2, fill: t.signal, id: 'offline-bar-border'});
    // текстовый блок шириной 218 (390 - отступы - точка - кнопка), точка и кнопка по его центру
    s.circle(21, top + 2 + (h - 2) / 2, 5, t.signal);
    para(s, 38, top + 2 + 12, ['Нет связи с сервером'], {bold: true});
    s.text(38, baseline(top + 2 + 12 + 21, 13, 18), 'Проверьте интернет. Данные на', {size: 13, fill: t.muted});
    s.text(38, baseline(top + 2 + 12 + 39, 13, 18), 'экране могут быть устаревшими.', {size: 13, fill: t.muted});
    btn(s, {x: W - 16 - btnW('ПОВТОРИТЬ', true), y: top + 2 + (h - 2 - 40) / 2, title: 'ПОВТОРИТЬ', kind: 'ghost', small: true});
  });
}

// ---------- экраны (образцовые данные, не настоящие)

function loginHead(s, lines) {
  const t = s.t;
  const top = INSET_TOP + 48;
  s.group('logo', () => {
    s.circle(24 + 6, top + 26.5, 6, t.signal, 'logo-dot');
    s.text(24 + 12 + 10, baseline(top, 44, 53), 'vampn', {size: 44, mono: true, weight: 700, ls: 1, id: 'logo-text'});
  });
  return para(s, 24, top + 53 + 10, lines, {muted: true});
}

function login(s) {
  statusBar(s);
  let y = loginHead(s, ['Вход только для тех, кто есть в списке.', 'Введите свою почту: на неё придёт код из 4', 'цифр.']) + 24;
  y = field(s, 24, y, 342, 'ПОЧТА', 'name@example.com') + 14;
  btn(s, {x: 24, y, w: 342, title: 'ПОЛУЧИТЬ КОД'});
  label(s, 24, H - INSET_BOTTOM - 24 - 14, 'СЕРВЕР: VAMP.NEW.LITEWMS.RU · ИЗМЕНИТЬ');
}

function loginCode(s) {
  statusBar(s);
  let y = loginHead(s, ['Код отправлен на name@example.com. Он', 'действует 10 минут.']) + 24;
  y = field(s, 24, y, 342, 'КОД ИЗ ПИСЬМА', '4821', {big: true}) + 14;
  y = btn(s, {x: 24, y, w: 342, title: 'ВОЙТИ'}).bottom + 14;
  btn(s, {x: 24, y, w: 166, title: 'ДРУГАЯ ПОЧТА', kind: 'ghost', small: true});
  btn(s, {x: 24 + 176, y, w: 166, title: 'КОД ЕЩЁ РАЗ · 24', kind: 'ghost', small: true, off: true});
}

function service(s, {offline = false} = {}) {
  statusBar(s);
  let y = pageHead(s, 'сервис');
  y =
    card(s, {y, id: 'card-address'}, (x, top, w) => {
      let yy = label(s, x, top, 'СМЕНА АДРЕСА') + 14;
      yy = para(s, x, yy, ['Если VPN перестал работать, смените IP', 'сервера. Обычно сторож делает это сам,', 'кнопка нужна для ручного запуска.'], {muted: true}) + 14;
      yy = seg(s, x, yy, w, [['ЕСЛИ ЗАБЛОКИРОВАН'], ['ПРИНУДИТЕЛЬНО']], 0) + 14;
      yy = btn(s, {x, y: yy, w, title: 'СМЕНИТЬ IP', kind: 'signal'}).bottom + 14;
      const half = (w - 10) / 2;
      btn(s, {x, y: yy, w: half, title: 'ПЕРЕЗАГРУЗИТЬ', kind: 'ghost', small: true});
      btn(s, {x: x + half + 10, y: yy, w: half, title: 'О СЕРВЕРЕ', kind: 'ghost', small: true});
      return yy + 40;
    }) + 14;
  y =
    card(s, {y, id: 'card-status'}, (x, top) => {
      const yy = label(s, x, top, 'СОСТОЯНИЕ') + 8;
      return para(s, x, yy, ['сторож: работает', 'туннель: поднят, рукопожатие 12 с назад', 'адрес: 203.0.113.10'], {mono: true});
    }) + 14;
  card(s, {y, id: 'card-emergency'}, (x, top, w) => {
    let yy = label(s, x, top, 'АВАРИЙНЫЙ КАНАЛ') + 12;
    yy = para(s, x, yy, ['выключен'], {mono: true}) + 12;
    return flow(s, x, yy, w, [{title: 'ВКЛЮЧИТЬ', kind: 'ghost'}, {title: 'ВЫКЛЮЧИТЬ', kind: 'ghost'}], 10);
  });
  if (offline) {
    offlineBar(s);
  }
  tabBar(s, 'service');
}

function keys(s) {
  statusBar(s);
  let y = pageHead(s, 'ключи');
  y = label(s, 20, y, 'МОИ КЛЮЧИ') + 14;
  y =
    card(s, {y, id: 'card-key-ahilespelid'}, (x, top, w) => {
      s.text(x, baseline(top + 0.5, 13, 19), 'ahilespelid', {size: 13, mono: true, weight: 700});
      pill(s, x + w - pillW('СУПЕРАДМИН'), top, 'СУПЕРАДМИН', 'signal');
      return flow(
        s,
        x,
        top + 20 + 12,
        w,
        [{title: 'ПОЛУЧИТЬ ССЫЛКУ'}, {title: 'НА ПОЧТУ', kind: 'ghost'}, {title: 'ПЕРЕВЫПУСТИТЬ', kind: 'ghost'}],
        8,
      );
    }) + 14;
  y = label(s, 20, y + 8, 'УВЕДОМЛЕНИЯ · НОВЫХ 1') + 14;
  y =
    card(s, {y, id: 'card-notification', border: s.t.signal}, (x, top, w) => {
      s.text(x, baseline(top, 15, 21), 'Новый ключ для ahilespelid', {size: 15, weight: 600});
      pill(s, x + w - pillW('НА ПОЧТЕ'), top, 'НА ПОЧТЕ');
      let yy = top + 21 + 10;
      yy = para(s, x, yy, ['ahilespelid · 24.11.2026 15:21'], {mono: true, muted: true}) + 10;
      return btn(s, {x, y: yy, title: 'ПОЛУЧИТЬ ССЫЛКУ', small: true}).bottom;
    }) + 14;
  y = label(s, 20, y + 8, 'ИСТОРИЯ ВЫДАЧИ') + 14;
  y = seg(s, 20, y, 350, [['МОИ'], ['ВСЕ']], 0) + 14;
  const history = [
    ['ahilespelid', 'выдан', '24.11.2026 15:21 · system'],
    ['ahilespelid', 'отправлен повторно', '12.11.2026 09:40 · ahilespelid'],
  ];
  history.forEach(([name, reason, meta], i) => {
    y =
      card(s, {y, id: `card-history-${i + 1}`}, (x, top, w) => {
        s.text(x, baseline(top, 13, 19), name, {size: 13, mono: true, weight: 700});
        s.text(x + w, baseline(top, 13, 19), reason, {size: 13, mono: true, fill: s.t.muted, anchor: 'end'});
        return para(s, x, top + 19 + 4, [meta], {mono: true, muted: true});
      }) + 14;
  });
  tabBar(s, 'keys', {keys: 1});
}

const BARS = [1, 1, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 5, 5, 6, 7, 8, 8, 7, 6, 6, 7, 8, 9, 9, 8, 7, 7, 6, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 5, 4, 4, 5, 7];

function stats(s) {
  const t = s.t;
  statusBar(s);
  let y = pageHead(s, 'статистика');
  y = seg(s, 20, y, 350, [['СУТКИ'], ['3 ДНЯ'], ['НЕДЕЛЯ']], 0) + 14;
  y =
    card(s, {y, id: 'card-online'}, (x, top, w) => {
      let yy = label(s, x, top, 'ПОДКЛЮЧЕНО ОДНОВРЕМЕННО') + 12;
      const bottom = yy + 120;
      const peak = Math.max(...BARS, 1);
      const bw = (w - (BARS.length - 1) * 2) / BARS.length;
      s.group('chart', () => {
        BARS.forEach((v, i) => {
          const h = Math.max(3, (v / peak) * 120);
          const last = i === BARS.length - 1;
          s.rect({x: x + i * (bw + 2), y: bottom - h, w: bw, h, r: 1, fill: last ? t.signal : t.text, opacity: last ? 1 : 0.8});
        });
      });
      yy = bottom + 12;
      yy = kv(s, x, yy, w, 'СЕЙЧАС', String(BARS[BARS.length - 1]));
      yy = kv(s, x, yy, w, 'МАКСИМУМ', String(Math.max(...BARS)));
      yy = kv(s, x, yy, w, 'МИНИМУМ', String(Math.min(...BARS)));
      return kv(s, x, yy, w, 'ПОСЛЕДНИЙ ЗАМЕР', '24.11.2026 15:20');
    }) + 14;
  para(s, 20, y, ['Метрики хранятся в базе на сервере и', 'собираются автоматически.'], {muted: true});
  tabBar(s, 'stats');
}

function users(s) {
  statusBar(s);
  let y = pageHead(s, 'люди', top => btn(s, {x: W - 20 - btnW('ДОБАВИТЬ', true), y: top, title: 'ДОБАВИТЬ', small: true}));
  y = kv(s, 20, y, 350, 'АКТИВНЫХ', '4') + 14;
  const person = (name, email, o = {}) => {
    y =
      card(s, {y, id: `card-user-${name}`, opacity: o.revoked ? 0.6 : undefined}, (x, top, w) => {
        s.text(x, baseline(top + (o.admin ? 0.5 : 0), 13, 19), name, {size: 13, mono: true, weight: 700});
        if (o.admin) {
          pill(s, x + w - pillW('СУПЕРАДМИН'), top, 'СУПЕРАДМИН', 'signal');
        }
        let yy = top + (o.admin ? 20 : 19) + 4;
        yy = para(s, x, yy, [email], {mono: true, muted: true});
        return o.revoked ? para(s, x, yy + 4, ['отозван 12.11.2026 10:04'], {mono: true, muted: true}) : yy;
      }) + 14;
  };
  person('ahilespelid', 'admin@example.com', {admin: true});
  person('mio', 'mio@example.com');
  person('andrey', 'andrey@example.com');
  person('griga', 'griga@example.com');
  y = label(s, 20, y + 8, 'ОТОЗВАННЫЕ · 1') + 14;
  person('old-key', 'old@example.com', {revoked: true});
  tabBar(s, 'users');
}

function settings(s) {
  statusBar(s);
  let y = pageHead(s, 'ещё');
  y =
    card(s, {y, id: 'card-account'}, (x, top, w) => {
      let yy = label(s, x, top, 'АККАУНТ') + 10;
      yy = para(s, x, yy, ['me@example.com'], {mono: true}) + 10;
      pill(s, x, yy, 'СУПЕРАДМИН', 'signal');
      yy += 20 + 10 + 4;
      return kv(s, x, yy, w, 'КЛЮЧ', 'ahilespelid');
    }) + 14;
  y =
    card(s, {y, id: 'card-theme'}, (x, top, w) => {
      const yy = label(s, x, top, 'ОФОРМЛЕНИЕ') + 12;
      return seg(s, x, yy, w, [['КАК В', 'СИСТЕМЕ'], ['СВЕТЛАЯ'], ['ТЁМНАЯ']], 0);
    }) + 14;
  y =
    card(s, {y, id: 'card-server'}, (x, top, w) => {
      let yy = label(s, x, top, 'СЕРВЕР') + 12;
      yy = para(s, x, yy, ['При смене адреса вы выйдете из аккаунта:', 'вход выполняется на выбранном сервере.'], {muted: true}) + 12;
      yy = field(s, x, yy, w, 'АДРЕС СЕРВЕРА', 'https://vamp.new.litewms.ru') + 12;
      return flow(s, x, yy, w, [{title: 'ПРОВЕРИТЬ', kind: 'ghost'}, {title: 'СОХРАНИТЬ'}, {title: 'ПО УМОЛЧАНИЮ', kind: 'ghost'}], 10);
    }) + 14;
  btn(s, {x: 20, y, w: 350, title: 'ВЫЙТИ', kind: 'ghost'});
  tabBar(s, 'settings');
}

// ---------- сборка

const SCREENS = {
  login,
  'login-code': loginCode,
  service,
  'service-offline': s => service(s, {offline: true}),
  keys,
  stats,
  users,
  settings,
};

mkdirSync(outDir, {recursive: true});
let count = 0;
for (const [themeName, theme] of Object.entries(THEMES)) {
  for (const [name, draw] of Object.entries(SCREENS)) {
    const canvas = new Canvas(theme);
    draw(canvas);
    writeFileSync(join(outDir, `${name}-${themeName}.svg`), canvas.svg(`vampn / ${name} / ${themeName}`), 'utf8');
    count += 1;
  }
}
console.log(`Готово: ${count} файлов в ${outDir}`);
