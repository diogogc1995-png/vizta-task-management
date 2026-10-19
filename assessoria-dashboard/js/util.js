export const MIME = {
  SHEET: 'application/vnd.google-apps.spreadsheet',
  SLIDES: 'application/vnd.google-apps.presentation',
  DOC: 'application/vnd.google-apps.document',
  FOLDER: 'application/vnd.google-apps.folder',
  PDF: 'application/pdf',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XLSM: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  XLS: 'application/vnd.ms-excel',
  JSON: 'application/json',
};

export const isSheet = (m) => m === MIME.SHEET;
export const isExcel = (m) => m === MIME.XLSX || m === MIME.XLSM || m === MIME.XLS;
export const isTabular = (m) => isSheet(m) || isExcel(m);
export const isPreviewable = (m) => !!m && m !== MIME.FOLDER && !isTabular(m) && m !== MIME.JSON;

// Paleta categórica validada (ordem fixa; ver README → Cores).
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const NEUTRAL = '#8a8984';

export const norm = (s) => String(s ?? '').trim().toLowerCase();
export const colIdx = (headers, name) => (name ? headers.findIndex((h) => norm(h) === norm(name)) : -1);
export const uid = () => Math.random().toString(36).slice(2, 10);

export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function parseA1(ref) {
  const m = /^\s*([A-Z]+)(\d+)\s*$/i.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: +m[2] - 1, col: col - 1 };
}

// Converte "1 234,56 €", "1.234,56", "1,234.56", "(500)", "45%" em número.
export function parseNum(v) {
  if (typeof v === 'number') return v;
  const str = String(v ?? '').trim();
  if (!str) return NaN;
  const neg = /^\(.*\)$/.test(str) || /^[^\d]*-/.test(str);
  let s = str.replace(/[^\d,.]/g, '');
  if (!/\d/.test(s)) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.split(',').length === 2 && s.split(',')[1].length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (ld > -1) { const p = s.split('.'); if (p.length > 2 || p[1].length === 3) s = s.replace(/\./g, ''); }
  const n = parseFloat(s);
  return neg ? -n : n;
}

const nf0 = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });
const cf = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function fmtValue(n, format = 'number') {
  if (!Number.isFinite(n)) return '—';
  if (format === 'currency') return cf.format(n);
  if (format === 'percent') return `${nf2.format(n)} %`;
  return Math.abs(n) >= 100 ? nf0.format(n) : nf2.format(n);
}

// Datas: aceita dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa e aaaa-mm-dd.
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(y, +m[2] - 1, +m[1]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toPT = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const isDateHeader = (h) => /\b(data|date|prazo)\b|[úu]ltimo contacto/i.test(h);

export function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
export function relDay(d) {
  const days = Math.round((d - startOfToday()) / 86400000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}
export const dueClass = (d) => {
  if (!d) return '';
  const days = Math.round((d - startOfToday()) / 86400000);
  return days < 0 ? 'overdue' : days <= 3 ? 'soon' : '';
};

export function applyFilter(rows, headers, f) {
  if (!f?.column || !f.values?.length) return rows;
  const i = colIdx(headers, f.column);
  if (i < 0) return rows;
  const set = new Set(f.values.map(norm));
  return rows.filter((r) => (f.mode === 'exclude' ? !set.has(norm(r.cells[i])) : set.has(norm(r.cells[i]))));
}

export function distinct(rows, i) {
  const seen = new Map();
  for (const r of rows) { const v = String(r.cells[i] ?? '').trim(); if (v && !seen.has(norm(v))) seen.set(norm(v), v); }
  return [...seen.values()];
}

export function compareCells(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (da && db) return da - db;
  const na = parseNum(a), nb = parseNum(b);
  if (/\d/.test(a) && /\d/.test(b) && Number.isFinite(na) && Number.isFinite(nb) && !/[a-z]{3}/i.test(a + b)) return na - nb;
  return String(a).localeCompare(String(b), 'pt', { sensitivity: 'base', numeric: true });
}

export function openUrl(file) {
  if (!file?.fileId) return '#';
  const id = file.fileId;
  if (file.mimeType === MIME.SHEET) return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (file.mimeType === MIME.SLIDES) return `https://docs.google.com/presentation/d/${id}/edit`;
  if (file.mimeType === MIME.DOC) return `https://docs.google.com/document/d/${id}/edit`;
  return `https://drive.google.com/file/d/${id}/view`;
}

export function previewUrl(fileId, mimeType) {
  if (mimeType === MIME.SLIDES) return `https://docs.google.com/presentation/d/${fileId}/embed?start=false&loop=false`;
  if (mimeType === MIME.DOC) return `https://docs.google.com/document/d/${fileId}/preview`;
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

// Link público de uma secção: página estática que só mostra os ficheiros indicados.
export function publicUrl(title, files) {
  const code = (m) => (m === MIME.SLIDES ? 's' : m === MIME.DOC ? 'd' : 'f');
  const u = new URL('public.html', location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('t', title);
  u.searchParams.set('f', files.map((f) => `${f.fileId}~${code(f.mimeType)}`).join(','));
  return u.toString();
}

export function stageColor(stages, value) {
  const i = (stages || []).findIndex((s) => norm(s) === norm(value));
  // Sem ciclar cores: a partir do 9.º estado fica neutro.
  return i < 0 || i >= PALETTE.length ? NEUTRAL : PALETTE[i];
}
