"use strict";

const POLL_MS = 5000;
let data = null;
let version = null;
let selectedId = decodeURIComponent(location.hash.slice(1)) || null;

// Preferências do utilizador (só neste browser): grupos do menu abertos.
function loadPref(k, def) {
  try { const v = localStorage.getItem("bd." + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
}
function savePref(k, v) {
  try { localStorage.setItem("bd." + k, JSON.stringify(v)); } catch (e) { /* sem storage */ }
}
const openGroups = new Set(loadPref("openGroups", []));
const openRubrics = new Set();               // rubricas abertas: `${projectId}|${índice da linha}`

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- formatação (valores em k€, como no Excel) ----------
function fmtNum(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return esc(v);
  let n = Math.round(v);
  if (Object.is(n, -0)) n = 0;
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + s;
}
function fmtPct(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return esc(v);
  let s = (v * 100).toFixed(2);
  if (/^-0\.00$/.test(s)) s = "0.00";
  return s.replace(".", ",") + "%";
}
const fmt = (v, pct) => (pct ? fmtPct(v) : fmtNum(v));
const fmtEur = (v) => (typeof v === "number" ? `${fmtNum(v)} €` : esc(v));
const fmtRate = (v) => (typeof v === "number" ? `${v.toFixed(3).replace(".", ",")}%` : esc(v));
function fmtDate(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(iso);
}
function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ---------- dados ----------
function allProjects() {
  if (!data) return [];
  return data.files.flatMap((f) => f.projects.map((p) => ({ ...p, group: f.group, file: f.file, modified: f.modified, remote: f.remote })));
}

function orderedProjects() {
  // Pela ordem do menu (config.json); o servidor já acrescenta no fim os que não estão no menu.
  const byId = Object.fromEntries(allProjects().map((p) => [p.id, p]));
  return (data.menu || []).flatMap((m) => (m.item ? [m.item] : m.items)).map((id) => byId[id]).filter(Boolean);
}

async function load() {
  const res = await fetch("/api/projects", { cache: "no-store" });
  data = await res.json();
  version = data.version;
  const ids = orderedProjects().map((p) => p.id);
  if (!ids.includes(selectedId)) selectedId = ids[0] || null;
  render();
}

async function poll() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    const v = (await res.json()).version;
    if (v !== version) {
      const before = data ? Object.fromEntries(data.files.map((f) => [f.path, f.modified])) : {};
      await load();
      const changed = data.files.filter((f) => before[f.path] !== undefined && before[f.path] !== f.modified).map((f) => f.file);
      if (changed.length) toast(`Updated: ${changed.join(", ")}`);
    }
    setStatus(true);
  } catch (e) {
    setStatus(false);
  }
}

