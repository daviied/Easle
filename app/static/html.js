// Escaping, the html`` template tag, Canvas HTML sanitizing and date formatting.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('')
  : v === false || v == null ? '' : esc(v);

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}

// ---- Canvas link mapping ----

let CANVAS = location.origin;
export function setCanvasUrl(u) { CANVAS = u; }
export const canvasUrl = (path = '') => path.startsWith('http') ? path : CANVAS + path;

/** Map a Canvas URL to an in-app route when we have a screen for it. Returns {href, external}. */
export function route(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url, CANVAS); } catch { return null; }
  const canvasHost = new URL(CANVAS).host;
  if (u.host !== canvasHost) return { href: u.href, external: true };
  const p = u.pathname;
  let m;
  if ((m = p.match(/^\/(?:courses\/\d+\/|users\/\d+\/)?files\/(\d+)/))) return { href: `/api/file/${m[1]}?inline=1`, external: true, file: m[1] };
  if ((m = p.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/))) return { href: `#/c/${m[1]}/a/${m[2]}` };
  if ((m = p.match(/^\/courses\/(\d+)\/(?:pages|wiki)\/([^/]+)\/?$/))) return { href: `#/c/${m[1]}/p/${m[2]}` };
  if ((m = p.match(/^\/courses\/(\d+)\/(?:discussion_topics|announcements)\/(\d+)\/?$/))) return { href: `#/c/${m[1]}/d/${m[2]}` };
  if ((m = p.match(/^\/courses\/(\d+)\/(modules|assignments|announcements|discussion_topics|pages|files|grades|quizzes|assignments\/syllabus)\/?$/))) {
    const tab = { discussion_topics: 'discussions', 'assignments/syllabus': 'syllabus' }[m[2]] || m[2];
    return { href: `#/c/${m[1]}/${tab}` };
  }
  if ((m = p.match(/^\/courses\/(\d+)\/?$/))) return { href: `#/c/${m[1]}` };
  return { href: u.href, external: true };
}

// ---- sanitizer (allowlist) ----

const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON',
  'TEXTAREA', 'SELECT', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'HEAD', 'TITLE', 'APPLET', 'FRAME', 'FRAMESET']);
const KEEP = new Set(['A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'COL', 'COLGROUP', 'DD', 'DEL',
  'DETAILS', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG',
  'INS', 'KBD', 'LI', 'MARK', 'OL', 'P', 'PRE', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL', 'VIDEO', 'AUDIO', 'SOURCE', 'SECTION', 'ARTICLE', 'HEADER',
  'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'CENTER']);
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'style', 'start',
  'type', 'controls', 'poster', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'scope', 'lang', 'dir', 'open']);
const STYLE_PROPS = new Set(['text-align', 'text-decoration', 'text-decoration-line', 'font-weight', 'font-style',
  'vertical-align', 'list-style-type', 'width', 'max-width', 'height', 'margin-left', 'padding-left', 'float']);

function safeUrl(v, img) {
  const s = v.trim();
  if (img && /^data:image\/(png|jpe?g|gif|webp);/i.test(s)) return s;
  try {
    const u = new URL(s, CANVAS);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}

function clean(node, doc) {
  for (const el of [...node.children]) {
    const tag = el.tagName;
    if (DROP.has(tag)) { el.remove(); continue; }
    if (tag === 'IFRAME') {
      const src = el.getAttribute('src');
      const r = src && safeUrl(src) ? route(src) : null;
      const a = doc.createElement('a');
      a.textContent = el.getAttribute('title') || 'Open embedded content';
      a.className = 'embed-link';
      if (r) { a.href = r.href; a.target = '_blank'; a.rel = 'noopener'; }
      el.replaceWith(a);
      continue;
    }
    clean(el, doc);
    if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); continue; }
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase();
      if (!ATTRS.has(n)) { el.removeAttribute(at.name); continue; }
      if (n === 'href' || n === 'src' || n === 'poster') {
        const ok = safeUrl(at.value, tag === 'IMG');
        if (!ok) { el.removeAttribute(at.name); continue; }
        if (ok.startsWith('data:')) continue;
        const r = route(ok);
        if (n === 'href') {
          el.setAttribute('href', r.href);
          if (r.external) { el.target = '_blank'; el.rel = 'noopener'; }
        } else {
          el.setAttribute(at.name, r.file ? `/api/file/${r.file}?inline=1` : ok);
        }
      } else if (n === 'style') {
        const keep = [];
        for (let i = 0; i < el.style.length; i++) {
          const p = el.style[i];
          if (STYLE_PROPS.has(p)) keep.push(`${p}:${el.style.getPropertyValue(p)}`);
        }
        keep.length ? el.setAttribute('style', keep.join(';')) : el.removeAttribute('style');
      }
    }
    if (tag === 'IMG') el.setAttribute('loading', 'lazy');
  }
}

export function sanitize(input) {
  if (!input) return raw('');
  const doc = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
  clean(doc.body, doc);
  return raw(doc.body.innerHTML);
}

export function textOf(input, max = 180) {
  if (!input) return '';
  const t = new DOMParser().parseFromString(input, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Plain text a user typed -> simple HTML paragraphs for Canvas. */
export function textToHtml(t) {
  return t.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

// ---- dates & numbers ----

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function dayLabel(iso) {
  const d = new Date(iso);
  const diff = Math.round((dayStart(d) - dayStart(new Date())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.getFullYear() === new Date().getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

export function when(iso) {
  if (!iso) return '';
  return `${dayLabel(iso)}, ${timeFmt.format(new Date(iso))}`;
}

export const time = (iso) => iso ? timeFmt.format(new Date(iso)) : '';

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return dayLabel(iso);
}

export const isoDay = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const num = (n) => n == null ? '–' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

export function bytes(n) {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(1) : n} ${u[i]}`;
}
