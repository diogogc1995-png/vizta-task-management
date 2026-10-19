// Formulários de configuração: widget, partilha pública e definições (utilizadores e secções).
import { html, useState, useEffect } from './lib.js';
import { Modal, Icon, Spinner, toast, save } from './ui.js';
import { useTable, useFiles, refreshFiles } from './data.js';
import { TYPES } from './widgets.js';
import { updateConfig } from './store.js';
import { isTabular, isExcel, isPreviewable, colIdx, distinct, publicUrl, uid, norm } from './util.js';

let api = null;
export const setApi = (a) => { api = a; };

const lines = (s) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

function Field({ label, hint, children, full }) {
  return html`<div class=${`field${full ? ' full' : ''}`}><label>${label}</label>${children}${hint ? html`<small class="muted">${hint}</small>` : null}</div>`;
}

function FileSelect({ value, filter, onChange, placeholder }) {
  const { files, error } = useFiles();
  useEffect(() => { refreshFiles(); }, []);
  if (error && !files) return html`<div class="error">${error.message}</div>`;
  if (!files) return html`<div><${Spinner} /></div>`;
  const list = files.filter(filter).sort((a, b) => (a.path + a.name).localeCompare(b.path + b.name, 'pt'));
  return html`<select value=${value || ''} onChange=${(e) => { const f = list.find((x) => x.id === e.target.value); onChange(f || null); }}>
    <option value="">${placeholder}</option>
    ${list.map((f) => html`<option value=${f.id}>${f.path}${f.name}</option>`)}
  </select>
  ${!list.length ? html`<small class="muted">Não há ficheiros deste tipo na pasta do Drive.</small>` : null}`;
}

function ColumnSelect({ headers, value, onChange, empty = '—' }) {
  return html`<select value=${value || ''} onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">${empty}</option>${headers.map((h) => html`<option value=${h}>${h}</option>`)}
  </select>`;
}

function ColumnChecks({ headers, value = [], onChange }) {
  const has = (h) => value.some((v) => norm(v) === norm(h));
  return html`<div class="checks">${headers.map((h) => html`<label class="check"><input type="checkbox" checked=${has(h)}
    onChange=${(e) => onChange(e.target.checked ? [...value, h] : value.filter((v) => norm(v) !== norm(h)))} />${h}</label>`)}</div>`;
}

