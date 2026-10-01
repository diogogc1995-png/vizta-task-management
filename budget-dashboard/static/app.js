"use strict";

const POLL_MS = 5000;
let data = null;
let version = null;
// Seleção: "#<projeto>/<página>" (páginas: overview — o resumo, ao clicar no projeto — | kpis | financing | sales)
let [selectedId, page] = (() => {
  const [id, pg] = decodeURIComponent(location.hash.slice(1)).split("/");
  return [id || null, pg || "overview"];
})();
const PAGES = [["kpis", "Project KPIs"], ["financing", "Financing"], ["sales", "Sales"]];
const pagesOf = (p) => PAGES.filter(([k]) => k === "kpis" || (k === "financing" && p.financing) || (k === "sales" && p.sales_name));
const PORTFOLIO = "portfolio";
const PORTFOLIO_PAGES = [["summary", "Summary of all projects"], ["roadmap", "Roadmap"], ["financing", "Projects financing overview"]];
const validPage = (p, pg) => pg === "overview" || pagesOf(p).some(([k]) => k === pg);

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
  if (selectedId === PORTFOLIO) {
    if (!PORTFOLIO_PAGES.some(([k]) => k === page)) page = PORTFOLIO_PAGES[0][0];
  } else if (!ids.includes(selectedId)) selectedId = ids[0] || null;
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
    return `<div class="pitem ${sel ? "open" : ""}"><button type="button" class="proj ${sub ? "sub" : ""} ${sel ? "active" : ""} ${sel && page === "overview" ? "current" : ""}"
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
  // "Vizta Portfolio": páginas transversais a todos os projetos
  const inPf = selectedId === PORTFOLIO;
  const portfolio = `<div class="side-title">Vizta Portfolio</div>
    <div class="pitem open">${PORTFOLIO_PAGES.map(([k, label]) =>
      `<button type="button" class="ppage pf ${inPf && k === page ? "active" : ""}" data-id="${PORTFOLIO}" data-page="${k}">${label}</button>`).join("")}</div>`;
  $("#sidebar").innerHTML = portfolio + `<div class="side-title side-sep">Projects</div>` + (html || `<div class="proj">No projects</div>`);
}

function banners() {
  const out = [];
  for (const m of data.missing) out.push(`Source not found: <code>${esc(m)}</code> — check <code>config.json</code> (is OneDrive synced?).`);
  for (const se of data.source_errors || []) out.push(`Could not read SharePoint link <code>${esc(se.source.slice(0, 70))}…</code>: ${esc(se.error)}`);
  for (const f of data.files) if (f.error) out.push(`Could not read <b>${esc(f.file)}</b> (showing last good data, retrying automatically): ${esc(f.error)}`);
  for (const f of data.files) if (!f.error && !f.projects.length) out.push(`No Project Review sheet found in <b>${esc(f.file)}</b>.`);
  if (data.financing_error) out.push(esc(data.financing_error));
  if (data.info_error) out.push(esc(data.info_error));
  for (const n of data.financing_unmatched || []) out.push(`Financing entry <b>${esc(n)}</b> in <code>financing.json</code> does not match any project name.`);
  for (const n of data.menu_unmatched || []) out.push(`Menu entry <b>${esc(n)}</b> in <code>config.json</code> does not match any loaded project (check the name, or whether its file could be read).`);
  return out.map((b) => `<div class="banner no-print">${b}</div>`).join("");
}

function renderMain() {
  if (selectedId === PORTFOLIO) {
    $("#main").innerHTML = banners() + portfolioHtml(page);
    return;
  }
  const p = allProjects().find((x) => x.id === selectedId);
  if (!p) {
    $("#main").innerHTML = banners() + `<div class="empty"><h2>No projects found</h2>
      <p>Add the OneDrive folders or Excel files to <code>config.json</code> (see <code>config.example.json</code>).
      Each file is scanned for sheets that contain the Project Review table (a <code>Δ</code> column header and a <code>TOTAL COST</code> row).</p></div>`;
    return;
  }
  if (!validPage(p, page)) page = "overview";
  const extra = p.budget_missing
    ? `<div class="banner no-print">Budget sheet <b>${esc(p.budget_missing)}</b> (config.json) was not found in <b>${esc(p.file)}</b>.</div>` : "";
  const body = page === "financing" ? financingPageHtml(p) : page === "sales" ? salesPageHtml(p)
    : page === "kpis" ? reportHtml(p) : overviewHtml(p);
  $("#main").innerHTML = banners() + extra + body;
}

function select(id, pg) {
  selectedId = id;
  page = pg || "overview";
  history.replaceState(null, "", "#" + encodeURIComponent(selectedId) + "/" + page);
  render();
}

// ---------- Vizta Portfolio (conteúdo a definir) ----------
function portfolioHtml(pg) {
  const [, title] = PORTFOLIO_PAGES.find(([k]) => k === pg) || PORTFOLIO_PAGES[0];
  if (pg === "roadmap") return roadmapHtml(title);
  return `<section class="report portfolio">
    <div class="report-head"><div><div class="kicker">Vizta Portfolio</div><h1>${esc(title)}</h1></div></div>
    <div class="empty"><p>Content to be defined.</p></div>
  </section>`;
}

// ---------- Roadmap (ficheiro "RM mensuelle Portugal") ----------
function roadmapHtml(title) {
  const rm = data.roadmap || {};
  const rows = rm.rows || [];
  const head = `<div class="report-head"><div><div class="kicker">Vizta Portfolio</div><h1>${esc(title)}</h1>
      <div class="src">${esc(rm.sheet || "")}${rm.modified ? ` · file saved ${fmtTime(rm.modified)}` : ""}</div></div></div>`;
  const notes = [rm.error ? `<div class="banner">${esc(rm.error)}${rows.length ? " (showing last good data)" : ""}</div>` : "",
    (rm.unmatched || []).length ? `<div class="banner">Roadmap rows not found in the sheet: ${rm.unmatched.map(esc).join(", ")}</div>` : ""].join("");
  if (!rows.length) {
    return `<section class="report portfolio">${head}${notes || `<div class="empty"><p>No roadmap configured (<code>config.json</code> → <code>roadmap</code>).</p></div>`}</section>`;
  }
  const D = (iso) => (iso ? new Date(iso + "T00:00:00") : null);
  const lastYear = Math.max(...rows.map((r) => (D(r.end_deliveries) || D(r.construction_end) || new Date()).getFullYear()));
  const y0 = rm.from_year || Math.min(...rows.map((r) => (D(r.launch) || new Date()).getFullYear()));
  const t0 = new Date(y0, 0, 1).getTime();
  const t1 = new Date(lastYear + 1, 0, 1).getTime();
  const pos = (d) => Math.min(100, Math.max(0, ((d.getTime() - t0) / (t1 - t0)) * 100));
  const years = [];
  for (let y = y0; y <= lastYear; y++) years.push(y);
  const today = new Date();
  const quarter = (d) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  const fd = (iso) => fmtDate(iso);

  const bar = (cls, a, b, label) => {
    if (!a || !b || b <= a || b.getTime() <= t0) return "";
    const l = pos(a), w = pos(b) - l;
    return w > 0 ? `<span class="rm-bar ${cls}" style="left:${l}%;width:${w}%" title="${esc(label)}"></span>` : "";
  };
  const diamond = (cls, d, label) => (d ? `<span class="rm-dia ${cls}" style="left:${pos(d)}%" title="${esc(label)}"></span>` : "");

  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.name === r.group) g.rows.push(r); else groups.push({ name: r.group, rows: [r] });
  }
  const body = groups.map((g) => g.rows.map((r, i) => {
    const acq = D(r.acquisition) || D(r.projeto_base), launch = D(r.launch), cs = D(r.construction_start),
      ce = D(r.construction_end), eod = D(r.end_deliveries), pspa = D(r.pspa);
    const devEnd = launch || cs;
    const bars = [
      bar("dev", acq, devEnd, `Development & licensing: ${fd(r.acquisition || r.projeto_base)} → ${fd(r.launch || r.construction_start)}`),
      bar("pre", launch, cs, `Pre-sales: ${fd(r.launch)} → ${fd(r.construction_start)}`),
      bar("cons", cs, ce, `Construction: ${fd(r.construction_start)} → ${fd(r.construction_end)}`),
      bar("del", ce, eod, `Deliveries: ${fd(r.construction_end)} → ${fd(r.end_deliveries)}`),
      diamond("pspa", pspa, `PSPA: ${fd(r.pspa)}`),
      diamond("launch", launch, `Commercial launch: ${fd(r.launch)}`),
      eod ? `<span class="rm-end" style="left:${pos(eod)}%">${quarter(eod)}</span>` : "",
      `<span class="rm-now" style="left:${pos(today)}%"></span>`,
    ].join("");
    const label = r.project_id
      ? `<button type="button" class="rm-link" data-id="${r.project_id}">${esc(r.label)}</button>` : esc(r.label);
    return `<tr>${i === 0 ? `<th class="rm-area" rowspan="${g.rows.length}">${esc(g.name)}</th>` : ""}
      <td class="rm-name" title="${esc(r.area)} · ${esc(r.name)}">${label}</td>
      <td class="rm-track">${bars}</td></tr>`;
  }).join("")).join("");

  const todayLeft = pos(today);
  return `<section class="report portfolio roadmap">${head}${notes}
    <div class="rm-scroll"><table class="rm">
      <thead><tr><th class="rm-hcorner" colspan="2">Area &amp; Projects</th>
        <th class="rm-years"><div class="rm-yearrow">${years.map((y) => `<span>${y}</span>`).join("")}</div>
          <span class="rm-today-lbl" style="left:${todayLeft}%">Today</span></th></tr></thead>
      <tbody style="--years:${years.length}">${body}</tbody>
    </table></div>
    <div class="rm-legend">
      <span><i class="dev"></i>Development &amp; licensing</span><span><i class="pre"></i>Pre-sales</span>
      <span><i class="cons"></i>Construction</span><span><i class="del"></i>Deliveries</span>
      <span><b class="rm-dia pspa"></b>PSPA</span><span><b class="rm-dia launch"></b>Commercial launch</span>
      <span class="rm-endkey">Q3 2028 = end of deliveries</span>
    </div>
  </section>`;
}

// ---------- Resumo do projeto (overview) ----------
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/>',
  car: '<path d="M3 15l2-5.5A2 2 0 0 1 6.9 8h10.2a2 2 0 0 1 1.9 1.5L21 15"/><rect x="2.5" y="15" width="19" height="4" rx="1.5"/><circle cx="7" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/><path d="M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  curve: '<path d="M3 20h18"/><path d="M4 19c3 0 4-13 8-13s5 13 8 13"/><path d="M12 6v13" stroke-dasharray="2 2"/>',
  pct: '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M19 5L5 19"/>',
  margin: '<rect x="4" y="3" width="16" height="12" rx="1"/><path d="M8 11l3-3 2 2 3-3"/><path d="M12 15v4"/><path d="M8 21l4-2 4 2"/>',
};
const icon = (k) => `<svg class="ov-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

