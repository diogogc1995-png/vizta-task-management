import { html, useState, useEffect, useRef, useMemo } from './lib.js';
import { useTable, setCell, useFiles, refreshFiles } from './data.js';
import { RowEditor } from './rowEditor.js';
import { Icon, Spinner, toast, save } from './ui.js';
import {
  applyFilter, colIdx, distinct, norm, parseNum, parseA1, parseDate, fmtValue, relDay, dueClass,
  startOfToday, compareCells, openUrl, previewUrl, isPreviewable, stageColor, PALETTE, NEUTRAL, MIME,
} from './util.js';

// Tipos de widget e o que cada um precisa de configurar (ver editors.js).
export const TYPES = {
  kpi: { label: 'Indicador (número)', desc: 'Contagem, soma ou valor de uma célula.', defaults: { w: 3, h: 2, mode: 'count', format: 'number' } },
  kanban: { label: 'Funil / Kanban', desc: 'Cartões por estado; arraste para mudar o estado na folha.', defaults: { w: 12, h: 6 } },
  table: { label: 'Tabela', desc: 'Linhas de uma Google Sheet ou Excel, com pesquisa e edição.', defaults: { w: 12, h: 6 } },
  agenda: { label: 'Próximos passos', desc: 'Linhas ordenadas por data, com atrasos em destaque.', defaults: { w: 6, h: 5 } },
  chart: { label: 'Gráfico', desc: 'Barras ou circular, agrupado por uma coluna.', defaults: { w: 6, h: 5, chartType: 'bar', mode: 'count' } },
  file: { label: 'Ficheiro (PDF, Slides, Docs)', desc: 'Pré-visualização de um ficheiro do Drive.', defaults: { w: 12, h: 8 } },
  files: { label: 'Ficheiros da pasta', desc: 'Lista dos ficheiros na pasta partilhada.', defaults: { w: 6, h: 4 } },
  notes: { label: 'Notas', desc: 'Texto livre.', defaults: { w: 6, h: 3, text: '' } },
};

function Status({ w, q, canEdit }) {
  if (!w.source?.fileId) {
    return html`<div class="empty">${canEdit ? 'Sem fonte de dados. Ative "Editar" e use ⚙ para escolher a folha.' : 'Sem fonte de dados.'}</div>`;
  }
  if (q.error && !q.data) return html`<div class="error">${Icon('alert')} ${q.error.message}</div>`;
  if (!q.data) return html`<div class="center"><${Spinner} /></div>`;
  return null;
}

const selectsFor = (w) => {
  const s = {};
  if (w.groupColumn && w.stages?.length) s[w.groupColumn] = w.stages;
  if (w.stageColumn && w.stages?.length) s[w.stageColumn] = w.stages;
  return s;
};

