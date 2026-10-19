// Acesso ao Google (login + Drive + Sheets) diretamente do browser.
// Cada pessoa usa a sua própria conta Google: só vê/edita o que o Drive lhe permite.
import { CONFIG } from './config.js';
import { MIME, colLetter } from './util.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = CONFIG.DRIVE_FOLDER_ID;
const TOKEN_KEY = 'adh_token';
const HINT_KEY = 'adh_login_hint';
const ALL = 'supportsAllDrives=true';

let token = null; // { access_token, expires_at }
const authListeners = new Set();

export class AuthError extends Error {
  constructor() { super('A sessão Google expirou.'); this.name = 'AuthError'; }
}

export const onAuthChange = (cb) => { authListeners.add(cb); return () => authListeners.delete(cb); };
const emitAuth = () => authListeners.forEach((cb) => cb(isSignedIn()));
export const isSignedIn = () => !!token && token.expires_at > Date.now();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(s);
  });
}

export async function init() {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.startsWith('COLAR_AQUI')) {
    throw new Error('Falta configurar o GOOGLE_CLIENT_ID em js/config.js (ver README, passo 2).');
  }
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expires_at > Date.now()) token = t;
  } catch { /* sessionStorage indisponível */ }
  await loadScript('https://accounts.google.com/gsi/client');
}

export function signIn() {
  let hint = '';
  try { hint = localStorage.getItem(HINT_KEY) || ''; } catch { /* ignore */ }
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: hint || undefined,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          return reject(new Error('É preciso autorizar o acesso ao Google Drive para usar o dashboard.'));
        }
        token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch { /* ignore */ }
        emitAuth();
        resolve();
      },
      error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? 'A janela de login foi fechada.' : 'Não foi possível iniciar sessão.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(HINT_KEY); } catch { /* ignore */ }
  emitAuth();
}

async function request(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
  if (!isSignedIn()) { token = null; emitAuth(); throw new AuthError(); }
  const r = await fetch(url, { method, body, cache: 'no-store', headers: { Authorization: `Bearer ${token.access_token}`, ...headers } });
  if (r.status === 401) {
    token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    emitAuth();
    throw new AuthError();
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { msg = (await r.json()).error?.message || msg; } catch { /* ignore */ }
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  if (raw) return r;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const json = (method, obj) => ({ method, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } });
const enc = encodeURIComponent;
const quoteTab = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

// ---------- Identidade e pasta ----------

export async function me() {
  const { user } = await request(`${DRIVE}/about?fields=user(displayName,emailAddress,photoLink)`);
  try { localStorage.setItem(HINT_KEY, user.emailAddress); } catch { /* ignore */ }
  return { email: user.emailAddress.toLowerCase(), name: user.displayName, photo: user.photoLink };
}

export async function getFolder() {
  try {
    const f = await request(`${DRIVE}/files/${FOLDER}?fields=id,name,owners(emailAddress),capabilities(canEdit,canShare)&${ALL}`);
    return { id: f.id, name: f.name, owner: f.owners?.[0]?.emailAddress?.toLowerCase() || null, canEdit: !!f.capabilities?.canEdit, canShare: !!f.capabilities?.canShare };
  } catch (e) {
    if (e.status === 404 || e.status === 403) return null;
    throw e;
  }
}

// ---------- Ficheiro de configuração (dashboard.json) ----------

export async function findConfigFile() {
  const q = `'${FOLDER}' in parents and name = '${CONFIG.CONFIG_FILE_NAME}' and trashed = false`;
  const r = await request(`${DRIVE}/files?q=${enc(q)}&fields=files(id,version)&orderBy=modifiedTime desc&${ALL}&includeItemsFromAllDrives=true`);
  const f = r.files?.[0];
  return f ? { id: f.id, version: Number(f.version) } : null;
}

export async function getVersion(id) {
  return Number((await request(`${DRIVE}/files/${id}?fields=version&${ALL}`)).version);
}

export async function readConfig(id) {
  const version = await getVersion(id);
  const r = await request(`${DRIVE}/files/${id}?alt=media&${ALL}`, { raw: true });
  return { data: JSON.parse(await r.text()), version };
}

export async function writeConfig(id, data) {
  const content = JSON.stringify(data, null, 2);
  if (id) {
    const r = await request(`${UPLOAD}/files/${id}?uploadType=media&fields=id,version&${ALL}`, {
      method: 'PATCH', body: content, headers: { 'Content-Type': MIME.JSON },
    });
    return { id: r.id, version: Number(r.version) };
  }
  const b = `adh${Math.random().toString(36).slice(2)}`;
  const meta = { name: CONFIG.CONFIG_FILE_NAME, parents: [FOLDER], mimeType: MIME.JSON };
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
  const r = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,version&${ALL}`, {
    method: 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${b}` },
  });
  return { id: r.id, version: Number(r.version) };
}

