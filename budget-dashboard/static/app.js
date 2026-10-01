"use strict";

const POLL_MS = 5000;
let data = null;
let version = null;
// Seleção: "#<projeto>/<página>" (páginas: kpis | financing | sales)
let [selectedId, page] = (() => {
  const [id, pg] = decodeURIComponent(location.hash.slice(1)).split("/");
  return [id || null, pg || "kpis"];
})();
const PAGES = [["kpis", "Project KPIs"], ["financing", "Financing"], ["sales", "Sales"]];
const pagesOf = (p) => PAGES.filter(([k]) => k === "kpis" || (k === "financing" && p.financing) || (k === "sales" && p.sales_name));

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
  // Cada projeto tem um dropdown com as suas páginas (Project KPIs / Financing / Sales)
  const btn = (p, sub) => {
    const sel = p.id === selectedId;
    const pages = sel ? `<div class="proj-pages">${pagesOf(p).map(([k, label]) =>
      `<button type="button" class="ppage ${sub ? "sub" : ""} ${k === page ? "active" : ""}" data-id="${p.id}" data-page="${k}">${label}</button>`).join("")}</div>` : "";
    return `<div class="pitem ${sel ? "open" : ""}"><button type="button" class="proj ${sub ? "sub" : ""} ${sel ? "active" : ""}"
      data-id="${p.id}" title="${esc(p.file)} › ${esc(p.sheet)}"><span>${esc(p.label || p.name)}</span><span class="chev" aria-hidden="true"></span></button>${pages}</div>`;
  };
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
  if (!pagesOf(p).some(([k]) => k === page)) page = "kpis";
  const extra = p.budget_missing
    ? `<div class="banner no-print">Budget sheet <b>${esc(p.budget_missing)}</b> (config.json) was not found in <b>${esc(p.file)}</b>.</div>` : "";
  const body = page === "financing" ? financingPageHtml(p) : page === "sales" ? salesPageHtml(p) : reportHtml(p);
  $("#main").innerHTML = banners() + extra + body;
}

function select(id, pg) {
  selectedId = id;
  page = pg || "kpis";
  history.replaceState(null, "", "#" + encodeURIComponent(selectedId) + "/" + page);
  render();
}

function simpleHead(p, title, sub) {
  return `<div class="report-head"><div>
      <div class="kicker">${p.menu_group ? `${esc(p.menu_group)} · ` : ""}${esc(p.label || p.name)}</div>
      <h1>${esc(title)}</h1>${sub ? `<div class="src">${sub}</div>` : ""}</div></div>`;
}

function financingPageHtml(p) {
  return `<section class="report page-financing">${simpleHead(p, "Financing", "financing.json")}${financingHtml(p.financing)}</section>`;
}

// ---------- Sales (Power BI: Typology Report) ----------
function salesPageHtml(p) {
  const st = data.sales_status || {};
  const head = simpleHead(p, "Sales", `Power BI · ${esc(p.sales_name)}${st.updated ? ` · updated ${fmtTime(st.updated)}` : ""}`);
  let note = "";
  if (!st.configured) {
    note = `<div class="empty"><p>Sales data comes from the Power BI report <b>vizta - sales dashboards</b>.
      It will appear here once IT creates the App registration with the Power BI permission
      <code>Dataset.Read.All</code> (see README) and the <code>powerbi</code> section of <code>config.json</code> is filled in.</p>
      ${st.error ? `<p class="sub">${esc(st.error)}</p>` : ""}</div>`;
  } else if (st.error) {
    note = `<div class="banner">Could not read Power BI${p.sales ? " (showing last good data)" : ""}: ${esc(st.error)}</div>`;
  }
  if (!p.sales) {
    return `<section class="report page-sales">${head}${note || `<div class="empty"><p>No sales data for <b>${esc(p.sales_name)}</b> in Power BI.</p></div>`}</section>`;
  }
  return `<section class="report page-sales">${head}${note}${typologyHtml(p.sales)}</section>`;
}