function lastValue(p, re) {
  const r = p.rows.find((x) => re.test(x.label));
  return r ? r.values[r.values.length - 1] : null;
}

function leveredPostTax(p) {
  // KPI "Levered post tax", última coluna: "47,8% / 4,4x | 8.2M€ / -2.4M€" -> IRR e Profit
  const k = p.kpis.find((x) => /levered\s+post\s+tax/i.test(x.label));
  if (!k) return {};
  const txt = (k.values[k.values.length - 1] || []).join(" | ");
  const irr = txt.match(/(-?[\d.,]+)\s*%/);
  const rest = txt.split("|").slice(1).join("|");
  const profit = rest.match(/(-?[\d.,]+)\s*(M|k)?\s*€/i);
  return { irr: irr ? `${irr[1]} %` : null, profit: profit ? `${profit[1].replace(".", ",")} ${(profit[2] || "").toUpperCase()}€` : null };
}

function overviewHtml(p) {
  const info = p.info || {};
  const [place, city] = (info.location || "").split("|").map((s) => s.trim());
  const meur =(k) => (typeof k === "number" ? `${(k / 1000).toFixed(1).replace(".", ",")} M€` : "—");
  // números com separador de milhares; texto (p.ex. "TBD", "3/4") tal como está no project_info.json
  const num = (v, unit) => (typeof v === "number" ? `${fmtNum(v)}${unit ? ` ${unit}` : ""}`
    : typeof v === "string" && v.trim() ? esc(v) : "—");
  const cost = lastValue(p, /^TOTAL COST/i);
  const rev = lastValue(p, /^TOTAL REVENUE/i);
  const lpt = leveredPostTax(p);
  const avg = typeof rev === "number" && typeof info.gpa === "number" && info.gpa > 0 ? (rev * 1000) / info.gpa : null;
  const lastCol = p.columns.length ? p.columns[p.columns.length - 1].lines.join(" ") : "";
  const fact = (ico, label, value, extra = "") => `<div class="ov-fact">${icon(ico)}<span class="ov-l">${label}</span>${extra}<span class="ov-v">${value}</span></div>`;
  const gpaTxt = (v, note) => (v === null || v === undefined ? "" : `GPA ${num(v, "sqm")}${note ? `*` : ""}`);
  const retailLabel = info.retail_label || "Retail";
  const tot = info.total;
  // Com "total" (p.ex. NOLA): duas colunas, VIZTA e TOTAL
  const twoCol = (ico, label, a, b) => `<div class="ov-fact ov-2">${icon(ico)}<span class="ov-l">${label}</span>
      <span class="ov-v">${a}</span><span class="ov-v ov-tot">${b}</span></div>`;
  const units = (n, gpa) => [num(n), gpa !== null && gpa !== undefined ? `<small>${num(gpa, "sqm")}*</small>` : ""].join("");
  const top = tot
    ? `<div class="ov-fact ov-2 ov-colhead"><span class="ov-l"></span><span class="ov-v">VIZTA</span><span class="ov-v ov-tot">TOTAL</span></div>
       ${twoCol("home", "Apartments", units(info.apartments, info.gpa), units(tot.apartments, tot.gpa))}
       ${twoCol("store", esc(retailLabel), units(info.retail, info.retail_gpa), units(tot.retail, tot.retail_gpa))}
       ${twoCol("car", "Parking Spaces", num(info.parking), num(tot.parking))}`
    : `${fact("home", `${num(info.apartments)} Apartments`, gpaTxt(info.gpa, info.gpa_note) || "GPA —")}
       ${fact("store", info.retail === null || info.retail === undefined ? esc(retailLabel) : `${num(info.retail)} ${esc(retailLabel)}`, gpaTxt(info.retail_gpa))}
       ${fact("car", `${num(info.parking)} Parking Spaces`, "")}`;
  const facts = `
    ${top}
    <hr>
    ${fact("coins", "Costs", meur(cost))}
    ${fact("chart", "Revenue", meur(rev))}
    ${fact("curve", "Avg. Residential Sales Price", avg ? `${fmtNum(avg)} €/sqm` : "—")}
    <hr>
    ${fact("pct", "IRR*", esc(lpt.irr || "—"))}
    ${fact("margin", "Margin*", esc(lpt.profit || "—"))}`;
  const gca = (label, area, floors, note) => `<div class="ov-gca"><div><span>${label}</span> <b>${num(area, "sqm")}</b>${note ? ` <span>(${esc(note)})</span>` : ""}</div>
      <div><b>${num(floors)}</b> <span>Floors</span></div></div>`;
  const gcas = tot
    ? gca("Total GCA Above G.", tot.gca_above, tot.floors_above) + gca("VIZTA GCA Above G.", info.gca_above, info.floors_above)
      + gca("Total GCA Below G.", tot.gca_below, tot.floors_below) + gca("VIZTA GCA Below G.", info.gca_below, info.floors_below)
    : gca("GCA Above G.", info.gca_above, info.floors_above) + gca("GCA Below G.", info.gca_below, info.floors_below, info.gca_below_note);
  const notes = [tot || info.gpa_note ? `*GPA${info.gpa_note ? ` ${esc(info.gpa_note)}` : ""}` : "", "*Levered post-tax (IRR, Margin)"].filter(Boolean).join(" · ");
  const media = info.image
    ? `<img src="/project-images/${encodeURIComponent(info.image)}" alt="${esc(p.label || p.name)}">`
    : `<div class="ov-noimg">${esc(p.label || p.name)}</div>`;
  return `<section class="overview">
    <div class="ov-head">
      <div>${p.menu_group ? `<div class="kicker">${esc(p.menu_group)}</div>` : ""}
        <h1>${esc(p.label || p.name)}${place ? ` <span class="ov-loc">| ${esc(place)}</span>` : ""}</h1>
        <div class="ov-seg">${[info.segment, city].filter(Boolean).map(esc).join(" · ")}</div></div>
      <div class="ov-status">${info.status ? `<span>Status:</span> ${esc(info.status)}${info.status_note ? ` <small>(${esc(info.status_note)})</small>` : ""}` : ""}
        ${info.commercial ? `<div class="ov-pill">${esc(info.commercial)}</div>` : ""}</div>
    </div>
    <div class="ov-body">
      <div class="ov-media">${media}
        <div class="ov-gcas">${gcas}</div>
      </div>
      <div class="ov-facts">${facts}</div>
    </div>
    <div class="ov-foot"><span>Costs, revenue, IRR and margin: ${esc(p.sheet)}${lastCol ? ` · ${esc(lastCol)}` : ""} · ${notes}</span>
      ${info.website ? `<a href="${esc(info.website)}" target="_blank" rel="noopener noreferrer">vizta.pt ↗</a>` : ""}</div>
  </section>`;
}