// ---------- Ficheiros da pasta (inclui subpastas, até 3 níveis) ----------

export async function listFiles() {
  const out = [];
  let level = [{ id: FOLDER, path: '' }];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next = [];
    for (const folder of level) {
      let pageToken = '';
      do {
        const q = `'${folder.id}' in parents and trashed = false`;
        const r = await request(`${DRIVE}/files?q=${enc(q)}&pageSize=200&${ALL}&includeItemsFromAllDrives=true`
          + `&fields=nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,iconLink,lastModifyingUser(displayName))`
          + (pageToken ? `&pageToken=${pageToken}` : ''));
        for (const f of r.files || []) {
          if (f.mimeType === MIME.FOLDER) next.push({ id: f.id, path: folder.path + f.name + '/' });
          else if (!(folder.id === FOLDER && f.name === CONFIG.CONFIG_FILE_NAME)) out.push({ ...f, path: folder.path });
        }
        pageToken = r.nextPageToken || '';
      } while (pageToken);
    }
    level = next;
  }
  return out;
}

// ---------- Google Sheets ----------

const tabsCache = new Map();
export async function getTabs(fileId) {
  const c = tabsCache.get(fileId);
  if (c && Date.now() - c.ts < 5 * 60_000) return c.tabs;
  const r = await request(`${SHEETS}/${fileId}?fields=sheets.properties(sheetId,title,index)`);
  const tabs = r.sheets.map((s) => s.properties).sort((a, b) => a.index - b.index).map(({ sheetId, title }) => ({ sheetId, title }));
  tabsCache.set(fileId, { ts: Date.now(), tabs });
  return tabs;
}