// ---------- KPI ----------
function KpiWidget({ w, canEdit }) {
  const q = useTable(w.source);
  const st = Status({ w, q, canEdit });
  if (st) return st;
  const { headers, values } = q.data;
  const rows = applyFilter(q.data.rows, headers, w.filter);
  let value;
  let sub = '';
  if (w.mode === 'cell') {
    const a = parseA1(w.cell);
    const raw = a ? values[a.row]?.[a.col] ?? '' : '';
    value = !w.format || w.format === 'raw' ? (raw === '' ? '—' : raw) : fmtValue(parseNum(raw), w.format);
    sub = a ? `${q.data.tab} · ${w.cell.toUpperCase()}` : 'Indique a célula (ex.: B5)';
  } else if (w.mode === 'sum') {
    const i = colIdx(headers, w.valueColumn);
    const total = i < 0 ? NaN : rows.reduce((acc, r) => acc + (parseNum(r.cells[i]) || 0), 0);
    value = fmtValue(total, w.format || 'number');
    sub = i < 0 ? 'Escolha a coluna a somar' : `${rows.length} ${rows.length === 1 ? 'registo' : 'registos'}`;
  } else {
    value = fmtValue(rows.length, 'number');
    sub = w.filter?.values?.length ? `de ${q.data.rows.length} no total` : 'registos';
  }
  return html`<div class="kpi"><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

// ---------- Tabela ----------
function TableWidget({ w, canEdit }) {
  const q = useTable(w.source);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);
  const [edit, setEdit] = useState(null);
  const st = Status({ w, q, canEdit });
  if (st) return st;
  const { headers } = q.data;
  const editable = canEdit && q.data.editable;
  const cols = w.columns?.length ? w.columns.map((c) => colIdx(headers, c)).filter((i) => i >= 0) : headers.map((_, i) => i);
  const stageI = colIdx(headers, w.stageColumn);
  let rows = applyFilter(q.data.rows, headers, w.filter);
  if (search) rows = rows.filter((r) => r.cells.some((c) => norm(c).includes(norm(search))));
  if (sort) rows = [...rows].sort((a, b) => compareCells(a.cells[sort.i], b.cells[sort.i]) * sort.dir);
  const toggleSort = (i) => setSort((s) => (s?.i === i ? (s.dir === 1 ? { i, dir: -1 } : null) : { i, dir: 1 }));

  return html`<div class="table-w">
    <div class="w-toolbar">
      <label class="search">${Icon('search')}<input type="search" placeholder="Pesquisar…" value=${search} onInput=${(e) => setSearch(e.target.value)} /></label>
      <span class="muted small">${rows.length}</span>
      <span class="spacer"></span>
      ${!q.data.editable ? html`<a class="badge" href=${openUrl(w.source)} target="_blank" rel="noopener" title="Os ficheiros Excel só podem ser editados no Drive">Excel · só leitura ${Icon('external')}</a>` : null}
      ${editable ? html`<button class="btn small primary" onClick=${() => setEdit({ row: null })}>${Icon('plus')} Novo</button>` : null}
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr>${cols.map((i) => html`<th onClick=${() => toggleSort(i)} aria-sort=${sort?.i === i ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
          ${headers[i]}${sort?.i === i ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`)}</tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr key=${r._row} onClick=${() => setEdit({ row: r })}>
            ${cols.map((i) => html`<td>${i === stageI && r.cells[i]
              ? html`<span class="pill"><i style=${`background:${stageColor(w.stages, r.cells[i])}`}></i>${r.cells[i]}</span>`
              : r.cells[i]}</td>`)}
          </tr>`)}
          ${!rows.length ? html`<tr><td colspan=${cols.length} class="muted center">Sem registos.</td></tr>` : null}
        </tbody>
      </table>
    </div>
    ${edit ? html`<${RowEditor} source=${w.source} data=${q.data} row=${edit.row} selects=${selectsFor(w)} canEdit=${canEdit} titleColumn=${w.titleColumn} onClose=${() => setEdit(null)} />` : null}
  </div>`;
}