// Typology Report já no formato do Power BI (valores, totais, % e €/m² tal como lá aparecem)
function typologyDisplayHtml(s) {
  const T = s.typologies;
  const cell = (v, cls = "") => `<td class="${cls}">${v === null || v === undefined ? "" : fmtNum(v)}</td>`;
  const pct = (v) => `<td>${v === null || v === undefined ? "" : `${fmtNum(v)}%`}</td>`;
  const eur = (v, cls = "") => `<td class="${cls}">${v === null || v === undefined ? "" : fmtEur(v)}</td>`;
  const unitsRows = s.units_rows.map((r) => `<tr class="t-${r.kind}"><td class="lbl">${esc(r.label)}</td>
      ${T.map((t) => cell(r.units[t])).join("")}${cell(r.total, "sum")}${pct(r.pct)}${cell(r.retail)}${cell(r.resi_retail, "sum")}</tr>`).join("");
  const amountRows = s.amount_rows.map((r) => `<tr class="t-${r.kind}"><td class="lbl">${esc(r.label)}</td>
      ${eur(r.residential)}${eur(r.price_sqm)}${pct(r.pct)}${eur(r.retail)}${eur(r.resi_retail, "sum")}</tr>`).join("");
  return `<h2 class="sec">Typology</h2>
    <div class="t-scroll"><table class="typo">
      <thead><tr><th class="lbl">Units</th>${T.map((t) => `<th>${esc(t)}</th>`).join("")}<th># Total</th><th>%</th><th># Retail</th><th># Resi+Retail</th></tr></thead>
      <tbody>${unitsRows}</tbody></table></div>
    <div class="t-scroll"><table class="typo amounts">
      <thead><tr><th class="lbl">Amounts</th><th>€ Residential</th><th>€/sqm</th><th>%</th><th>€ Retail</th><th>€ Resi+Retail</th></tr></thead>
      <tbody>${amountRows}</tbody></table></div>`;
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
  const asOf = st.snapshot_as_of ? st.snapshot_as_of.replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1") : "";
  const when = p.sales_source === "snapshot" ? ` · as of ${esc(asOf)}` : st.updated ? ` · updated ${fmtTime(st.updated)}` : "";
  const head = simpleHead(p, "Sales", `Power BI · ${esc(p.sales_name)}${when}`);
  if (p.sales && p.sales_source === "snapshot") {
    // Valores transcritos do Power BI (sales_snapshot.json) até haver leitura automática
    return `<section class="report page-sales">${head}
      <div class="banner snap">Position as of <b>${esc(asOf)}</b>, taken from the Power BI report <b>vizta - sales dashboards</b>.
        It will update automatically once IT grants access to Power BI.</div>
      ${typologyHtml(p.sales)}</section>`;
  }
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
  if (s.units_rows) return typologyDisplayHtml(s);
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

// ---------- Escolha das versões do budget no quadro (coluna de comparação e de referência) ----------
const verKey = (p) => "ver." + p.name;
function versionSel(p) {
  const d = p.version_default || [];
  const ok = (k) => (p.versions || []).some((v) => v.col === k);
  const s = loadPref(verKey(p), null);
  return [s && ok(s[0]) ? s[0] : d[1], s && ok(s[1]) ? s[1] : d[2]];
}
const canChooseVersions = (p) => (p.versions || []).length && p.columns.length === 3
  && (p.version_default || [])[1] != null && p.version_default[2] != null;

// Projeto com as colunas 2 e 3 trocadas pelas versões escolhidas (Δ = referência − comparação)
function withVersions(p, sel = versionSel(p)) {
  const d = p.version_default || [];
  if (!canChooseVersions(p) || (sel[0] === d[1] && sel[1] === d[2])) return { view: p, changed: false };
  const slots = [d[0], sel[0], sel[1]];
  const ver = (k) => p.versions.find((v) => v.col === k) || { lines: ["—"] };
  const pick = (r, s) => (s === 0 || slots[s] === d[s] ? r.values[s] : r.bvalues ? r.bvalues[slots[s]] ?? null : null);
  const num = (v) => typeof v === "number";
  const mk = (r) => {
    const values = [pick(r, 0), pick(r, 1), pick(r, 2)];
    return { ...r, values, delta: num(values[1]) && num(values[2]) ? values[2] - values[1] : null };
  };
  const kpiCol = (k, s) => (slots[s] === d[s] ? k.values[s] : ((p.bkpis || {})[k.label] || [])[slots[s]] || []);
  return {
    changed: true,
    view: {
      ...p,
      columns: [p.columns[0], ...[1, 2].map((s) => ({ lines: slots[s] === d[s] ? p.columns[s].lines : ver(slots[s]).lines }))],
      rows: p.rows.map((r) => ({ ...mk(r), children: r.children ? r.children.map(mk) : undefined })),
      kpis: p.kpis.map((k) => ({ ...k, values: [k.values[0], kpiCol(k, 1), kpiCol(k, 2)] })),
      notes: [],  // as notas (Margin w/out internal fees, ...) só existem para a versão do quadro
    },
  };
}

function versionToolsHtml(p, changed) {
  if (!canChooseVersions(p)) return "";
  const sel = versionSel(p);
  const opts = (cur) => p.versions.map((v) => `<option value="${v.col}" ${v.col === cur ? "selected" : ""}>${esc(v.label)}${
    v.letter ? ` · col ${v.letter}` : ""}${v.hidden ? " (hidden in Excel)" : ""}</option>`).join("");
  return `<div class="ver-tools no-print">
    <label>Compare <select data-ver="0">${opts(sel[0])}</select></label>
    <span class="ver-arrow">→</span>
    <label>Reference <select data-ver="1">${opts(sel[1])}</select></label>
    ${changed ? `<button type="button" data-ver-reset>Reset to Project Review</button>` : ""}
    <span class="b-src">Δ = Reference − Compare${changed ? " · values from " + esc(p.budget_link.sheet) : ""}</span>
  </div>`;
}

function reportHtml(orig) {
  const { view: p, changed } = withVersions(orig);
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
          .map((lines) => `<td>${lines.length ? lines.map(esc).join("<br>") : "—"}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>` : "";
  const after = bottomNotes.length ? `<div class="notes"><span></span><span>${bottomNotes.map(notePill).join("")}</span></div>` : "";

  return `<section class="report">
    ${headHtml(p, p.sheet)}
    ${versionToolsHtml(orig, changed)}
    ${tools}
    <table class="pr"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${notes}${kpis}${after}
  </section>`;
}

function financingHtml(f) {
  const term = (months, end) => (months ? `${months} months${end ? ` · until ${fmtDate(end)}` : ""}` : "");
  const rate = f.index || f.spread !== undefined
    ? [esc(f.index || ""), f.spread !== undefined ? fmtRate(f.spread) : ""].filter(Boolean).join(" + ") : "";
  const sub = (t) => (t ? `<div class="sub">${esc(t)}</div>` : "");
  const items = [
    ["Bank", esc(f.bank)],
    ["Borrower", esc(f.borrower)],
    ["Signed", f.signed ? fmtDate(f.signed) : ""],
    ["Maturity", f.maturity ? fmtDate(f.maturity) : ""],
    ["Amount", f.amount !== undefined ? `<b>${fmtEur(f.amount)}</b>${sub(f.amount_note)}` : ""],
    ["Term", term(f.term_months, f.maturity) + (f.term_months && f.term_note ? sub(f.term_note) : "")],
    ["Availability period", term(f.availability_months, f.availability_end)],
    ["Interest rate", rate ? `<b>${rate}</b>` : ""],
    ["Purpose", esc(f.purpose)],
    ["Own funds required", f.own_funds !== undefined ? `${fmtEur(f.own_funds)}${sub(f.own_funds_note)}` : ""],
    ["LTV", esc(f.ltv)],
    ["Fees", esc(f.fees)],
  ].filter(([, v]) => v);
  const list = (title, arr) => ((arr || []).length
    ? `<div class="fin-list"><h3>${title}</h3><ul>${arr.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : "");
  const d = f.distributions;
  const dist = d ? `<div class="fin-dist">
      <h3>Distributions to promoter${typeof d.max === "number" ? ` · up to ${fmtEur(d.max)}` : ""}</h3>
      ${(d.conditions || []).length ? `<ul>${d.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${d.note ? `<p class="sub">${esc(d.note)}</p>` : ""}
    </div>` : "";
  // Estado: contratos assinados não têm "status"; negociações mostram a fase e a fonte
  const negotiating = f.status && !/signed/i.test(f.status);
  const status = f.status || (f.signed ? "Signed" : "");
  const statusBox = status ? `<div class="fin-status ${negotiating ? "neg" : "signed"}">
      <span class="fin-pill">${esc(status)}</span>${f.stage ? `<span>${esc(f.stage)}</span>` : ""}
      ${f.source ? `<div class="sub">Source: ${esc(f.source)}</div>` : ""}</div>` : "";
  return `<div class="financing">
    <h2>Financing${f.facility ? ` <span>${esc(f.facility)}</span>` : ""}</h2>
    ${statusBox}
    ${items.length ? `<dl class="fin-grid">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    ${list("Tranches", f.tranches)}
    ${list("Key conditions", f.conditions)}
    ${dist}
    ${(f.offers || []).length ? offersHtml(f.offers) : ""}
  </div>`;
}

// Comparação de propostas em negociação (uma coluna por banco)
function offersHtml(offers) {
  const rows = [
    ["Structure", (o) => esc(o.structure)],
    ["Facility amount", (o) => (typeof o.amount === "number" ? `<b>${fmtEur(o.amount)}</b>` : "")
      + (o.amount_detail ? `<div class="sub">${esc(o.amount_detail)}</div>` : "")],
    ["Tenor", (o) => esc(o.tenor)],
    ["Pricing", (o) => `<b>${esc(o.pricing)}</b>`],
    ["Fees", (o) => esc(o.fees)],
    ["Security", (o) => esc(o.security)],
    ["Key conditions for 1st disbursements", (o) => esc(o.conditions)],
    ["Equity recap conditions", (o) => esc(o.equity_recap)],
    ["Status", (o) => esc(o.status)],
  ].filter(([, fn]) => offers.some((o) => fn(o).replace(/<[^>]+>/g, "").trim()));
  return `<div class="fin-offers"><h3>Offers under negotiation</h3><div class="t-scroll"><table class="offers">
    <thead><tr><th></th>${offers.map((o) => `<th>${esc(o.bank)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><td class="lbl">${label}</td>${offers.map((o) => `<td>${fn(o)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div></div>`;
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
  // Projeto: abre o dropdown das páginas e mostra o resumo do projeto
  select(b.dataset.id, "overview");
});

$("#main").addEventListener("click", (e) => {
  if (e.target.closest("[data-ver-reset]")) {
    const p = allProjects().find((x) => x.id === selectedId);
    if (p) {
      try { localStorage.removeItem("bd." + verKey(p)); } catch (err) { /* sem storage */ }
      renderMain();
    }
    return;
  }
  const link = e.target.closest(".rm-link[data-id]");
  if (link) {
    select(link.dataset.id, "overview");
    return;
  }
  const ex = e.target.closest("[data-expand]");
  if (ex) {
    document.querySelectorAll("#main tr.rubric").forEach((tr) => toggleRubric(tr, ex.dataset.expand === "all"));
    return;
  }
  const tr = e.target.closest("tr.rubric");
  if (tr) toggleRubric(tr);
});

$("#main").addEventListener("change", (e) => {
  const s = e.target.closest("select[data-ver]");
  if (!s) return;
  const p = allProjects().find((x) => x.id === selectedId);
  if (!p) return;
  const sel = versionSel(p);
  sel[+s.dataset.ver] = +s.value;
  savePref(verKey(p), sel);
  renderMain();
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
    // versões escolhidas em cada projeto (só as diferentes do quadro de Project Review)
    const one = xlsx.dataset.xlsx === "one" && selectedId && selectedId !== PORTFOLIO;
    const vers = {};
    for (const p of allProjects()) {
      if (one && p.id !== selectedId) continue;
      if (withVersions(p).changed) vers[p.id] = versionSel(p);
    }
    const qs = [one ? `id=${encodeURIComponent(selectedId)}` : "",
      Object.keys(vers).length ? `versions=${encodeURIComponent(JSON.stringify(vers))}` : ""].filter(Boolean).join("&");
    location.href = "/api/export.xlsx" + (qs ? `?${qs}` : "");
  }
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("print-all");
  $("#print-area").innerHTML = "";
});

load().catch(() => setStatus(false));
setInterval(poll, POLL_MS);
