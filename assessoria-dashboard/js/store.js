// Estado do dashboard (secções, widgets, utilizadores), guardado em dashboard.json no Drive.
import { useState, useEffect } from './lib.js';

let api = null;
export const setApi = (a) => { api = a; };

let state = { cfg: null, fileId: null, version: null };
let saved = null; // última versão gravada no Drive (sem alterações pendentes)
let queue = Promise.resolve();
let pending = 0;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

export function normalize(cfg) {
  const c = { ...cfg };
  c.users = Array.isArray(c.users) ? c.users : [];
  c.sections = (Array.isArray(c.sections) ? c.sections : []).map((s) => ({ access: {}, widgets: [], ...s }));
  return c;
}

export function useConfig() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((t) => t + 1); listeners.add(l); return () => listeners.delete(l); }, []);
  return state.cfg;
}

export async function loadConfig() {
  const f = await api.findConfigFile();
  if (!f) { state = { cfg: null, fileId: null, version: null }; notify(); return null; }
  const { data, version } = await api.readConfig(f.id);
  state = { cfg: normalize(data), fileId: f.id, version };
  saved = state.cfg;
  notify();
  return state.cfg;
}

export async function createConfig(cfg) {
  const r = await api.writeConfig(null, cfg);
  state = { cfg: normalize(cfg), fileId: r.id, version: r.version };
  saved = state.cfg;
  notify();
}

// Aplica a alteração de imediato no ecrã e grava em fila. Se outra pessoa gravou
// entretanto, relê a versão do Drive e volta a aplicar a mesma alteração por cima.
export function updateConfig(mutator) {
  const next = structuredClone(state.cfg);
  mutator(next);
  state = { ...state, cfg: next };
  notify();
  pending++;
  const run = queue.catch(() => {}).then(async () => {
    const remote = await api.getVersion(state.fileId);
    const base = structuredClone(remote === state.version ? saved : normalize((await api.readConfig(state.fileId)).data));
    mutator(base);
    const w = await api.writeConfig(state.fileId, base);
    saved = base;
    state = { ...state, fileId: w.id, version: w.version };
  }).finally(() => {
    pending--;
    if (!pending) state = { ...state, cfg: saved };
    notify();
  });
  queue = run;
  return run;
}

export async function pollConfig() {
  if (!state.fileId || pending) return;
  const v = await api.getVersion(state.fileId);
  if (v !== state.version && !pending) {
    const r = await api.readConfig(state.fileId);
    state = { cfg: normalize(r.data), fileId: state.fileId, version: r.version };
    saved = state.cfg;
    notify();
  }
}

export const isSaving = () => pending > 0;

// ---------- Permissões ----------
// owner: tudo · edit: editar dados e widgets da secção · view: só ver.
export function roleIn(cfg, email, section) {
  if (!cfg || !email) return null;
  if (email === cfg.owner) return 'owner';
  if (!cfg.users.some((u) => u.email === email)) return null;
  return section.access?.[email] || null;
}
export const canEditRole = (r) => r === 'owner' || r === 'edit';
export const hasAppAccess = (cfg, email) => !!cfg && (email === cfg.owner || cfg.users.some((u) => u.email === email));