function typologyHtml(s) {
  const T = s.typologies;
  const byStatus = Object.fromEntries(s.rows.map((r) => [r.status, r]));
  const zero = { units: {}, retail_units: 0, amount: 0, area: 0, retail_amount: 0 };
  const sum = (keys, label, kind) => {
    const rs = keys.map((k) => byStatus[k] || zero);
    const units = {};
    for (const t of T) units[t] = rs.reduce((a, r) => a + (r.units[t] || 0), 0);
    return { label, kind, units, retail_units: rs.reduce((a, r) => a + r.retail_units, 0),
      amount: rs.reduce((a, r) => a + r.amount, 0), area: rs.reduce((a, r) => a + r.area, 0),
      retail_amount: rs.reduce((a, r) => a + r.retail_amount, 0) };
  };
  const row = (k) => ({ ...(byStatus[k] || zero), kind: "line", label: (byStatus[k] || {}).label || k });
  const lines = [row("PSPA"), row("Reserved"), sum(["PSPA", "Reserved"], "TOTAL (Reserved + PSPA)", "total"),
    row("Off-market"), row("Available"), sum(["Off-market", "Available"], "TOTAL Available", "total"),
    sum(["PSPA", "Reserved", "Off-market", "Available"], "TOTAL Project", "grand")];
  const tot = lines[lines.length - 1];
  const nUnits = (r) => T.reduce((a, t) => a + (r.units[t] || 0), 0);
  const cnt = (v) => (v ? fmtNum(v) : "");
  const unitsRows = lines.map((r) => `<tr class="t-${r.kind}"><td class="lbl">${esc(r.label)}</td>
      ${T.map((t) => `<td>${cnt(r.units[t])}</td>`).join("")}
      <td class="sum">${fmtNum(nUnits(r))}</td><td>${nUnits(tot) ? fmtPct(nUnits(r) / nUnits(tot)) : ""}</td>
      <td>${cnt(r.retail_units)}</td><td class="sum">${fmtNum(nUnits(r) + r.retail_units)}</td></tr>`).join("");
  const eur = (v) => (v ? fmtEur(v) : "");
  const amountRows = lines.map((r) => `<tr class="t-${r.kind}"><td class="lbl">${esc(r.label.replace(" units", ""))}${r.kind === "line" ? " amount" : ""}</td>
      <td>${eur(r.amount)}</td><td>${r.area ? fmtEur(r.amount / r.area) : ""}</td>
      <td>${tot.amount ? fmtPct(r.amount / tot.amount) : ""}</td><td>${eur(r.retail_amount)}</td>
      <td class="sum">${eur(r.amount + r.retail_amount)}</td></tr>`).join("");
  return `<h2 class="sec">Typology</h2>
    <div class="t-scroll"><table class="typo">
      <thead><tr><th class="lbl">Units</th>${T.map((t) => `<th>${esc(t)}</th>`).join("")}<th># Total</th><th>%</th><th># Retail</th><th># Resi+Retail</th></tr></thead>
      <tbody>${unitsRows}</tbody></table></div>
    <div class="t-scroll"><table class="typo amounts">
      <thead><tr><th class="lbl">Amounts</th><th>€ Residential</th><th>€/sqm</th><th>%</th><th>€ Retail</th><th>€ Resi+Retail</th></tr></thead>
      <tbody>${amountRows}</tbody></table></div>`;
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

  return `<section class="report">
    ${headHtml(p, p.sheet)}
    ${tools}
    <table class="pr"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${notes}${kpis}${after}
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
  const pg = e.target.closest(".ppage[data-page]");
  if (pg) {
    select(pg.dataset.id, pg.dataset.page);
    return;
  }
  const b = e.target.closest(".proj[data-id]");
  if (!b) return;
  // Projeto: abre o dropdown das páginas e mostra os Project KPIs
  select(b.dataset.id, b.dataset.id === selectedId ? page : "kpis");
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
