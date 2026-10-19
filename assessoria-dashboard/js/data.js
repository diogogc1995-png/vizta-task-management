// Cache partilhado das folhas lidas, para que vários widgets da mesma fonte façam um só pedido.
import { useState, useEffect } from './lib.js';
import { isSheet, colLetter, parseDate, toISO } from './util.js';

let api = null;
export const setApi = (a) => { api = a; };

const entries = new Map();
const syncListeners = new Set();
let lastSync = null;

const keyOf = (s) => (s?.fileId ? `${s.fileId}|${s.tab || ''}|${s.headerRow || 1}` : null);
const notifySync = () => syncListeners.forEach((l) => l());

function shape(values, headerRow, extra) {
  const width = Math.max(0, ...values.map((r) => r.length));
  const hr = Math.max(1, headerRow || 1);
  const raw = values[hr - 1] || [];
  const headers = Array.from({ length: width }, (_, i) => String(raw[i] ?? '').trim() || colLetter(i));
  const rows = [];
  for (let i = hr; i < values.length; i++) {
    const r = values[i] || [];
    if (r.every((c) => c === '' || c == null)) continue;
    rows.push({ _row: i + 1, cells: headers.map((_, j) => (r[j] == null ? '' : String(r[j]))) });
  }
  return { headers, rows, values, ...extra };
}

async function fetchTable(s) {
  if (isSheet(s.mimeType)) {
    const tabs = (await api.getTabs(s.fileId)).map((t) => t.title);
    if (s.tab && !tabs.includes(s.tab)) throw new Error(`O separador "${s.tab}" já não existe na folha.`);
    const tab = s.tab || tabs[0];
    return shape(await api.readValues(s.fileId, tab), s.headerRow, { tab, tabs, editable: true });
  }
  const r = await api.readXlsx(s.fileId, s.tab);
  return shape(r.values, s.headerRow, { tab: r.tab, tabs: r.tabs, editable: false });
}

function load(key) {
  const e = entries.get(key);
  if (e.inflight) return e.inflight;
  e.loading = true;
  notifySync();
  e.inflight = fetchTable(e.source)
    .then((d) => { e.data = d; e.error = null; lastSync = new Date(); })
    .catch((err) => { if (err.name !== 'AuthError') e.error = err; })
    .finally(() => { e.loading = false; e.inflight = null; e.listeners.forEach((l) => l()); notifySync(); });
  e.listeners.forEach((l) => l());
  return e.inflight;
}

export function useTable(source) {
  const key = keyOf(source);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    let e = entries.get(key);
    if (!e) { e = { source, listeners: new Set(), data: null, error: null, loading: false, inflight: null }; entries.set(key, e); }
    e.source = source;
    const l = () => tick((t) => t + 1);
    e.listeners.add(l);
    if (!e.data && !e.inflight) load(key); else l();
    return () => e.listeners.delete(l);
  }, [key]);
  const e = key ? entries.get(key) : null;
  return { data: e?.data || null, error: e?.error || null, loading: !!e?.loading, reload: () => key && entries.has(key) && load(key) };
}

export function useSyncStatus() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((t) => t + 1); syncListeners.add(l); return () => syncListeners.delete(l); }, []);
  return { busy: [...entries.values()].some((e) => e.loading), last: lastSync };
}

// Volta a ler todas as fontes que estão visíveis no ecrã.
export function refreshAll() {
  for (const [k, e] of entries) if (e.listeners.size) load(k);
}
export const clearCache = () => entries.clear();
async function reload(source) { const k = keyOf(source); if (entries.has(k)) await load(k); }

// Antes de escrever, confirma que a linha não mudou de posição (outra pessoa pode ter
// inserido/apagado linhas desde a última leitura).
async function verifyRow(source, data, row) {
  const values = await api.readValues(source.fileId, data.tab);
  const fresh = values[row._row - 1] || [];
  const same = row.cells.every((c, j) => String(fresh[j] ?? '') === c);
  if (!same) {
    await reload(source);
    throw new Error('Esta linha foi alterada por outra pessoa entretanto. Os dados foram atualizados — tente de novo.');
  }
}

const writeValue = (v, isDate) => {
  if (!isDate) return v;
  const d = parseDate(v);
  return d ? toISO(d) : v; // ISO é interpretado corretamente em qualquer locale da folha
};

export async function saveRow(source, data, row, vals, dateCols = new Set()) {
  if (row) {
    const changes = vals
      .map((v, col) => ({ row: row._row, col, value: writeValue(v, dateCols.has(col)) }))
      .filter((c) => vals[c.col] !== row.cells[c.col]);
    if (!changes.length) return;
    await verifyRow(source, data, row);
    await api.updateCells(source.fileId, data.tab, changes);
  } else {
    await api.appendRow(source.fileId, data.tab, vals.map((v, i) => writeValue(v, dateCols.has(i))));
  }
  await reload(source);
}

export async function setCell(source, data, row, col, value) {
  const vals = [...row.cells];
  vals[col] = value;
  await saveRow(source, data, row, vals);
}

export async function removeRow(source, data, row) {
  await verifyRow(source, data, row);
  await api.deleteRow(source.fileId, data.tab, row._row);
  await reload(source);
}

// Lista de ficheiros da pasta (para os seletores e o widget de ficheiros).
let filesCache = null;
const filesListeners = new Set();
export function useFiles() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    filesListeners.add(l);
    if (!filesCache) refreshFiles();
    return () => filesListeners.delete(l);
  }, []);
  return filesCache || { files: null, error: null };
}
export async function refreshFiles() {
  try { filesCache = { files: await api.listFiles(), error: null }; } catch (e) { if (e.name !== 'AuthError') filesCache = { files: filesCache?.files || null, error: e }; }
  filesListeners.forEach((l) => l());
}
export const hasFileListeners = () => filesListeners.size > 0;
