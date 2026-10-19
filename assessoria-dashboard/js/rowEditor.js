// Formulário para ver/editar/criar uma linha de uma folha.
import { html, useState } from './lib.js';
import { Modal, toast } from './ui.js';
import { saveRow, removeRow } from './data.js';
import { isDateHeader, parseDate, toISO, toPT, norm, openUrl } from './util.js';

const isLong = (h, v) => /notas|observa|descri|coment/i.test(h) || String(v || '').length > 80;

export function RowEditor({ source, data, row, selects = {}, canEdit, onClose, titleColumn }) {
  const { headers } = data;
  const editable = canEdit && data.editable;
  const [vals, setVals] = useState(() => (row ? [...row.cells] : headers.map(() => '')));
  const [busy, setBusy] = useState(false);
  const dateCols = new Set(headers.map((h, i) => (isDateHeader(h) ? i : -1)).filter((i) => i >= 0));
  const ti = Math.max(0, headers.findIndex((h) => norm(h) === norm(titleColumn)));
  const set = (i, v) => setVals((old) => { const n = [...old]; n[i] = v; return n; });

  const onSave = async () => {
    setBusy(true);
    try {
      await saveRow(source, data, row, vals, dateCols);
      toast(row ? 'Alterações guardadas na folha.' : 'Registo adicionado à folha.', 'ok');
      onClose();
    } catch (e) { if (e.name !== 'AuthError') toast(e.message, 'error'); setBusy(false); }
  };
  const onDelete = async () => {
    if (!confirm('Eliminar esta linha da folha? Esta ação não pode ser anulada aqui.')) return;
    setBusy(true);
    try { await removeRow(source, data, row); toast('Linha eliminada.', 'ok'); onClose(); }
    catch (e) { if (e.name !== 'AuthError') toast(e.message, 'error'); setBusy(false); }
  };

  const field = (h, i) => {
    const v = vals[i] ?? '';
    const id = `f-${i}`;
    let input;
    const opts = Object.entries(selects).find(([k]) => norm(k) === norm(h))?.[1];
    if (!editable) {
      input = html`<div class="ro">${v || html`<span class="muted">—</span>`}</div>`;
    } else if (opts) {
      const all = v && !opts.some((o) => norm(o) === norm(v)) ? [...opts, v] : opts;
      input = html`<select id=${id} value=${v} onChange=${(e) => set(i, e.target.value)}>
        <option value="">—</option>${all.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
    } else if (dateCols.has(i) && (!v || parseDate(v))) {
      const d = parseDate(v);
      input = html`<input id=${id} type="date" value=${d ? toISO(d) : ''} onInput=${(e) => { const nd = parseDate(e.target.value); set(i, nd ? toPT(nd) : ''); }} />`;
    } else if (isLong(h, row?.cells[i])) {
      input = html`<textarea id=${id} rows="4" value=${v} onInput=${(e) => set(i, e.target.value)}></textarea>`;
    } else {
      input = html`<input id=${id} type="text" value=${v} onInput=${(e) => set(i, e.target.value)} />`;
    }
    return html`<div class=${`field${isLong(h, row?.cells[i]) ? ' full' : ''}`}><label for=${id}>${h}</label>${input}</div>`;
  };

  const footer = html`
    ${editable && row ? html`<button class="btn danger ghost" disabled=${busy} onClick=${onDelete}>Eliminar</button>` : null}
    <a class="btn ghost" href=${openUrl(source)} target="_blank" rel="noopener">Abrir ficheiro</a>
    <span class="spacer"></span>
    <button class="btn" onClick=${onClose}>${editable ? 'Cancelar' : 'Fechar'}</button>
    ${editable ? html`<button class="btn primary" disabled=${busy} onClick=${onSave}>${busy ? 'A guardar…' : 'Guardar'}</button>` : null}`;

  return html`<${Modal} title=${row ? (row.cells[ti] || 'Registo') : 'Novo registo'} onClose=${onClose} footer=${footer} wide>
    ${!data.editable ? html`<p class="notice">Ficheiro Excel: aqui é só leitura. Use "Abrir ficheiro" para editar no Drive.</p>` : null}
    <div class="form grid2">${headers.map(field)}</div>
  </${Modal}>`;
}