export function WidgetEditor({ section, widget, onClose }) {
  const isNew = !widget;
  const [d, setD] = useState(() => (widget ? structuredClone(widget) : null));
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const q = useTable(d?.source);
  const headers = q.data?.headers || [];

  if (!d) {
    return html`<${Modal} title="Adicionar widget" onClose=${onClose} wide>
      <div class="type-grid">${Object.entries(TYPES).map(([type, t]) => html`<button class="type-card" onClick=${() => setD({ id: uid(), type, title: t.label, ...structuredClone(t.defaults) })}>
        <strong>${t.label}</strong><span class="muted">${t.desc}</span></button>`)}</div>
    </${Modal}>`;
  }

  const onSave = () => {
    save((cfg) => {
      const s = cfg.sections.find((x) => x.id === section.id);
      if (!s) return;
      const i = s.widgets.findIndex((x) => x.id === d.id);
      if (i >= 0) s.widgets[i] = d; else s.widgets.push(d);
    });
    onClose();
  };

  const needsSource = ['kpi', 'table', 'kanban', 'agenda', 'chart'].includes(d.type);
  const gcol = d.type === 'table' ? 'stageColumn' : 'groupColumn';
  const stageVals = () => { const i = colIdx(headers, d[gcol]); return i < 0 ? [] : distinct(q.data.rows, i); };
  const filterVals = d.filter?.column && q.data ? distinct(q.data.rows, colIdx(headers, d.filter.column)) : [];
  const setFilter = (patch) => set({ filter: { mode: 'include', values: [], ...(d.filter || {}), ...patch } });

  return html`<${Modal} title=${isNew ? `Novo: ${TYPES[d.type].label}` : 'Configurar widget'} onClose=${onClose} wide
    footer=${html`<span class="spacer"></span><button class="btn" onClick=${onClose}>Cancelar</button><button class="btn primary" onClick=${onSave}>Guardar</button>`}>
    <div class="form grid2">
      <${Field} label="Título" full><input type="text" value=${d.title} onInput=${(e) => set({ title: e.target.value })} /></${Field}>

      ${needsSource ? html`
        <${Field} label="Fonte de dados" hint="Google Sheets (leitura e escrita) ou Excel (só leitura) dentro da pasta do Drive." full>
          <${FileSelect} value=${d.source?.fileId} filter=${(f) => isTabular(f.mimeType)} placeholder="Escolher folha…"
            onChange=${(f) => set({ source: f ? { fileId: f.id, mimeType: f.mimeType, name: f.name, tab: null } : null })} />
        </${Field}>
        ${d.source?.fileId ? html`
          <${Field} label="Separador">
            ${q.data ? html`<select value=${d.source.tab || ''} onChange=${(e) => set({ source: { ...d.source, tab: e.target.value || null } })}>
              <option value="">(primeiro separador)</option>${q.data.tabs.map((t) => html`<option value=${t}>${t}</option>`)}</select>`
              : q.error ? html`<div class="error">${q.error.message}</div>` : html`<${Spinner} />`}
          </${Field}>
          <${Field} label="Linha do cabeçalho" hint="Normalmente 1. Útil em business plans com títulos por cima da tabela.">
            <input type="number" min="1" value=${d.source.headerRow || 1} onInput=${(e) => set({ source: { ...d.source, headerRow: Math.max(1, +e.target.value || 1) } })} />
          </${Field}>` : null}
      ` : null}

      ${d.type === 'kpi' && q.data ? html`
        <${Field} label="Cálculo">
          <select value=${d.mode} onChange=${(e) => set({ mode: e.target.value })}>
            <option value="count">Contar linhas</option><option value="sum">Somar uma coluna</option><option value="cell">Valor de uma célula</option>
          </select>
        </${Field}>
        ${d.mode === 'sum' ? html`<${Field} label="Coluna a somar"><${ColumnSelect} headers=${headers} value=${d.valueColumn} onChange=${(v) => set({ valueColumn: v })} /></${Field}>` : null}
        ${d.mode === 'cell' ? html`<${Field} label="Célula" hint="Ex.: B5 (no separador escolhido)"><input type="text" value=${d.cell || ''} onInput=${(e) => set({ cell: e.target.value })} /></${Field}>` : null}
        <${Field} label="Formato">
          <select value=${d.format || 'number'} onChange=${(e) => set({ format: e.target.value })}>
            ${d.mode === 'cell' ? html`<option value="raw">Como está na folha</option>` : null}
            <option value="number">Número</option><option value="currency">Euros (€)</option><option value="percent">Percentagem</option>
          </select>
        </${Field}>` : null}

      ${['kanban', 'table', 'chart'].includes(d.type) && q.data ? html`
        <${Field} label=${d.type === 'chart' ? 'Agrupar por' : d.type === 'table' ? 'Coluna de estado (opcional)' : 'Coluna de estado'}>
          <${ColumnSelect} headers=${headers} value=${d[gcol]} onChange=${(v) => set({ [gcol]: v })} />
        </${Field}>
        <${Field} label="Ordem dos estados" hint="Um por linha. Define as colunas do funil, a ordem e as cores." full>
          <textarea rows="4" value=${(d.stages || []).join('\n')} onChange=${(e) => set({ stages: lines(e.target.value) })}></textarea>
          ${d[gcol] ? html`<button class="btn small ghost" onClick=${() => set({ stages: [...new Set([...(d.stages || []), ...stageVals()])] })}>Preencher com os valores da folha</button>` : null}
        </${Field}>` : null}

      ${d.type === 'chart' && q.data ? html`
        <${Field} label="Tipo de gráfico">
          <select value=${d.chartType} onChange=${(e) => set({ chartType: e.target.value })}><option value="bar">Barras</option><option value="doughnut">Circular</option></select>
        </${Field}>
        <${Field} label="Valor">
          <select value=${d.mode} onChange=${(e) => set({ mode: e.target.value })}><option value="count">Número de linhas</option><option value="sum">Soma de uma coluna</option></select>
        </${Field}>
        ${d.mode === 'sum' ? html`<${Field} label="Coluna a somar"><${ColumnSelect} headers=${headers} value=${d.valueColumn} onChange=${(v) => set({ valueColumn: v })} /></${Field}>
          <${Field} label="Formato"><select value=${d.format || 'number'} onChange=${(e) => set({ format: e.target.value })}><option value="number">Número</option><option value="currency">Euros (€)</option></select></${Field}>` : null}` : null}

      ${['kanban', 'agenda', 'table'].includes(d.type) && q.data ? html`
        <${Field} label="Coluna do título"><${ColumnSelect} headers=${headers} value=${d.titleColumn} onChange=${(v) => set({ titleColumn: v })} empty="(primeira coluna)" /></${Field}>` : null}
      ${['kanban', 'agenda'].includes(d.type) && q.data ? html`
        <${Field} label="Coluna da data (próximo passo)"><${ColumnSelect} headers=${headers} value=${d.dateColumn} onChange=${(v) => set({ dateColumn: v })} /></${Field}>` : null}
      ${d.type === 'agenda' && q.data ? html`
        <${Field} label="Coluna de detalhe"><${ColumnSelect} headers=${headers} value=${d.detailColumn} onChange=${(v) => set({ detailColumn: v })} /></${Field}>` : null}
      ${d.type === 'kanban' && q.data ? html`
        <${Field} label="Informação extra nos cartões" full><${ColumnChecks} headers=${headers} value=${d.subtitleColumns} onChange=${(v) => set({ subtitleColumns: v })} /></${Field}>` : null}
      ${d.type === 'table' && q.data ? html`
        <${Field} label="Colunas visíveis" hint="Nenhuma marcada = todas." full><${ColumnChecks} headers=${headers} value=${d.columns} onChange=${(v) => set({ columns: v })} /></${Field}>` : null}

      ${needsSource && q.data ? html`
        <${Field} label="Filtrar linhas por" hint="Opcional. Ex.: excluir estados Ganho/Perdido.">
          <${ColumnSelect} headers=${headers} value=${d.filter?.column} onChange=${(v) => setFilter({ column: v, values: [] })} empty="(sem filtro)" />
        </${Field}>
        ${d.filter?.column ? html`<${Field} label="Modo">
          <select value=${d.filter.mode} onChange=${(e) => setFilter({ mode: e.target.value })}><option value="include">Mostrar só</option><option value="exclude">Excluir</option></select>
        </${Field}>
        <${Field} label="Valores" full>
          <${ColumnChecks} headers=${[...new Set([...(d.stages || []).filter(() => norm(d.filter.column) === norm(d[gcol])), ...filterVals, ...(d.filter.values || [])])]}
            value=${d.filter.values} onChange=${(v) => setFilter({ values: v })} />
        </${Field}>` : null}` : null}

      ${d.type === 'file' ? html`
        <${Field} label="Ficheiro" hint="PDF, Google Slides, Docs ou imagem dentro da pasta do Drive." full>
          <${FileSelect} value=${d.file?.fileId} filter=${(f) => isPreviewable(f.mimeType)} placeholder="Escolher ficheiro…"
            onChange=${(f) => set({ file: f ? { fileId: f.id, mimeType: f.mimeType, name: f.name } : null })} />
        </${Field}>` : null}

      <${Field} label="Largura">
        <select value=${d.w} onChange=${(e) => set({ w: +e.target.value })}>
          ${[[3, '1/4'], [4, '1/3'], [6, '1/2'], [8, '2/3'], [12, 'Toda a largura']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
      </${Field}>
      <${Field} label="Altura">
        <select value=${d.h} onChange=${(e) => set({ h: +e.target.value })}>${[2, 3, 4, 5, 6, 7, 8, 10, 12].map((v) => html`<option value=${v}>${v}</option>`)}</select>
      </${Field}>
    </div>
    ${needsSource && d.source?.fileId && isExcel(d.source.mimeType) ? html`<p class="notice">Ficheiros Excel são lidos aqui mas só podem ser editados no Drive. Para editar a partir do dashboard, converta-o para Google Sheets (no Drive: Abrir com → Google Sheets → Ficheiro → Guardar como Google Sheets).</p>` : null}
  </${Modal}>`;
}

