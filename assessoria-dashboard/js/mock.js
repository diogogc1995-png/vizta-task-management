// Implementação em memória da mesma API de google.js, para o modo ?demo.
import { MIME } from './util.js';

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let signed = false;
const listeners = new Set();
const now = () => new Date().toISOString();
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

const USER = { email: 'demo@gmail.com', name: 'Utilizador Demo', photo: '' };
const files = [
  { id: '1demoApresentacaoPdf', name: 'Apresentação institucional.pdf', mimeType: MIME.PDF, path: '' },
  { id: 'xlsx1', name: 'Business Plan 2027.xlsx', mimeType: MIME.XLSX, path: 'Business Plans/' },
];
const sheets = {};
const xlsx = {
  xlsx1: {
    'Resumo': [
      ['Business Plan 2027', '', '', ''],
      ['', '', '', ''],
      ['Indicador', '2027', '2028', '2029'],
      ['Receita', '120 000 €', '310 000 €', '540 000 €'],
      ['EBITDA', '-35 000 €', '42 000 €', '128 000 €'],
      ['Clientes', '8', '20', '34'],
      ['Necessidade de financiamento', '250 000 €', '', ''],
    ],
    'Pressupostos': [['Pressuposto', 'Valor'], ['Preço médio', '15 000 €'], ['Taxa de conversão', '18%']],
  },
};
let config = null;
let configVersion = 0;

const SEED = {
  'Funil de Vendas': [
    ['Ana Silva', 'Lusotec', 'CEO', 'ana@lusotec.pt', '912 345 678', 'Proposta enviada', '18 000 €', day(-6), 'Ligar para fechar proposta', day(1), 'Diogo', ''],
    ['Rui Costa', 'Atlântico Foods', 'Diretor Financeiro', 'rui@afoods.pt', '', 'Reunião agendada', '9 500 €', day(-2), 'Reunião de apresentação', day(3), 'Henrique', ''],
    ['Marta Lopes', 'Construções ML', 'Sócia-gerente', '', '', 'Contactado', '6 000 €', day(-10), 'Enviar apresentação', day(-1), 'Diogo', 'Pediu exemplos de trabalhos'],
    ['João Pereira', 'Pereira & Filhos', 'Administrador', '', '', 'Em negociação', '25 000 €', day(-1), 'Rever condições', day(5), 'Henrique', ''],
    ['Sofia Martins', 'Vinhos do Douro SA', 'CFO', '', '', 'Por contactar', '12 000 €', '', 'Primeiro contacto', day(2), 'Diogo', ''],
    ['Pedro Alves', 'TechNorte', 'CEO', '', '', 'Ganho', '15 000 €', day(-20), '', '', 'Henrique', 'Contrato assinado'],
    ['Carla Dias', 'Hotel Mar', 'Diretora', '', '', 'Perdido', '7 000 €', day(-30), '', '', 'Diogo', 'Sem orçamento este ano'],
  ],
  'Financiamentos': [
    ['Caixa Geral de Depósitos', 'Banco', 'Linha de apoio PME', '150 000 €', 'Em análise', 'Paulo Reis', '', day(-4), 'Enviar balancete', day(2), 'Diogo', ''],
    ['Portugal Ventures', 'Capital de risco', 'Seed', '250 000 €', 'Reunião agendada', 'Inês Gomes', '', day(-3), 'Pitch', day(6), 'Henrique', ''],
    ['IAPMEI', 'Apoio público (PT2030/PRR)', 'Inovação Produtiva', '200 000 €', 'Candidatura em preparação', '', '', day(-8), 'Fechar memória descritiva', day(-2), 'Diogo', ''],
    ['Millennium BCP', 'Banco', 'Crédito investimento', '100 000 €', 'Contactado', 'Luís Neves', '', day(-12), 'Aguardar resposta', day(4), 'Henrique', ''],
    ['Business Angels Porto', 'Business angel', '', '50 000 €', 'Aprovado', '', '', day(-15), '', '', 'Diogo', ''],
  ],
};

export const init = async () => {};
export const isSignedIn = () => signed;
export const onAuthChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
export const signIn = async () => { await wait(); signed = true; listeners.forEach((l) => l(true)); };
export const signOut = () => { signed = false; listeners.forEach((l) => l(false)); };
export const me = async () => { await wait(); return USER; };
export const getFolder = async () => ({ id: 'demo', name: 'Pasta demo', owner: USER.email, canEdit: true, canShare: true });

export const findConfigFile = async () => { await wait(); return config ? { id: 'cfg', version: configVersion } : null; };
export const getVersion = async () => configVersion;
export const readConfig = async () => { await wait(); return { data: structuredClone(config), version: configVersion }; };
export const writeConfig = async (_id, data) => { await wait(200); config = structuredClone(data); configVersion++; return { id: 'cfg', version: configVersion }; };

export const listFiles = async () => { await wait(); return files.map((f) => ({ ...f, modifiedTime: now(), webViewLink: '#', iconLink: '' })); };

export const getTabs = async (id) => (sheets[id] ? Object.keys(sheets[id]).map((title, i) => ({ sheetId: i, title })) : []);
export const readValues = async (id, tab) => { await wait(); return structuredClone(sheets[id][tab]); };
export async function updateCells(id, tab, cells) {
  await wait(250);
  const v = sheets[id][tab];
  for (const c of cells) { while (v.length < c.row) v.push([]); v[c.row - 1][c.col] = isoToPT(c.value); }
}
export async function appendRow(id, tab, values) { await wait(250); sheets[id][tab].push(values.map(isoToPT)); }
export async function deleteRow(id, tab, row) { await wait(250); sheets[id][tab].splice(row - 1, 1); }
const isoToPT = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : v; };

export async function createSpreadsheet({ title, tab, headers }) {
  await wait(300);
  const id = `sheet-${Object.keys(sheets).length + 1}`;
  sheets[id] = { [tab]: [headers, ...(SEED[title] || [])] };
  files.push({ id, name: title, mimeType: MIME.SHEET, path: '' });
  return { fileId: id, name: title, mimeType: MIME.SHEET, tab };
}

export async function readXlsx(id, tab) {
  await wait();
  const book = xlsx[id];
  const tabs = Object.keys(book);
  const name = tabs.includes(tab) ? tab : tabs[0];
  return { tabs, tab: name, values: structuredClone(book[name]) };
}

export const syncFolderAccess = async () => { await wait(); };
const pub = new Set();
export const getPublic = async (id) => pub.has(id);
export const setPublic = async (id, on) => { await wait(); if (on) pub.add(id); else pub.delete(id); };

export class AuthError extends Error {}