export async function readValues(fileId, tab) {
  try {
    const r = await request(`${SHEETS}/${fileId}/values/${enc(quoteTab(tab))}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
    return r.values || [];
  } catch (e) {
    tabsCache.delete(fileId);
    throw e;
  }
}

export async function updateCells(fileId, tab, cells) {
  await request(`${SHEETS}/${fileId}/values:batchUpdate`, json('POST', {
    valueInputOption: 'USER_ENTERED',
    data: cells.map((c) => ({ range: `${quoteTab(tab)}!${colLetter(c.col)}${c.row}`, values: [[c.value]] })),
  }));
}

export async function appendRow(fileId, tab, values) {
  await request(`${SHEETS}/${fileId}/values/${enc(`${quoteTab(tab)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    json('POST', { values: [values] }));
}

export async function deleteRow(fileId, tab, row) {
  const t = (await getTabs(fileId)).find((x) => x.title === tab);
  if (!t) throw new Error(`Separador "${tab}" não encontrado.`);
  await request(`${SHEETS}/${fileId}:batchUpdate`, json('POST', {
    requests: [{ deleteDimension: { range: { sheetId: t.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }],
  }));
}

// Cria uma Google Sheet dentro da pasta, com cabeçalho, listas pendentes e formatos.
export async function createSpreadsheet({ title, tab, headers, validations = [], dateCols = [], currencyCols = [] }) {
  const ss = await request(SHEETS, json('POST', {
    properties: { title, locale: 'pt_PT', timeZone: 'Europe/Lisbon' },
    sheets: [{
      properties: { title: tab, gridProperties: { frozenRowCount: 1 } },
      data: [{ startRow: 0, startColumn: 0, rowData: [{ values: headers.map((h) => ({
        userEnteredValue: { stringValue: h },
        userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.93, blue: 0.96 } },
      })) }] }],
    }],
  }));
  const sheetId = ss.sheets[0].properties.sheetId;
  const col = (i) => ({ sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: i, endColumnIndex: i + 1 });
  const requests = [
    ...validations.map((v) => ({ setDataValidation: { range: col(v.col), rule: {
      condition: { type: 'ONE_OF_LIST', values: v.values.map((x) => ({ userEnteredValue: x })) }, showCustomUi: true, strict: false,
    } } })),
    ...dateCols.map((i) => ({ repeatCell: { range: col(i), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    ...currencyCols.map((i) => ({ repeatCell: { range: col(i), cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '#,##0 €' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length } } },
  ];
  await request(`${SHEETS}/${ss.spreadsheetId}:batchUpdate`, json('POST', { requests }));
  const { parents = [] } = await request(`${DRIVE}/files/${ss.spreadsheetId}?fields=parents&${ALL}`);
  await request(`${DRIVE}/files/${ss.spreadsheetId}?addParents=${FOLDER}&removeParents=${parents.join(',')}&fields=id&${ALL}`, json('PATCH', {}));
  return { fileId: ss.spreadsheetId, name: title, mimeType: MIME.SHEET, tab };
}

// ---------- Excel (.xlsx) — só leitura, convertido no browser com SheetJS ----------

let xlsxLoading = null;
export async function readXlsx(fileId, tab) {
  if (!window.XLSX) {
    xlsxLoading ||= loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
    await xlsxLoading;
  }
  const r = await request(`${DRIVE}/files/${fileId}?alt=media&${ALL}`, { raw: true });
  const wb = window.XLSX.read(await r.arrayBuffer(), { type: 'array' });
  const tabs = wb.SheetNames;
  const name = tabs.includes(tab) ? tab : tabs[0];
  const ws = wb.Sheets[name];
  if (ws['!ref']) { const rg = window.XLSX.utils.decode_range(ws['!ref']); rg.s = { r: 0, c: 0 }; ws['!ref'] = window.XLSX.utils.encode_range(rg); }
  const values = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
  return { tabs, tab: name, values };
}

// ---------- Partilha ----------

async function listPerms(fileId) {
  const r = await request(`${DRIVE}/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress)&${ALL}`);
  return r.permissions || [];
}

// Dá (ou retira) acesso à pasta do dashboard. role: 'writer' | 'reader' | null.
export async function syncFolderAccess(email, role) {
  const perms = await listPerms(FOLDER);
  const p = perms.find((x) => x.type === 'user' && x.emailAddress?.toLowerCase() === email.toLowerCase());
  if (p?.role === 'owner') return;
  if (!role) {
    if (p) await request(`${DRIVE}/files/${FOLDER}/permissions/${p.id}?${ALL}`, { method: 'DELETE' });
    return;
  }
  if (p) {
    if (p.role !== role) await request(`${DRIVE}/files/${FOLDER}/permissions/${p.id}?${ALL}`, json('PATCH', { role }));
    return;
  }
  const msg = `Tens acesso ao dashboard ${CONFIG.APP_TITLE}: ${location.origin}${location.pathname}`;
  await request(`${DRIVE}/files/${FOLDER}/permissions?sendNotificationEmail=true&emailMessage=${enc(msg)}&${ALL}`,
    json('POST', { type: 'user', role, emailAddress: email }));
}

export async function getPublic(fileId) {
  return (await listPerms(fileId)).some((p) => p.type === 'anyone');
}

// Torna um ficheiro visível a qualquer pessoa com o link (só leitura, sem download/cópia) ou revoga.
export async function setPublic(fileId, on) {
  const anyone = (await listPerms(fileId)).filter((p) => p.type === 'anyone');
  if (on) {
    if (!anyone.length) {
      await request(`${DRIVE}/files/${fileId}/permissions?${ALL}`, json('POST', { type: 'anyone', role: 'reader', allowFileDiscovery: false }));
    }
    try { await request(`${DRIVE}/files/${fileId}?${ALL}`, json('PATCH', { copyRequiresWriterPermission: true })); } catch { /* nem todos os tipos suportam */ }
  } else {
    for (const p of anyone) await request(`${DRIVE}/files/${fileId}/permissions/${p.id}?${ALL}`, { method: 'DELETE' });
  }
}