// ---------- Link público de uma secção ----------
export function ShareModal({ section, onClose }) {
  const files = section.widgets.filter((w) => w.type === 'file' && w.file?.fileId).map((w) => w.file);
  const [busy, setBusy] = useState(false);
  const enabled = !!section.public?.enabled;
  const url = enabled ? publicUrl(section.title, section.public.files || []) : '';

  const apply = async (on) => {
    setBusy(true);
    try {
      const prev = section.public?.files || [];
      const target = on ? files : [];
      for (const f of prev) if (!target.some((t) => t.fileId === f.fileId)) await api.setPublic(f.fileId, false);
      for (const f of target) await api.setPublic(f.fileId, true);
      await updateConfig((cfg) => {
        const s = cfg.sections.find((x) => x.id === section.id);
        if (s) s.public = on ? { enabled: true, files: target } : { enabled: false, files: [] };
      });
      toast(on ? 'Link público ativo.' : 'Link público desativado.', 'ok');
    } catch (e) { if (e.name !== 'AuthError') toast(e.message, 'error'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copiado.', 'ok'); } catch { prompt('Copie o link:', url); }
  };
  const outdated = enabled && JSON.stringify((section.public.files || []).map((f) => f.fileId)) !== JSON.stringify(files.map((f) => f.fileId));

  return html`<${Modal} title=${`Link público · ${section.title}`} onClose=${onClose}>
    <p>Qualquer pessoa com o link vê <strong>só</strong> os ficheiros desta secção, sem login e sem poder editar.
      O resto do dashboard continua privado. Download e cópia ficam desativados quando o Drive o permite.</p>
    ${!files.length ? html`<p class="notice">Esta secção ainda não tem nenhum widget "Ficheiro" com um ficheiro escolhido.</p>` : html`
      <ul class="plain">${files.map((f) => html`<li>${Icon('file')} ${f.name}</li>`)}</ul>`}
    ${enabled ? html`<div class="share-url"><input type="text" readonly value=${url} onFocus=${(e) => e.target.select()} />
      <button class="btn primary" onClick=${copy}>${Icon('copy')} Copiar</button>
      <a class="btn" href=${url} target="_blank" rel="noopener">${Icon('external')} Abrir</a></div>` : null}
    ${outdated ? html`<p class="notice">Os ficheiros da secção mudaram desde que o link foi criado. Clique em "Atualizar link".</p>` : null}
    <div class="row-end">
      ${enabled ? html`<button class="btn danger ghost" disabled=${busy} onClick=${() => apply(false)}>Desativar link</button>` : null}
      ${files.length ? html`<button class="btn primary" disabled=${busy} onClick=${() => apply(true)}>${busy ? 'A aplicar…' : enabled ? 'Atualizar link' : 'Criar link público'}</button>` : null}
    </div>
  </${Modal}>`;
}

// ---------- Definições (só o dono) ----------
const ROLE_LABEL = { '': 'Sem acesso', view: 'Ver', edit: 'Editar' };

export function SettingsModal({ cfg, onClose }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [newSection, setNewSection] = useState('');

  const driveRole = (c, em) => {
    const roles = c.sections.map((s) => s.access?.[em]).filter(Boolean);
    return roles.includes('edit') ? 'writer' : 'reader';
  };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, 'ok'); } catch (e) { if (e.name !== 'AuthError') toast(e.message, 'error'); }
    setBusy(false);
  };

  const addUser = () => {
    const em = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Email inválido.', 'error');
    if (em === cfg.owner || cfg.users.some((u) => u.email === em)) return toast('Esse email já tem acesso.', 'error');
    run(async () => {
      await updateConfig((c) => { c.users.push({ email: em, name: name.trim() || em.split('@')[0] }); });
      await api.syncFolderAccess(em, 'reader');
      setEmail(''); setName('');
    }, `${em} adicionado. Recebeu um email do Google Drive. Defina agora as secções a que tem acesso.`);
  };
  const setRole = (em, sectionId, role) => run(async () => {
    let next;
    await updateConfig((c) => {
      const s = c.sections.find((x) => x.id === sectionId);
      if (!s) return;
      s.access ||= {};
      if (role) s.access[em] = role; else delete s.access[em];
      next = c;
    });
    await api.syncFolderAccess(em, driveRole(next, em));
  });
  const removeUser = (em) => {
    if (!confirm(`Retirar o acesso de ${em} ao dashboard e à pasta do Drive?`)) return;
    run(async () => {
      await updateConfig((c) => {
        c.users = c.users.filter((u) => u.email !== em);
        c.sections.forEach((s) => { if (s.access) delete s.access[em]; });
      });
      await api.syncFolderAccess(em, null);
    }, 'Acesso retirado.');
  };
  const addSection = () => {
    const t = newSection.trim();
    if (!t) return;
    save((c) => { c.sections.push({ id: uid(), title: t, access: {}, widgets: [] }); });
    setNewSection('');
  };
  const moveSection = (id, dir) => save((c) => {
    const i = c.sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.sections.length) return;
    [c.sections[i], c.sections[j]] = [c.sections[j], c.sections[i]];
  });
  const renameSection = (id, title) => title.trim() && save((c) => { const s = c.sections.find((x) => x.id === id); if (s) s.title = title.trim(); });
  const deleteSection = (s) => {
    if (!confirm(`Eliminar a secção "${s.title}"? Os ficheiros no Drive não são apagados.`)) return;
    save((c) => { c.sections = c.sections.filter((x) => x.id !== s.id); });
  };

  return html`<${Modal} title="Definições" onClose=${onClose} wide>
    <h3>${Icon('users')} Pessoas e permissões</h3>
    <p class="muted small">Quem adicionar aqui entra com a sua conta Google e recebe acesso à pasta do Drive
      (edição se puder editar alguma secção, senão só leitura). <strong>Também tem de estar na lista de "utilizadores de teste" do projeto Google Cloud</strong> (ver README).</p>
    <div class="perm-scroll"><table class="perm">
      <thead><tr><th>Pessoa</th>${cfg.sections.map((s) => html`<th>${s.title}</th>`)}<th></th></tr></thead>
      <tbody>
        <tr><td><strong>Eu</strong><br /><span class="muted small">${cfg.owner}</span></td>${cfg.sections.map(() => html`<td class="muted small">Dono</td>`)}<td></td></tr>
        ${cfg.users.map((u) => html`<tr key=${u.email}>
          <td><strong>${u.name}</strong><br /><span class="muted small">${u.email}</span></td>
          ${cfg.sections.map((s) => html`<td><select disabled=${busy} value=${s.access?.[u.email] || ''} onChange=${(e) => setRole(u.email, s.id, e.target.value || null)}>
            ${Object.entries(ROLE_LABEL).map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></td>`)}
          <td><button class="icon-btn" title="Retirar acesso" disabled=${busy} onClick=${() => removeUser(u.email)}>${Icon('trash')}</button></td>
        </tr>`)}
      </tbody>
    </table></div>
    <div class="add-row">
      <input type="email" placeholder="email@gmail.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <input type="text" placeholder="Nome (opcional)" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn primary" disabled=${busy} onClick=${addUser}>${Icon('plus')} Adicionar</button>
    </div>

    <h3>${Icon('layout')} Secções</h3>
    <ul class="sections-list">
      ${cfg.sections.map((s, i) => html`<li key=${s.id}>
        <input type="text" value=${s.title} onChange=${(e) => renameSection(s.id, e.target.value)} aria-label="Nome da secção" />
        <button class="icon-btn" disabled=${i === 0} onClick=${() => moveSection(s.id, -1)} title="Subir">${Icon('up')}</button>
        <button class="icon-btn" disabled=${i === cfg.sections.length - 1} onClick=${() => moveSection(s.id, 1)} title="Descer">${Icon('down')}</button>
        <button class="icon-btn" onClick=${() => deleteSection(s)} title="Eliminar secção">${Icon('trash')}</button>
      </li>`)}
    </ul>
    <div class="add-row">
      <input type="text" placeholder="Nova secção" value=${newSection} onInput=${(e) => setNewSection(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && addSection()} />
      <button class="btn" onClick=${addSection}>${Icon('plus')} Criar secção</button>
    </div>
  </${Modal}>`;
}
