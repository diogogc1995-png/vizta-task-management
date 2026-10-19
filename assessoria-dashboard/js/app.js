import { html, useState, useEffect, useRef } from './lib.js';
import { CONFIG } from './config.js';
import { Icon, Spinner, Toasts, toast, save } from './ui.js';
import { useConfig, loadConfig, createConfig, pollConfig, roleIn, canEditRole, hasAppAccess, isSaving } from './store.js';
import { refreshAll, useSyncStatus, refreshFiles, hasFileListeners, clearCache } from './data.js';
import { RENDERERS, TYPES } from './widgets.js';
import { WidgetEditor, ShareModal, SettingsModal } from './editors.js';
import { createInitialDashboard } from './setup.js';

const WIDTHS = [3, 4, 6, 8, 12];

export function App({ api, demo }) {
  const [phase, setPhase] = useState('boot'); // boot | signin | loading | noaccess | setup | ready | error
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [folder, setFolder] = useState(null);
  const [expired, setExpired] = useState(false);
  const cfg = useConfig();

  const start = async () => {
    setPhase('loading');
    try {
      const u = await api.me();
      setUser(u);
      const f = await api.getFolder();
      setFolder(f);
      if (!f) { setPhase('noaccess'); return; }
      const c = await loadConfig();
      if (!c) { setPhase(f.owner === u.email ? 'setup' : 'noaccess'); return; }
      setPhase(hasAppAccess(c, u.email) ? 'ready' : 'noaccess');
    } catch (e) {
      if (e.name === 'AuthError') { setPhase('signin'); return; }
      setError(e); setPhase('error');
    }
  };

  useEffect(() => {
    (async () => {
      try { await api.init(); } catch (e) { setError(e); setPhase('error'); return; }
      if (api.isSignedIn()) start(); else setPhase('signin');
    })();
    return api.onAuthChange((signed) => { if (!signed) setExpired(true); });
  }, []);

  // Mantém tudo atualizado: relê as fontes visíveis e o dashboard.json periodicamente.
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible' || !api.isSignedIn()) return;
      refreshAll();
      if (hasFileListeners()) refreshFiles();
      pollConfig().catch(() => {});
    };
    const t = setInterval(tick, CONFIG.POLL_SECONDS * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [phase]);

  const signIn = async () => {
    try { await api.signIn(); setExpired(false); if (phase === 'ready') refreshAll(); else start(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const signOut = () => { api.signOut(); clearCache(); setExpired(false); setUser(null); setPhase('signin'); };

  let body;
  if (phase === 'boot' || phase === 'loading') body = html`<div class="screen"><${Spinner} /></div>`;
  else if (phase === 'error') body = html`<div class="screen card-screen"><h1>${CONFIG.APP_TITLE}</h1><p class="error">${error?.message}</p></div>`;
  else if (phase === 'signin') body = html`<${SignIn} onSignIn=${signIn} demo=${demo} />`;
  else if (phase === 'noaccess') body = html`<${NoAccess} user=${user} folder=${folder} onSignOut=${signOut} />`;
  else if (phase === 'setup') body = html`<${Setup} api=${api} user=${user} onDone=${() => setPhase('ready')} />`;
  else if (cfg) body = html`<${Dashboard} cfg=${cfg} user=${user} onSignOut=${signOut} />`;

  return html`${demo ? html`<div class="demo-banner">Modo de demonstração: dados fictícios, nada é gravado no Google Drive.</div>` : null}
    ${body}
    ${expired && phase === 'ready' ? html`<div class="expired"><span>${Icon('alert')} A sessão Google expirou.</span><button class="btn primary small" onClick=${signIn}>Renovar sessão</button></div>` : null}
    <${Toasts} />`;
}

function SignIn({ onSignIn, demo }) {
  return html`<div class="screen card-screen">
    <div class="brand-mark">DC<span>&</span>HC</div>
    <h1>${CONFIG.APP_TITLE}</h1>
    <p class="muted">Acesso reservado. Entre com a sua conta Google.</p>
    <button class="btn google" onClick=${onSignIn}>
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>
      ${demo ? 'Entrar (demonstração)' : 'Entrar com Google'}
    </button>
  </div>`;
}

function NoAccess({ user, folder, onSignOut }) {
  return html`<div class="screen card-screen">
    <h1>${CONFIG.APP_TITLE}</h1>
    <p>A conta <strong>${user?.email}</strong> ainda não tem acesso a este dashboard.</p>
    <p class="muted">${folder ? 'Peça ao responsável para o adicionar em Definições.' : 'A pasta do Google Drive do dashboard não está partilhada com esta conta.'}</p>
    <button class="btn" onClick=${onSignOut}>${Icon('logout')} Usar outra conta</button>
  </div>`;
}

function Setup({ api, user, onDone }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await createConfig(await createInitialDashboard(api, user.email)); onDone(); }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return html`<div class="screen card-screen">
    <h1>Bem-vindo, ${user?.name?.split(' ')[0] || ''}</h1>
    <p>A pasta do Drive ainda não tem dashboard. Ao continuar, são criados nela:</p>
    <ul class="plain left">
      <li>${Icon('file')} Google Sheet <strong>Funil de Vendas</strong> (contactos, estado, próximos passos)</li>
      <li>${Icon('file')} Google Sheet <strong>Financiamentos</strong> (entidades, montantes, estado)</li>
      <li>${Icon('file')} <strong>dashboard.json</strong> (secções, widgets e permissões)</li>
    </ul>
    <button class="btn primary" disabled=${busy} onClick=${go}>${busy ? 'A criar…' : 'Criar dashboard'}</button>
  </div>`;
}

const sectionFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));