function setStatus(ok) {
  const el = $("#status");
  if (!ok) {
    el.innerHTML = `<span class="dot warn"></span>Server not reachable — is <code>app.py</code> still running?`;
    return;
  }
  const n = allProjects().length;
  el.innerHTML = `<span class="dot"></span>${n} project${n === 1 ? "" : "s"} · live · last check ${new Date().toLocaleTimeString("en-GB")}`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- render ----------
function render() {
  renderSidebar();
  renderMain();
  setStatus(true);
}

function renderSidebar() {
  // Menu do config.json ("menu"): grupos com dropdown e nomes a mostrar.
  // Erros de leitura aparecem como avisos na área principal.
  const byId = Object.fromEntries(allProjects().map((p) => [p.id, p]));
  const btn = (p, sub) => `<button type="button" class="proj ${sub ? "sub" : ""} ${p.id === selectedId ? "active" : ""}"
      data-id="${p.id}" title="${esc(p.file)} › ${esc(p.sheet)}">${esc(p.label || p.name)}</button>`;
  const html = (data.menu || []).map((m) => {
    if (m.item) return byId[m.item] ? btn(byId[m.item], false) : "";
    const items = m.items.map((id) => byId[id]).filter(Boolean);
    const open = openGroups.has(m.group) || items.some((p) => p.id === selectedId);
    return `<div class="mgroup ${open ? "open" : ""}">
      <button type="button" class="mgroup-head ${items.some((p) => p.id === selectedId) ? "has-active" : ""}" data-group="${esc(m.group)}">
        <span>${esc(m.group)}</span><span class="chev" aria-hidden="true"></span></button>
      <div class="mgroup-items">${items.map((p) => btn(p, true)).join("")}</div>
    </div>`;
  }).join("");
  $("#sidebar").innerHTML = `<div class="side-title">Projects</div>` + (html || `<div class="proj">No projects</div>`);
}

function banners() {
  const out = [];
  for (const m of data.missing) out.push(`Source not found: <code>${esc(m)}</code> — check <code>config.json</code> (is OneDrive synced?).`);
  for (const se of data.source_errors || []) out.push(`Could not read SharePoint link <code>${esc(se.source.slice(0, 70))}…</code>: ${esc(se.error)}`);
  for (const f of data.files) if (f.error) out.push(`Could not read <b>${esc(f.file)}</b> (showing last good data, retrying automatically): ${esc(f.error)}`);
  for (const f of data.files) if (!f.error && !f.projects.length) out.push(`No Project Review sheet found in <b>${esc(f.file)}</b>.`);
  if (data.financing_error) out.push(esc(data.financing_error));
  for (const n of data.financing_unmatched || []) out.push(`Financing entry <b>${esc(n)}</b> in <code>financing.json</code> does not match any project name.`);
  for (const n of data.menu_unmatched || []) out.push(`Menu entry <b>${esc(n)}</b> in <code>config.json</code> does not match any loaded project (check the name, or whether its file could be read).`);
  return out.map((b) => `<div class="banner no-print">${b}</div>`).join("");
}

function renderMain() {
  const p = allProjects().find((x) => x.id === selectedId);
  if (!p) {
    $("#main").innerHTML = banners() + `<div class="empty"><h2>No projects found</h2>
      <p>Add the OneDrive folders or Excel files to <code>config.json</code> (see <code>config.example.json</code>).
      Each file is scanned for sheets that contain the Project Review table (a <code>Δ</code> column header and a <code>TOTAL COST</code> row).</p></div>`;
    return;
  }
  const extra = p.budget_missing
    ? `<div class="banner no-print">Budget sheet <b>${esc(p.budget_missing)}</b> (config.json) was not found in <b>${esc(p.file)}</b>.</div>` : "";
  $("#main").innerHTML = banners() + extra + reportHtml(p);
}

function headHtml(p, source) {
  return `<div class="report-head">
      <div>${p.menu_group ? `<div class="kicker">${esc(p.menu_group)}</div>` : ""}<h1>${esc(p.label || p.name)}</h1>
        <div class="src">${p.remote ? "SharePoint · " : ""}${esc(p.group)} › ${esc(source)} · k€</div></div>
      <div class="dates">Last project review: <b>${fmtDate(p.last_review)}</b><br>
        Next project review: <b>${fmtDate(p.next_review)}</b><br>
        File saved: ${fmtTime(p.modified)}</div>
    </div>`;
}

function toggleRubric(tr, force) {
  const key = tr.dataset.key;
  const open = force === undefined ? !openRubrics.has(key) : force;
  if (open) openRubrics.add(key); else openRubrics.delete(key);
  tr.classList.toggle("open", open);
  if (tr.hasAttribute("aria-expanded")) tr.setAttribute("aria-expanded", open);
  document.querySelectorAll(`tr.subrow[data-parent="${CSS.escape(key)}"]`).forEach((s) => (s.hidden = !open));
}

function reportHtml(p) {
  const n = p.columns.length;
  const latest = n - 1;
  const head = `<tr><th class="lbl">${esc(p.name)}</th>${p.columns
    .map((c, i) => `<th class="${i === latest ? "latest" : ""}">${c.lines.map(esc).join("<br>")}</th>`)
    .join("")}<th class="delta">Δ</th></tr>`;

  const cells = (r) => r.values
    .map((v, i) => `<td class="${i === latest ? "latest" : ""}">${fmt(v, r.percent)}</td>`)
    .join("") + `<td class="delta">${fmt(r.delta, r.percent)}</td>`;
  let body = `<tr class="spacer"><td></td>${"<td></td>".repeat(n)}<td></td></tr>`;
  let prevKind = null;
  p.rows.forEach((r, idx) => {
    const cls = [r.kind === "line" ? "" : r.kind, r.kind !== "line" && prevKind === "line" ? "first-total" : ""];
    const kids = r.children || [];
    if (kids.length) {
      // Rubrica com subrubricas (lidas da folha de budget): clicar abre/fecha
      const key = `${p.id}|${idx}`;
      const open = openRubrics.has(key);
      body += `<tr class="${cls.join(" ")} rubric ${open ? "open" : ""}" data-key="${key}" tabindex="0" aria-expanded="${open}">
        <td class="lbl"><span class="chev" aria-hidden="true"></span>${esc(r.label)}</td>${cells(r)}</tr>`;
      for (const c of kids) {
        body += `<tr class="subrow" data-parent="${key}" ${open ? "" : "hidden"}><td class="lbl">${
          c.code ? `<span class="code">${esc(c.code)}</span>` : ""}${esc(c.label)}</td>${cells(c)}</tr>`;
      }
    } else {
      body += `<tr class="${cls.join(" ").trim()}"><td class="lbl">${esc(r.label)}</td>${cells(r)}</tr>`;
    }
    prevKind = r.kind;
  });
  const hasKids = p.rows.some((r) => (r.children || []).length);
  const tools = hasKids
    ? `<div class="b-tools no-print"><button type="button" data-expand="all">Expand all</button><button type="button" data-expand="none">Collapse all</button>
       <span class="b-src">Sub-items from <b>${esc(p.budget_link.sheet)}</b></span></div>` : "";

  const topNotes = p.notes.filter((x) => !x.below_kpis);
  const bottomNotes = p.notes.filter((x) => x.below_kpis);
  const notePill = (x) => `<span class="pill"><span>${esc(x.label)}</span><span>${fmt(x.value, x.percent)}</span></span>`;
  const notes = p.footnote || topNotes.length
    ? `<div class="notes"><span class="fn">${esc(p.footnote || "")}</span><span>${topNotes.map(notePill).join("")}</span></div>` : "";

  const kpis = p.kpis.length
    ? `<div class="kpis"><h2>${esc(p.kpi_title || "KPIs")}</h2><table class="kpi"><tbody>${p.kpis
        .map((k) => `<tr><td class="lbl">${esc(k.label)}</td>${k.values
          .map((lines) => `<td>${lines.map(esc).join("<br>")}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>` : "";
  const after = bottomNotes.length ? `<div class="notes"><span></span><span>${bottomNotes.map(notePill).join("")}</span></div>` : "";
  const fin = p.financing ? financingHtml(p.financing) : "";

  return `<section class="report">
    ${headHtml(p, p.sheet)}
    ${tools}
    <table class="pr"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${notes}${kpis}${after}${fin}
  </section>`;
}

function financingHtml(f) {
  const term = (months, end) => (months ? `${months} months${end ? ` · until ${fmtDate(end)}` : ""}` : "");
  const rate = f.index || f.spread !== undefined
    ? [esc(f.index || ""), f.spread !== undefined ? fmtRate(f.spread) : ""].filter(Boolean).join(" + ") : "";
  const items = [
    ["Bank", esc(f.bank)],
    ["Borrower", esc(f.borrower)],
    ["Signed", f.signed ? fmtDate(f.signed) : ""],
    ["Maturity", f.maturity ? fmtDate(f.maturity) : ""],
    ["Amount", f.amount !== undefined ? `<b>${fmtEur(f.amount)}</b>` : ""],
    ["Term", term(f.term_months, f.maturity)],
    ["Availability period", term(f.availability_months, f.availability_end)],
    ["Interest rate", rate ? `<b>${rate}</b>` : ""],
    ["Purpose", esc(f.purpose)],
    ["Own funds required", f.own_funds !== undefined ? `${fmtEur(f.own_funds)}${f.own_funds_note ? `<div class="sub">${esc(f.own_funds_note)}</div>` : ""}` : ""],
  ].filter(([, v]) => v);
  const d = f.distributions;
  const dist = d ? `<div class="fin-dist">
      <h3>Distributions to promoter${typeof d.max === "number" ? ` · up to ${fmtEur(d.max)}` : ""}</h3>
      ${(d.conditions || []).length ? `<ul>${d.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${d.note ? `<p class="sub">${esc(d.note)}</p>` : ""}
    </div>` : "";
  return `<div class="financing">
    <h2>Financing${f.facility ? ` <span>${esc(f.facility)}</span>` : ""}</h2>
    <dl class="fin-grid">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${dist}
  </div>`;
}

// ---------- eventos ----------
$("#sidebar").addEventListener("click", (e) => {
  const g = e.target.closest(".mgroup-head");
  if (g) {
    const wrap = g.parentElement;
    const open = !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    if (open) openGroups.add(g.dataset.group); else openGroups.delete(g.dataset.group);
    savePref("openGroups", [...openGroups]);
    return;
  }
  const b = e.target.closest(".proj[data-id]");
  if (!b) return;
  selectedId = b.dataset.id;
  history.replaceState(null, "", "#" + encodeURIComponent(selectedId));
  render();
});

$("#main").addEventListener("click", (e) => {
  const ex = e.target.closest("[data-expand]");
  if (ex) {
    document.querySelectorAll("#main tr.rubric").forEach((tr) => toggleRubric(tr, ex.dataset.expand === "all"));
    return;
  }
  const tr = e.target.closest("tr.rubric");
  if (tr) toggleRubric(tr);
});

$("#main").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr.rubric");
  if (tr && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    toggleRubric(tr);
  }
});

document.addEventListener("click", (e) => {
  const menuBtn = e.target.closest(".menu > button");
  document.querySelectorAll(".menu.open").forEach((m) => { if (!menuBtn || m !== menuBtn.parentElement) m.classList.remove("open"); });
  if (menuBtn) menuBtn.parentElement.classList.toggle("open");

  const pdf = e.target.closest("[data-pdf]");
  if (pdf) {
    if (pdf.dataset.pdf === "all") {
      $("#print-area").innerHTML = orderedProjects().map(reportHtml).join("");
      document.body.classList.add("print-all");
    }
    window.print();
  }
  const xlsx = e.target.closest("[data-xlsx]");
  if (xlsx) {
    location.href = xlsx.dataset.xlsx === "one" && selectedId ? `/api/export.xlsx?id=${encodeURIComponent(selectedId)}` : "/api/export.xlsx";
  }
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("print-all");
  $("#print-area").innerHTML = "";
});

load().catch(() => setStatus(false));
setInterval(poll, POLL_MS);