// ---------- Kanban / funil ----------
function KanbanWidget({ w, canEdit }) {
  const q = useTable(w.source);
  const [edit, setEdit] = useState(null);
  const [over, setOver] = useState(null);
  const [moving, setMoving] = useState({});
  const drag = useRef(null);
  const st = Status({ w, q, canEdit });
  if (st) return st;
  const { headers } = q.data;
  const gi = colIdx(headers, w.groupColumn);
  if (gi < 0) return html`<div class="empty">Escolha a coluna de estado (⚙).</div>`;
  const ti = Math.max(0, colIdx(headers, w.titleColumn));
  const subs = (w.subtitleColumns || []).map((c) => colIdx(headers, c)).filter((i) => i >= 0);
  const di = colIdx(headers, w.dateColumn);
  const rows = applyFilter(q.data.rows, headers, w.filter);
  const editable = canEdit && q.data.editable;

  const stages = w.stages?.length ? w.stages : distinct(rows, gi);
  const groups = new Map(stages.map((s) => [s, []]));
  for (const r of rows) {
    const v = moving[r._row] ?? r.cells[gi];
    const key = [...groups.keys()].find((k) => norm(k) === norm(v)) ?? (v.trim() || 'Sem estado');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const drop = async (stage) => {
    setOver(null);
    const r = drag.current;
    drag.current = null;
    if (!r || !editable || norm(r.cells[gi]) === norm(stage)) return;
    setMoving((m) => ({ ...m, [r._row]: stage }));
    try { await setCell(w.source, q.data, r, gi, stage === 'Sem estado' ? '' : stage); }
    catch (e) { if (e.name !== 'AuthError') toast(e.message, 'error'); }
    setMoving((m) => { const n = { ...m }; delete n[r._row]; return n; });
  };

  return html`<div class="kanban">
    ${[...groups].map(([stage, items]) => html`<div
        class=${`k-col${over === stage ? ' over' : ''}`}
        onDragOver=${(e) => { if (editable) { e.preventDefault(); setOver(stage); } }}
        onDragLeave=${() => setOver((o) => (o === stage ? null : o))}
        onDrop=${(e) => { e.preventDefault(); drop(stage); }}>
      <div class="k-head"><i style=${`background:${stageColor(stages, stage)}`}></i><span>${stage}</span><b>${items.length}</b></div>
      <div class="k-list">
        ${items.map((r) => {
          const d = di >= 0 ? parseDate(r.cells[di]) : null;
          return html`<button key=${r._row} class=${`k-card${moving[r._row] ? ' moving' : ''}`} draggable=${editable}
              onDragStart=${(e) => { drag.current = r; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(r._row)); }}
              onClick=${() => setEdit(r)}>
            <strong>${r.cells[ti] || '(sem nome)'}</strong>
            ${subs.map((i) => (r.cells[i] ? html`<span class="k-sub">${r.cells[i]}</span>` : null))}
            ${d ? html`<span class=${`due ${dueClass(d)}`}>${Icon('calendar')} ${r.cells[di]} · ${relDay(d)}</span>` : null}
          </button>`;
        })}
      </div>
    </div>`)}
    ${edit ? html`<${RowEditor} source=${w.source} data=${q.data} row=${edit} selects=${selectsFor(w)} canEdit=${canEdit} titleColumn=${w.titleColumn} onClose=${() => setEdit(null)} />` : null}
  </div>`;
}

// ---------- Próximos passos ----------
function AgendaWidget({ w, canEdit }) {
  const q = useTable(w.source);
  const [edit, setEdit] = useState(null);
  const st = Status({ w, q, canEdit });
  if (st) return st;
  const { headers } = q.data;
  const di = colIdx(headers, w.dateColumn);
  if (di < 0) return html`<div class="empty">Escolha a coluna de data (⚙).</div>`;
  const ti = Math.max(0, colIdx(headers, w.titleColumn));
  const xi = colIdx(headers, w.detailColumn);
  const today = startOfToday();
  const items = applyFilter(q.data.rows, headers, w.filter)
    .map((r) => ({ r, d: parseDate(r.cells[di]) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d);
  const late = items.filter((x) => x.d < today);
  const next = items.filter((x) => x.d >= today);
  const item = ({ r, d }) => html`<li key=${r._row}><button onClick=${() => setEdit(r)}>
    <span class=${`due ${dueClass(d)}`}>${relDay(d)}</span>
    <span class="a-main"><strong>${r.cells[ti]}</strong>${xi >= 0 && r.cells[xi] ? html`<span class="muted">${r.cells[xi]}</span>` : null}</span>
    <span class="muted small">${r.cells[di]}</span>
  </button></li>`;
  return html`<div class="agenda">
    ${!items.length ? html`<div class="empty">Sem datas marcadas.</div>` : null}
    ${late.length ? html`<h4 class="late">${Icon('alert')} Em atraso (${late.length})</h4><ul>${late.map(item)}</ul>` : null}
    ${next.length ? html`<h4>Próximos</h4><ul>${next.map(item)}</ul>` : null}
    ${edit ? html`<${RowEditor} source=${w.source} data=${q.data} row=${edit} selects=${selectsFor(w)} canEdit=${canEdit} titleColumn=${w.titleColumn} onClose=${() => setEdit(null)} />` : null}
  </div>`;
}

// ---------- Gráfico ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function ChartWidget({ w, canEdit }) {
  const q = useTable(w.source);
  const canvas = useRef(null);
  const chart = useRef(null);
  const agg = useMemo(() => {
    if (!q.data) return null;
    const { headers } = q.data;
    const gi = colIdx(headers, w.groupColumn);
    if (gi < 0) return null;
    const vi = colIdx(headers, w.valueColumn);
    const m = new Map();
    for (const r of applyFilter(q.data.rows, headers, w.filter)) {
      const k = r.cells[gi].trim() || '(vazio)';
      const key = [...m.keys()].find((x) => norm(x) === norm(k)) ?? k;
      m.set(key, (m.get(key) || 0) + (w.mode === 'sum' ? parseNum(r.cells[vi]) || 0 : 1));
    }
    let entries = [...m];
    if (w.stages?.length) {
      const pos = (k) => { const i = w.stages.findIndex((s) => norm(s) === norm(k)); return i < 0 ? 999 : i; };
      entries.sort((a, b) => pos(a[0]) - pos(b[0]));
    } else entries.sort((a, b) => b[1] - a[1]);
    // Circular: no máximo 7 fatias com cor própria; o resto junta-se em "Outros".
    if (w.chartType === 'doughnut' && entries.length > 8) {
      const rest = entries.slice(7).reduce((a, e) => a + e[1], 0);
      entries = [...entries.slice(0, 7), ['Outros', rest]];
    }
    return { labels: entries.map((e) => e[0]), data: entries.map((e) => e[1]) };
  }, [q.data, w.groupColumn, w.valueColumn, w.mode, w.chartType, JSON.stringify(w.filter), JSON.stringify(w.stages)]);

  useEffect(() => {
    if (!canvas.current || !agg || !window.Chart) return undefined;
    const fmt = (v) => fmtValue(v, w.mode === 'sum' ? w.format || 'number' : 'number');
    const text = cssVar('--text-2') || '#52514e';
    const grid = cssVar('--grid') || '#e6e5e0';
    const surface = cssVar('--surface') || '#fff';
    const isPie = w.chartType === 'doughnut';
    const colors = isPie ? agg.labels.map((l, i) => (l === 'Outros' ? NEUTRAL : w.stages?.length ? stageColor(w.stages, l) : PALETTE[i] || NEUTRAL)) : cssVar('--series-1') || PALETTE[0];
    chart.current?.destroy();
    chart.current = new window.Chart(canvas.current, {
      type: isPie ? 'doughnut' : 'bar',
      data: { labels: agg.labels, datasets: [{ data: agg.data, backgroundColor: colors, borderColor: surface, borderWidth: isPie ? 2 : 0, borderRadius: isPie ? 0 : 4, borderSkipped: 'start', maxBarThickness: 28 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        indexAxis: isPie ? undefined : 'y',
        cutout: isPie ? '62%' : undefined,
        plugins: {
          legend: { display: isPie, position: 'bottom', labels: { color: text, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.raw)}` } },
        },
        scales: isPie ? {} : {
          x: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, precision: 0, callback: (v) => fmt(v) } },
          y: { grid: { display: false }, border: { color: grid }, ticks: { color: text } },
        },
      },
    });
    return () => { chart.current?.destroy(); chart.current = null; };
  }, [agg]);

  const st = Status({ w, q, canEdit });
  if (st) return st;
  if (!agg) return html`<div class="empty">Escolha a coluna para agrupar (⚙).</div>`;
  if (!agg.labels.length) return html`<div class="empty">Sem dados.</div>`;
  return html`<div class="chart-box"><canvas ref=${canvas} role="img" aria-label=${`${w.title}: ${agg.labels.map((l, i) => `${l} ${agg.data[i]}`).join(', ')}`}></canvas></div>`;
}

// ---------- Ficheiro (pré-visualização) ----------
function FileWidget({ w, canEdit }) {
  if (!w.file?.fileId) {
    return html`<div class="empty">${canEdit ? 'Nenhum ficheiro escolhido. Ative "Editar" e use ⚙ para escolher o PDF ou Slides.' : 'Nenhum ficheiro escolhido.'}</div>`;
  }
  return html`<div class="file-w">
    <iframe src=${previewUrl(w.file.fileId, w.file.mimeType)} title=${w.file.name} allow="fullscreen" loading="lazy"></iframe>
  </div>`;
}

// ---------- Lista de ficheiros ----------
const kindOf = (m) => (m === MIME.SHEET ? 'Sheets' : m === MIME.SLIDES ? 'Slides' : m === MIME.DOC ? 'Docs' : m === MIME.PDF ? 'PDF'
  : /spreadsheet|excel/.test(m) ? 'Excel' : /image/.test(m) ? 'Imagem' : /word/.test(m) ? 'Word' : /presentation|powerpoint/.test(m) ? 'PowerPoint' : 'Ficheiro');

function FilesWidget() {
  const { files, error } = useFiles();
  const [search, setSearch] = useState('');
  if (error && !files) return html`<div class="error">${error.message}</div>`;
  if (!files) return html`<div class="center"><${Spinner} /></div>`;
  const list = files
    .filter((f) => !search || norm(f.path + f.name).includes(norm(search)))
    .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return html`<div class="files-w">
    <div class="w-toolbar">
      <label class="search">${Icon('search')}<input type="search" placeholder="Pesquisar ficheiros…" value=${search} onInput=${(e) => setSearch(e.target.value)} /></label>
      <button class="icon-btn" title="Atualizar lista" onClick=${refreshFiles}>${Icon('refresh')}</button>
    </div>
    <ul>
      ${list.map((f) => html`<li key=${f.id}><a href=${f.webViewLink} target="_blank" rel="noopener">
        <img src=${f.iconLink} alt="" width="16" height="16" />
        <span class="f-name">${f.path ? html`<span class="muted">${f.path}</span>` : null}${f.name}</span>
        <span class="muted small">${kindOf(f.mimeType)} · ${new Date(f.modifiedTime).toLocaleDateString('pt-PT')}</span>
      </a></li>`)}
      ${!list.length ? html`<li class="muted center">A pasta está vazia.</li>` : null}
    </ul>
  </div>`;
}

// ---------- Notas ----------
function NotesWidget({ w, section, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(w.text || '');
  useEffect(() => { if (!editing) setText(w.text || ''); }, [w.text]);
  const commit = () => {
    setEditing(false);
    if (text === (w.text || '')) return;
    save((cfg) => {
      const x = cfg.sections.find((s) => s.id === section.id)?.widgets.find((y) => y.id === w.id);
      if (x) x.text = text;
    });
  };
  if (editing) {
    return html`<div class="notes"><textarea value=${text} onInput=${(e) => setText(e.target.value)} autofocus></textarea>
      <div class="row-end"><button class="btn small" onClick=${() => { setText(w.text || ''); setEditing(false); }}>Cancelar</button><button class="btn small primary" onClick=${commit}>Guardar</button></div></div>`;
  }
  return html`<div class="notes">
    <div class="notes-text">${w.text ? linkify(w.text) : html`<span class="muted">Sem notas.</span>`}</div>
    ${canEdit ? html`<button class="btn small ghost notes-edit" onClick=${() => setEditing(true)}>${Icon('edit')} Editar</button>` : null}
  </div>`;
}
function linkify(text) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) => (i % 2 ? html`<a href=${p} target="_blank" rel="noopener">${p}</a>` : p));
}

export const RENDERERS = {
  kpi: KpiWidget, table: TableWidget, kanban: KanbanWidget, agenda: AgendaWidget,
  chart: ChartWidget, file: FileWidget, files: FilesWidget, notes: NotesWidget,
};

export { isPreviewable };