function Dashboard({ cfg, user, onSignOut }) {
  const visible = cfg.sections.filter((s) => roleIn(cfg, user.email, s));
  const [current, setCurrent] = useState(sectionFromHash());
  const [editMode, setEditMode] = useState(false);
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(false);
  const sync = useSyncStatus();
  const isOwner = cfg.owner === user.email;

  useEffect(() => {
    const h = () => setCurrent(sectionFromHash());
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);
  const section = visible.find((s) => s.id === current) || visible[0];
  const role = section ? roleIn(cfg, user.email, section) : null;
  const canEdit = canEditRole(role);
  useEffect(() => { if (!canEdit) setEditMode(false); }, [canEdit]);
  const tabsRef = useRef(null);
  useEffect(() => { tabsRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [section?.id]);

  const hasFiles = section?.widgets.some((w) => w.type === 'file' && w.file?.fileId);

  return html`<div class="app">
    <header class="top">
      <div class="top-row">
        <div class="brand"><span class="brand-mark small">DC<span>&</span>HC</span><span class="brand-name">${cfg.title || CONFIG.APP_TITLE}</span></div>
        <span class="spacer"></span>
        <button class=${`icon-btn sync${sync.busy || isSaving() ? ' busy' : ''}`} onClick=${() => { refreshAll(); pollConfig().catch(() => {}); }}
          title=${sync.last ? `Atualizado às ${sync.last.toLocaleTimeString('pt-PT')}. Clique para atualizar agora.` : 'Atualizar'}>${Icon('refresh')}</button>
        ${section && canEdit && (hasFiles || section.public?.enabled) ? html`<button class=${`btn small${section.public?.enabled ? ' on' : ''}`} title="Link público" onClick=${() => setModal({ kind: 'share' })}>${Icon('link')}<span class="hide-sm">Link público</span></button>` : null}
        ${section && canEdit ? html`<button class=${`btn small${editMode ? ' primary' : ''}`} title=${editMode ? 'Concluir' : 'Editar'} onClick=${() => setEditMode((m) => !m)}>${Icon(editMode ? 'check' : 'edit')}<span class="hide-sm">${editMode ? 'Concluir' : 'Editar'}</span></button>` : null}
        <div class="user-menu">
          <button class="avatar" onClick=${() => setMenu((m) => !m)} aria-label="Menu da conta" aria-expanded=${menu}>
            ${user.photo ? html`<img src=${user.photo} alt="" referrerpolicy="no-referrer" />` : (user.name || user.email)[0].toUpperCase()}
          </button>
          ${menu ? html`<div class="menu" onMouseLeave=${() => setMenu(false)}>
            <div class="menu-head"><strong>${user.name}</strong><span class="muted small">${user.email}</span></div>
            ${isOwner ? html`<button onClick=${() => { setMenu(false); setModal({ kind: 'settings' }); }}>${Icon('users')} Definições e permissões</button>` : null}
            <a href=${`https://drive.google.com/drive/folders/${CONFIG.DRIVE_FOLDER_ID}`} target="_blank" rel="noopener" onClick=${() => setMenu(false)}>${Icon('folder')} Abrir pasta no Drive</a>
            <button onClick=${onSignOut}>${Icon('logout')} Terminar sessão</button>
          </div>` : null}
        </div>
      </div>
      <nav class="tabs" ref=${tabsRef}>
        ${visible.map((s) => html`<a key=${s.id} href=${`#/${s.id}`} class=${s.id === section?.id ? 'active' : ''}>
          ${s.title}${s.public?.enabled ? html` ${Icon('eye', 'tiny')}` : null}${roleIn(cfg, user.email, s) === 'view' ? html`<span class="ro-tag">ver</span>` : null}</a>`)}
        ${isOwner ? html`<button class="tab-add" onClick=${() => setModal({ kind: 'settings' })} title="Gerir secções">${Icon('plus')}</button>` : null}
      </nav>
    </header>

    <main>
      ${!section ? html`<div class="empty big">Ainda não tem acesso a nenhuma secção.</div>` : html`
        <${SectionView} key=${section.id} section=${section} canEdit=${canEdit} editMode=${editMode}
          onConfigure=${(w) => setModal({ kind: 'widget', widget: w })} />
        ${editMode ? html`<div class="add-widget"><button class="btn primary" onClick=${() => setModal({ kind: 'widget', widget: null })}>${Icon('plus')} Adicionar widget</button></div>` : null}`}
    </main>

    ${modal?.kind === 'widget' ? html`<${WidgetEditor} section=${section} widget=${modal.widget} onClose=${() => setModal(null)} />` : null}
    ${modal?.kind === 'share' ? html`<${ShareModal} section=${section} onClose=${() => setModal(null)} />` : null}
    ${modal?.kind === 'settings' ? html`<${SettingsModal} cfg=${cfg} onClose=${() => setModal(null)} />` : null}
  </div>`;
}

function SectionView({ section, canEdit, editMode, onConfigure }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const mutate = (fn) => save((cfg) => { const s = cfg.sections.find((x) => x.id === section.id); if (s) fn(s); });

  const move = (id, dir) => mutate((s) => {
    const i = s.widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.widgets.length) return;
    [s.widgets[i], s.widgets[j]] = [s.widgets[j], s.widgets[i]];
  });
  const moveBefore = (id, targetId) => mutate((s) => {
    const from = s.widgets.findIndex((w) => w.id === id);
    if (from < 0 || id === targetId) return;
    const [w] = s.widgets.splice(from, 1);
    const to = s.widgets.findIndex((x) => x.id === targetId);
    s.widgets.splice(to < 0 ? s.widgets.length : to, 0, w);
  });
  const resize = (id, dim) => mutate((s) => {
    const w = s.widgets.find((x) => x.id === id);
    if (!w) return;
    if (dim === 'w') w.w = WIDTHS[(WIDTHS.indexOf(w.w) + 1) % WIDTHS.length] || 12;
    else w.h = w.h >= 10 ? 2 : w.h + 1;
  });
  const remove = (w) => { if (confirm(`Remover o widget "${w.title}"? Os dados no Drive não são apagados.`)) mutate((s) => { s.widgets = s.widgets.filter((x) => x.id !== w.id); }); };

  if (!section.widgets.length) {
    return html`<div class="empty big">${canEdit ? 'Secção vazia. Clique em "Editar" e depois em "Adicionar widget".' : 'Secção vazia.'}</div>`;
  }

  return html`<div class=${`grid${editMode ? ' editing' : ''}`}>
    ${section.widgets.map((w, i) => {
      const R = RENDERERS[w.type];
      return html`<section key=${w.id}
          class=${`widget t-${w.type}${overId === w.id ? ' drop' : ''}${dragId === w.id ? ' dragging' : ''}`}
          style=${`--w:${w.w || 6};--h:${w.h || 4}`} data-w=${w.w || 6}
          onDragOver=${(e) => { if (editMode && dragId) { e.preventDefault(); setOverId(w.id); } }}
          onDragLeave=${() => setOverId((o) => (o === w.id ? null : o))}
          onDrop=${(e) => { e.preventDefault(); if (dragId) moveBefore(dragId, w.id); setDragId(null); setOverId(null); }}>
        <header class="w-head">
          ${editMode ? html`<span class="grip" draggable="true" title="Arrastar para reordenar"
              onDragStart=${(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); }}
              onDragEnd=${() => { setDragId(null); setOverId(null); }}>${Icon('grip')}</span>` : null}
          <h3>${w.title}</h3>
          <span class="spacer"></span>
          ${!editMode && w.type === 'file' && w.file?.fileId ? html`<a class="icon-btn" href=${`https://drive.google.com/file/d/${w.file.fileId}/view`} target="_blank" rel="noopener" title="Abrir no Drive">${Icon('external')}</a>` : null}
          ${editMode ? html`<div class="w-tools">
            <button class="icon-btn" onClick=${() => move(w.id, -1)} disabled=${i === 0} title="Mover para trás">${Icon('left')}</button>
            <button class="icon-btn" onClick=${() => move(w.id, 1)} disabled=${i === section.widgets.length - 1} title="Mover para a frente">${Icon('right')}</button>
            <button class="icon-btn hide-sm" onClick=${() => resize(w.id, 'w')} title="Largura">${Icon('width')}</button>
            <button class="icon-btn" onClick=${() => resize(w.id, 'h')} title="Altura">${Icon('height')}</button>
            <button class="icon-btn" onClick=${() => onConfigure(w)} title="Configurar">${Icon('sliders')}</button>
            <button class="icon-btn" onClick=${() => remove(w)} title="Remover">${Icon('trash')}</button>
          </div>` : null}
        </header>
        <div class="w-body">${R ? html`<${R} w=${w} section=${section} canEdit=${canEdit} />` : html`<div class="empty">Tipo desconhecido: ${w.type}</div>`}</div>
      </section>`;
    })}
  </div>`;
}

export { TYPES };
