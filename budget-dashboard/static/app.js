"use strict";

const POLL_MS = 5000;
let data = null;
let version = null;
// Seleção: "#<projeto>/<página>" (páginas: overview — o resumo, ao clicar no projeto — | kpis | financing | sales)
let [selectedId, page] = (() => {
  const [id, pg] = decodeURIComponent(location.hash.slice(1)).split("/");
  return [id || null, pg || "overview"];
})();
const PAGES = [["kpis", "Project KPIs"], ["financing", "Financing"], ["sales", "Sales"], ["legal", "Legal Information"],
  ["status", "Ponto de Situação"]];
const pagesOf = (p) => PAGES.filter(([k]) => k === "kpis" || (k === "financing" && p.financing) || (k === "sales" && p.sales_name)
  || (k === "legal" && p.legal) || (k === "status" && p.status_items));
const PORTFOLIO = "portfolio";
const PORTFOLIO_PAGES = [["summary", "Summary of all projects"], ["roadmap", "Roadmap"], ["financing", "Projects financing overview"]];
const REPORTS = "reports";        // "Reports Diogo"
const REPORTS_PAGES = [["sales", "Sales Report"], ["cashflow", "Cashflow Vizta REM"]];
const ORION = "orion";            // apresentação "Project Review - Orion" (slides em carrossel)
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
  } else if (selectedId === REPORTS) {
    if (!REPORTS_PAGES.some(([k]) => k === page)) page = REPORTS_PAGES[0][0];
  } else if (selectedId === ORION) {
    if (!orionSlides().some((sl) => sl.key === page)) page = "cover";
  } else if (!ids.includes(selectedId)) selectedId = ids[0] || null;
  render();
}

async function poll() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    const v = (await res.json()).version;
    if (v !== version) {
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-note]")) {
        reloadAfterEdit = true;
        setStatus(true);
        return;
      }
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
  // "Project Review - Orion": lista de slides (só aberta quando a apresentação está selecionada)
  const inOr = selectedId === ORION;
  const slides = inOr ? orionSlides() : [{ key: "cover", title: "Presentation" }];
  const orion = `<div class="side-title side-sep">Project Review - Orion</div>
    <div class="pitem open">${slides.map((sl, i) =>
      `<button type="button" class="ppage pf ${inOr && sl.key === page ? "active" : ""}" data-id="${ORION}" data-page="${sl.key}">${inOr ? `<span class="sl-n">${i + 1}</span>` : ""}${esc(sl.title)}</button>`).join("")}</div>`;
  // "Reports Diogo": relatórios transversais (vendas, cashflow)
  const inRp = selectedId === REPORTS;
  const reports = `<div class="side-title side-sep">Reports Diogo</div>
    <div class="pitem open">${REPORTS_PAGES.map(([k, label]) =>
      `<button type="button" class="ppage pf ${inRp && k === page ? "active" : ""}" data-id="${REPORTS}" data-page="${k}">${label}</button>`).join("")}</div>`;
  $("#sidebar").innerHTML = portfolio + orion + reports + `<div class="side-title side-sep">Projects</div>` + (html || `<div class="proj">No projects</div>`);
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
  if (selectedId === ORION) {
    $("#main").innerHTML = banners() + orionHtml();
    fitSlides();
    applyPresence();
    return;
  }
  if (selectedId === PORTFOLIO) {
    $("#main").innerHTML = banners() + portfolioHtml(page);
    return;
  }
  if (selectedId === REPORTS) {
    $("#main").innerHTML = banners() + (page === "cashflow" ? cashflowReportHtml() : salesReportHtml());
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
  const body = page === "financing" ? financingPageHtml(p) : page === "sales" ? salesPageHtml(p) : page === "legal" ? legalPageHtml(p) : page === "status" ? statusPageHtml(p)
    : page === "kpis" ? reportHtml(p) : overviewHtml(p);
  $("#main").innerHTML = banners() + extra + body;
}

function select(id, pg) {
  selectedId = id;
  page = pg || "overview";
  history.replaceState(null, "", "#" + encodeURIComponent(selectedId) + "/" + page);
  render();
}

// ---------- Project Review - Orion (apresentação) ----------
// Todos os slides têm o mesmo tamanho: uma tela de 1600×900 (16:9) escalada para caber no ecrã.
// O conteúdo que não cabe na tela é reduzido (fitSlides), nunca cortado.
const SLIDE_W = 1600;

// Ordem dos slides: a do PPT do Project Review. Os projetos e os slides de cada um vêm do
// config.json ("orion"); o que o dashboard não tem fica como placeholder ("To be provided").
const SLIDE_KINDS = {
  overview: "Overview", commercial: "Commercial status", timeline: "Timeline & key points",
  variations: "Project Review", cost_per_item: "Effective cost per item", contract: "Construction contract", fees: "VIZTA fees",
};

function reviewQuarter(d = new Date()) {
  // trimestre fechado mais recente: em outubro de 2026 -> Q3.2026
  const q = Math.floor(d.getMonth() / 3);
  return q === 0 ? `Q4.${d.getFullYear() - 1}` : `Q${q}.${d.getFullYear()}`;
}

function orionSlides() {
  if (!data) return [];
  const pf = (k) => PORTFOLIO_PAGES.find(([x]) => x === k)[1];
  const byId = Object.fromEntries(allProjects().map((p) => [p.id, p]));
  const S = (key, title, html, bleed) => ({ key, title, html, bleed });  // bleed: fundo a toda a tela
  const ph = (title, sub, boxes) => () => placeholderHtml(title, sub, boxes);
  const out = [
    S("cover", "Cover", orionCoverHtml),
    S("agenda", "Agenda", orionAgendaHtml, true),
    S("s-roadmap", "01 · Road Map", () => dividerHtml("01", "Road Map"), true),
    S("roadmap", pf("roadmap"), () => roadmapHtml(pf("roadmap"), true)),
    S("summary", pf("summary"), () => summaryHtml(pf("summary"))),
    S("summary-phases", `${pf("summary")} · phases & regions`, () => summaryChartsHtml(pf("summary"))),
    S("financing", "Projects financing overview", ph("Projects financing overview", "Local banking financing conditions & outstanding amounts",
      ["Financing conditions & outstanding amounts per quarter"])),
    S("launch-1", "Sales Launch (1/2)", ph("Sales Launch", "", ["Sales launch calendar"])),
    S("launch-2", "Sales Launch (2/2)", ph("Sales Launch", "", ["Sales launch calendar"])),
    S("s-market", "02 · Market Information", () => dividerHtml("02", "Market Information"), true),
    S("market-1", "Market Information (1/2)", ph("Market Information", "",
      ["Portugal housing sales – volume (€m)", "Portugal housing sales – nb of transactions ('000)", "Commentary & sources"])),
    S("market-2", "Market Information (2/2)", ph("Market Information", "Lisbon and Porto: price trends and supply constraints",
      ["Lisbon prices – sales new apt. (€/sqm)", "Porto prices – sales new apt. (€/sqm)", "Commentary & sources"])),
  ];
  for (const e of (data.orion || {}).projects || []) {
    const p = e.id ? byId[e.id] : null;
    const name = p ? p.label || p.name : (e.info && e.info.summary_name) || e.project;
    const base = e.id || "x-" + e.project.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const k of e.slides) {
      out.push(S(`${base}-${k}`, `${name} · ${SLIDE_KINDS[k] || k}`, () => projectSlideHtml(k, p, e, name)));
    }
  }
  out.push(S("end", "Thank you", orionEndHtml, true));
  return out;
}

const slideLogo = () => ($(".topbar .logo") || {}).outerHTML || "";

function orionCoverHtml() {
  const d = new Date();
  return `<div class="sl-cover"><div class="sl-cover-logo">${slideLogo()}</div>
    <h1>Project Review <span>${reviewQuarter(d)}</span></h1>
    <div class="sl-cover-date">${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}</div></div>`;
}

function orionAgendaHtml() {
  const slides = orionSlides();
  const at = (pred) => Math.max(0, slides.findIndex(pred));
  const firstProject = at((sl, i) => i > slides.findIndex((x) => x.key === "s-market") && /-overview$/.test(sl.key));
  const items = [["01", "Road Map", at((sl) => sl.key === "s-roadmap")],
    ["02", "Market information", at((sl) => sl.key === "s-market")], ["03", "Projects", firstProject]];
  return `<div class="sl sl-agenda"><div class="sl-head"><h1>Agenda</h1></div>
    <div class="sl-agenda-items">${items.map(([n, t, i]) =>
      `<button type="button" class="sl-agenda-item" data-slide="${i}"><span class="sl-big">${n} <i>↗</i></span><span>${t}</span></button>`).join("")}</div></div>`;
}

function dividerHtml(n, title) {
  return `<div class="sl sl-divider"><div class="sl-big">${n}</div><h1>${esc(title)}</h1></div>`;
}

function orionEndHtml() {
  return `<div class="sl sl-end"><h1>Thank you.</h1><div class="sl-cover-logo">${slideLogo()}</div></div>`;
}

function placeholderHtml(title, sub, boxes) {
  return `<div class="sl"><div class="sl-head"><h1>${esc(title)}</h1>${sub ? `<div class="sl-sub">${esc(sub)}</div>` : ""}</div>
    <div class="sl-ph-grid n${boxes.length}">${boxes.map((b) => (typeof b === "string" ? phBox(b) : b.html)).join("")}</div></div>`;
}

// ---------- textos editáveis da apresentação (guardados no servidor; vence o último a guardar) ----------
const noteSlug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function noteMeta(n) {
  return n && n.updated ? `Saved ${fmtTime(n.updated)}` : "";
}

function noteBox(key, title) {
  const n = (data.orion_notes || {})[key];
  return `<div class="sl-box sl-note"><h3>${esc(title)}</h3>
    <div class="sl-note-text" contenteditable="plaintext-only" spellcheck="false" data-note="${esc(key)}"
      data-placeholder="Click to write…">${esc(n ? n.text : "")}</div>
    <div class="sl-note-presence" data-note-presence="${esc(key)}" hidden></div>
    <div class="sl-note-meta" data-note-meta="${esc(key)}">${noteMeta(n)}</div></div>`;
}

// ---------- "X está a escrever…": sinais ao servidor enquanto a caixa está aberta ----------
const PRESENCE_BEAT_MS = 4000, PRESENCE_POLL_MS = 2000;
const clientId = (() => {  // um id por separador do browser
  try {
    let id = sessionStorage.getItem("bd.clientId");
    if (!id) sessionStorage.setItem("bd.clientId", (id = "c" + Math.random().toString(36).slice(2) + Date.now().toString(36)));
    return id;
  } catch (e) { return "c" + Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();
let presenceMap = {};      // {chave: [nomes de quem está a escrever]} (sem o próprio separador)
let presenceBeat = null;   // temporizador dos sinais enquanto se escreve
let presenceKey = null;

function userName() {
  // no servidor com login Windows o nome pode vir daí; até lá pede-se uma vez e fica no browser
  let n = loadPref("userName", "");
  if (!n) {
    n = (window.prompt("O teu nome, para os colegas verem quando estás a escrever:") || "").trim().slice(0, 60);
    if (n) savePref("userName", n);
  }
  return n || "Alguém";
}

function sendPresence(key, editing) {
  const body = JSON.stringify({ client: clientId, key, name: loadPref("userName", "") || "Alguém", editing });
  if (!editing && navigator.sendBeacon) {  // funciona também ao fechar a página
    navigator.sendBeacon("/api/orion-presence", new Blob([body], { type: "application/json" }));
    return;
  }
  fetch("/api/orion-presence", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
}

function startEditing(el) {
  const key = el.dataset.note;
  if (presenceKey === key) return;
  if (!loadPref("userName", "")) {
    userName();  // a janela do nome tira o cursor da caixa: volta a pô-lo lá
    setTimeout(() => el.focus(), 0);
  }
  presenceKey = key;
  sendPresence(key, true);
  clearInterval(presenceBeat);
  presenceBeat = setInterval(() => sendPresence(key, true), PRESENCE_BEAT_MS);
}

function stopEditing() {
  if (!presenceKey) return;
  clearInterval(presenceBeat);
  sendPresence(presenceKey, false);
  presenceKey = null;
}

function applyPresence() {
  document.querySelectorAll("[data-note-presence]").forEach((el) => {
    const names = presenceMap[el.dataset.notePresence] || [];
    el.hidden = !names.length;
    el.innerHTML = names.length ? `<i></i>${esc(names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " e " + names[names.length - 1])}
      ${names.length === 1 ? "está" : "estão"} a escrever…` : "";
    const box = el.closest(".sl-note");
    if (box) box.classList.toggle("busy", names.length > 0);
  });
}

async function pollPresence() {
  if (selectedId !== ORION || document.hidden) return;
  try {
    const res = await fetch(`/api/orion-presence?client=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    presenceMap = await res.json();
    applyPresence();
  } catch (e) { /* servidor em baixo: o estado geral já mostra o aviso */ }
}
setInterval(pollPresence, PRESENCE_POLL_MS);
document.addEventListener("focusin", (e) => {
  const el = e.target.closest && e.target.closest("[data-note]");
  if (el) startEditing(el);
});
window.addEventListener("pagehide", stopEditing);

const noteTimers = {};
let reloadAfterEdit = false;  // chegaram dados novos enquanto se escrevia: atualiza ao sair da caixa

async function saveNote(el) {
  const key = el.dataset.note;
  clearTimeout(noteTimers[key]);
  const text = el.innerText.replace(/\n$/, "");
  const cur = (data.orion_notes || {})[key];
  if (cur ? cur.text === text : !text) return;  // nada mudou
  document.querySelectorAll(`[data-note-meta="${CSS.escape(key)}"]`).forEach((m) => (m.textContent = "Saving…"));
  try {
    const res = await fetch("/api/orion-notes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const n = await res.json();
    (data.orion_notes = data.orion_notes || {})[key] = { text: n.text, updated: n.updated };
    version = n.version;  // a própria gravação não obriga a recarregar a página
    document.querySelectorAll(`[data-note-meta="${CSS.escape(key)}"]`).forEach((m) => (m.textContent = noteMeta(n)));
  } catch (err) {
    document.querySelectorAll(`[data-note-meta="${CSS.escape(key)}"]`).forEach((m) => (m.textContent = "Not saved — server not reachable"));
  }
}

document.addEventListener("input", (e) => {
  const el = e.target.closest && e.target.closest("[data-note]");
  if (!el) return;
  startEditing(el);  // também ao escrever (se o clique não tiver dado o sinal)
  clearTimeout(noteTimers[el.dataset.note]);
  noteTimers[el.dataset.note] = setTimeout(() => saveNote(el), 800);
});
document.addEventListener("focusout", (e) => {
  const el = e.target.closest && e.target.closest("[data-note]");
  if (!el) return;
  stopEditing();
  saveNote(el).then(() => {
    if (reloadAfterEdit && !document.activeElement.closest("[data-note]")) {
      reloadAfterEdit = false;
      load();
    }
  });
});

const phBox = (label, cls = "") => `<div class="sl-ph ${cls}"><span>${esc(label)}</span><small>To be provided</small></div>`;

function projectSlideHtml(k, p, e, name) {
  // texto editável "Key Variations": chave estável (nome do projeto + slide), igual no PC e no servidor
  const kv = { html: noteBox(`${noteSlug(e.project)}.${k}.key_variations`, "Key Variations") };
  const sub = (kind) => (e.subtitles || {})[kind] || "";  // subtítulos do config.json (p.ex. vistas do NOLA)
  const ph = (boxes) => placeholderHtml(name, sub(k), boxes);
  if (k === "overview") {
    return overviewHtml(p || { name, label: name, info: e.info || {}, rows: [], kpis: [], columns: [], sheet: "" });
  }
  if (k === "commercial") return ph(["Typology report – units & amounts", "Commercial Project Status", "Buyer Profile", "PSPA / Reservation evolution"]);
  if (k === "timeline") return ph(["Project timeline", "Key points for discussion – Planning"]);
  if (k === "variations") {
    return p ? prSlideHtml(p, name, p, sub(k), kv.html) : ph(["Project Review table", kv, "Financing", "Opportunities / Risks", "Sources & Uses"]);
  }
  if (k === "cost_per_item") {
    // segundo quadro da folha do Project Review (p.ex. NOLA: "effective cost per item view")
    const v = p && (p.views || [])[0];
    return v ? prSlideHtml(p, name, v, sub(k), kv.html) : ph(["Effective cost per item view", kv, "Financing", "Opportunities / Risks"]);
  }
  if (k === "contract") return ph(["Construction contract – milestones & delivery dates"]);
  if (k === "fees") return ph(["VIZTA fees – milestones, amounts & status"]);
  return ph([k]);
}

// Quadro do Project Review (colunas do Excel) + €/sqm da mesma folha + caixas de comentário
function prSlideHtml(p, name, t = p, sub = "", keyVariations = phBox("Key Variations")) {
  // t: quadro a mostrar (o principal ou outro da mesma folha, em p.views)
  const n = t.columns.length;
  // colunas de €/sqm sem nenhum valor diferente de zero (p.ex. "Park (Mandatory)") ficam de fora
  const sq = (t.sqm_columns || []).map((c, i) => ({ ...c, i }))
    .filter((c) => t.rows.some((r) => r.sqm && typeof r.sqm[c.i] === "number" && Math.round(r.sqm[c.i] * 100) !== 0));
  const sqv = (r, c) => {
    const v = r.sqm ? r.sqm[c.i] : null;
    if (typeof v !== "number") return typeof v === "string" && !v.startsWith("#") ? esc(v) : "";
    return r.percent ? fmtPct(v) : `${fmtNum(v)} €/sqm`;
  };
  const head = `<tr><th class="lbl">${esc(p.name)}</th>${t.columns.map((c, i) =>
    `<th class="${i === n - 1 ? "latest" : ""}">${c.lines.map(esc).join("<br>")}</th>`).join("")}<th class="delta">Δ</th>
    ${sq.length ? `<th class="gap"></th>${sq.map((c) => `<th class="sq">${esc(c.label)}<small>${typeof c.area === "number" ? `${fmtNum(c.area)} sqm` : ""}</small></th>`).join("")}` : ""}</tr>`;
  let prev = null;
  const body = t.rows.map((r) => {
    const cls = [r.kind === "line" ? "" : r.kind, r.kind !== "line" && prev === "line" ? "first-total" : ""].join(" ").trim();
    prev = r.kind;
    return `<tr class="${cls}"><td class="lbl">${esc(r.label)}</td>${r.values.map((v, i) =>
      `<td class="${i === n - 1 ? "latest" : ""}">${fmt(v, r.percent)}</td>`).join("")}<td class="delta">${fmt(r.delta, r.percent)}</td>
      ${sq.length ? `<td class="gap"></td>${sq.map((c) => `<td class="sq">${sqv(r, c)}</td>`).join("")}` : ""}</tr>`;
  }).join("");
  // KPIs Orion no mesmo quadro, cada valor por baixo da coluna a que pertence
  const tail = `<td class="delta"></td>${sq.length ? `<td class="gap"></td>${"<td></td>".repeat(sq.length)}` : ""}`;
  const kpis = t.kpis.length ? `<tbody class="sl-kpis"><tr class="sl-kpi-h"><td class="lbl" colspan="${n + 2 + (sq.length ? sq.length + 1 : 0)}">${esc(t.kpi_title || "KPIs")}</td></tr>
    ${t.kpis.map((k) => `<tr><td class="lbl">${esc(k.label)}</td>${t.columns.map((c, i) => {
      const l = k.values[i] || [];
      return `<td class="${i === n - 1 ? "latest" : ""}">${l.length ? l.map(esc).join("<br>") : "—"}</td>`;
    }).join("")}${tail}</tr>`).join("")}</tbody>` : "";
  return `<div class="sl sl-pr"><div class="sl-head"><h1>${esc(name)}${sub ? ` <small>${esc(sub)}</small>` : ""}</h1></div>
    <div class="sl-pr-body">
      <div class="sl-pr-main"><table class="sl-prt"><thead>${head}</thead><tbody>${body}</tbody>${kpis}</table>
        <div class="sl-src">Source: ${esc(p.file || "")} › ${esc(p.sheet)}${t.footnote ? ` · ${esc(t.footnote)}` : ""}</div></div>
      <div class="sl-pr-side">${keyVariations}${slideFinancingHtml(p.financing)}${phBox("Opportunities / Risks")}${phBox("Sources & Uses", "small")}</div>
    </div></div>`;
}

// Financiamento do financing.json, em resumo (estado, banco, montante, taxa, prazo)
function slideFinancingHtml(f) {
  if (!f) return phBox("Financing");
  const rate = [f.index, f.spread !== undefined ? fmtRate(f.spread) : ""].filter(Boolean).map(esc).join(" + ");
  const items = [
    ["Status", esc(f.status || (f.signed ? `Signed ${fmtDate(f.signed)}` : "")) + (f.stage ? ` · ${esc(f.stage)}` : "")],
    ["Bank", esc(f.bank)],
    ["Amount", f.amount !== undefined ? fmtEur(f.amount) : ""],
    ["Interest rate", rate],
    ["Maturity", f.maturity ? fmtDate(f.maturity) : ""],
  ].filter(([, v]) => v);
  return `<div class="sl-box"><h3>Financing</h3><dl>${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
}

// Slide 6: peso de cada fase nos KPIs do Summary e distribuição Lisbon / Porto
function summaryChartsHtml(title) {
  const rows = summaryRows();
  const metrics = [["apartments", "Apartments (#)"], ["gca", "GCA", "ab. ground sqm"], ["cost", "Project Total Cost", "M€"],
    ["revenue", "Revenue", "M€"], ["margin", "Margin", "Orion (M€)*"]];
  const val = (r, k) => (typeof r[k] === "number" ? r[k] : 0);
  const pct = (x, t) => (t ? Math.round((x / t) * 100) : 0);
  const bars = metrics.map(([k, label, unit]) => {
    const tot = rows.reduce((a, r) => a + val(r, k), 0);
    const segs = PHASES.map(([ph, cls]) => [cls, rows.filter((r) => r.phase === ph).reduce((a, r) => a + val(r, k), 0)])
      .filter(([, v]) => v > 0);
    return `<div class="sc-col"><div class="sc-h">${label}${unit ? `<small>${unit}</small>` : ""}</div>
      <div class="sc-bar">${segs.map(([cls, v]) => `<div class="sm-${cls}" style="flex:${v}"><span>${pct(v, tot)}%</span></div>`).join("")}</div></div>`;
  }).join("");
  const region = (r) => (/lisbo/i.test(r.region || "") ? "Lisbon" : /porto/i.test(r.region || "") ? "Porto" : null);
  const pie = (phases, k, label) => {
    const rs = rows.filter((r) => phases.includes(r.phase));
    const lis = rs.filter((r) => region(r) === "Lisbon").reduce((a, r) => a + val(r, k), 0);
    const por = rs.filter((r) => region(r) === "Porto").reduce((a, r) => a + val(r, k), 0);
    const t = lis + por;
    const a = t ? (lis / t) * 360 : 0;
    return `<div class="sc-pie"><div class="sc-pie-h">${label}</div>
      <div class="sc-disc" style="background:conic-gradient(var(--lis) 0 ${a}deg, var(--por) ${a}deg 360deg)">
        <span class="l" style="--a:${a / 2}deg">${pct(lis, t)}%</span><span class="p" style="--a:${a + (360 - a) / 2}deg">${pct(por, t)}%</span></div></div>`;
  };
  const pies = (phases, note) => `<div class="sc-pies">${pie(phases, "margin", "Margin (€)")}${pie(phases, "apartments", "# Units")}</div>
    <div class="sc-note">Phases considered: ${note}</div>`;
  const legend = `<div class="sc-leg"><span><i style="background:var(--lis)"></i>Lisbon</span><span><i style="background:var(--por)"></i>Porto</span></div>`;
  const names = PHASES.map(([ph, cls], i) => {
    const rs = rows.filter((r) => r.phase === ph);
    return rs.length ? `<div class="sc-ph sm-${cls}" style="flex:${rs.length + 1}"><b>${i + 1}</b><span>${ph}</span><ul>${rs.map((r) => `<li>${esc(r.name)}</li>`).join("")}</ul></div>` : "";
  }).join("");
  return `<div class="sl sl-sc"><div class="sl-head"><h1>${esc(title)}</h1></div>
    <div class="sc-body">
      <div class="sc-phases">${names}</div>
      <div class="sc-bars-wrap"><div class="sc-bars">${bars}</div><div class="sc-cap">Weight of the projects from each phase on the above KPIs</div></div>
      <div class="sc-regions"><h3>Distribution by region</h3>${legend}${pies(["Delivered", "Construction", "Pre-sales"], "1 Delivered; 2 Construction; 3 Pre-sales")}
        ${pies(["Pipeline"], "4 Pipeline")}</div>
    </div>
    <div class="sl-src">Same data as the Summary of all projects (projects without a value are not counted) · Region from the project location · *Orion view, levered post-tax</div></div>`;
}

function orionHtml() {
  const slides = orionSlides();
  const i = Math.max(0, slides.findIndex((sl) => sl.key === page));
  const n = slides.length;
  return `<section class="deck" id="deck" style="--i:${i}">
    <div class="deck-bar no-print">
      <div><div class="kicker">Project Review - Orion</div><h1>${esc(slides[i].title)}</h1></div>
      <div class="deck-ctl">
        <button type="button" data-slide="prev" ${i === 0 ? "disabled" : ""} aria-label="Previous slide">‹</button>
        <span class="deck-count">${i + 1} / ${n}</span>
        <button type="button" data-slide="next" ${i === n - 1 ? "disabled" : ""} aria-label="Next slide">›</button>
        <button type="button" class="deck-full" data-slide="full" title="Full screen (F)">Present</button>
      </div>
    </div>
    <div class="deck-stage">
      <button type="button" class="deck-arrow l no-print" data-slide="prev" ${i === 0 ? "disabled" : ""} aria-label="Previous slide">‹</button>
      <div class="deck-view"><div class="deck-track">${slides.map((sl, k) => slideHtml(sl, k)).join("")}</div></div>
      <button type="button" class="deck-arrow r no-print" data-slide="next" ${i === n - 1 ? "disabled" : ""} aria-label="Next slide">›</button>
    </div>
    <div class="deck-dots no-print">${slides.map((sl, k) =>
      `<button type="button" class="${k === i ? "on" : ""}" data-slide="${k}" title="${esc(sl.title)}" aria-label="${esc(sl.title)}"></button>`).join("")}</div>
  </section>`;
}

function slideHtml(sl, k) {
  return `<div class="slide" data-k="${k}"><div class="slide-canvas ${sl.bleed ? "bleed" : ""}">
    <div class="slide-body"><div class="slide-fit">${sl.html()}</div></div>
    <div class="slide-foot"><span>${k + 1}</span>${slideLogo()}</div>
  </div></div>`;
}

// Escala as telas para a largura disponível e reduz o conteúdo que não cabe na tela.
function fitSlides(root = document) {
  root.querySelectorAll(".slide").forEach((sl) => {
    const w = sl.clientWidth, h = sl.clientHeight;
    if (w) sl.style.setProperty("--s", h ? Math.min(w / SLIDE_W, h / (SLIDE_W * 9 / 16)) : w / SLIDE_W);
    const body = sl.querySelector(".slide-body"), fit = sl.querySelector(".slide-fit");
    if (!body || !fit) return;
    fit.style.zoom = "";
    const cs = getComputedStyle(body);
    const bw = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const bh = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const k = Math.min(1, bw / fit.scrollWidth, bh / fit.scrollHeight);
    if (k < 1) fit.style.zoom = k;
  });
}

function toggleFull() {
  const deck = $("#deck");
  if (document.fullscreenElement) document.exitFullscreen();
  else if (deck) deck.requestFullscreen();
}

function goSlide(to) {
  const slides = orionSlides();
  const i = slides.findIndex((sl) => sl.key === page);
  const j = to === "prev" ? i - 1 : to === "next" ? i + 1 : to === "first" ? 0 : to === "last" ? slides.length - 1 : +to;
  if (j < 0 || j >= slides.length || j === i) return;
  page = slides[j].key;
  history.replaceState(null, "", "#" + ORION + "/" + page);
  // carrossel: só desliza (sem voltar a desenhar os slides) e atualiza os controlos
  const deck = $("#deck");
  if (!deck) return render();
  deck.style.setProperty("--i", j);
  deck.querySelector(".deck-bar h1").textContent = slides[j].title;
  deck.querySelector(".deck-count").textContent = `${j + 1} / ${slides.length}`;
  deck.querySelectorAll("[data-slide=prev]").forEach((b) => (b.disabled = j === 0));
  deck.querySelectorAll("[data-slide=next]").forEach((b) => (b.disabled = j === slides.length - 1));
  deck.querySelectorAll(".deck-dots button").forEach((b, k) => b.classList.toggle("on", k === j));
  renderSidebar();
}

// ---------- Reports Diogo ----------
// Sales Report: vendas do BP (TOTAL REVENUE do Project Review), Total Project Amount do Power BI
// e comissões de mediadores (rubrica 511 do budget). Valores em k€.
function salesReportHtml() {
  const k = (v) => (typeof v === "number" ? fmtNum(v) : "–");
  const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1).replace(".", ",")}%` : "–");
  const ps = data.sales_status || {};
  // Power BI: "TOTAL Project Amount" + "Extras" (quando o relatório os tem), coluna € Resi+Retail (em €, aqui em k€)
  const pbi = (p) => {
    const rows = (p.sales || {}).amount_rows || [];
    const r = rows.find((x) => /^total project amount/i.test(x.label || ""));
    if (!r || typeof r.resi_retail !== "number") return null;
    const ex = rows.find((x) => /^extras?$/i.test((x.label || "").trim()));
    const v = (r.resi_retail + (ex && typeof ex.resi_retail === "number" ? ex.resi_retail : 0)) / 1000;
    return v ? v : null;  // 0 € no Power BI (p.ex. Magnolia, escrituras sem valor): "–", fora da diferença
  };
  // um projeto do Power BI partilhado por várias fases (p.ex. JCR) só conta no subtotal do grupo
  const byId = Object.fromEntries(allProjects().map((p) => [p.id, p]));
  const share = {};
  for (const p of allProjects()) if (p.sales_name) share[p.sales_name] = (share[p.sales_name] || 0) + 1;
  const row = (p) => {
    const c = p.commissions || {};
    const bp = lastValue(p, /^TOTAL REVENUE/i);
    const shared = p.sales_name && share[p.sales_name] > 1;
    const pb = shared ? null : pbi(p);
    return { id: p.id, name: p.label || p.name, bp, pb, sharedPb: shared ? pbi(p) : null, salesName: p.sales_name,
      diff: typeof bp === "number" && typeof pb === "number" ? bp - pb : null,
      cb: c.budget, cs: c.signed, ca: c.available, cpct: typeof c.budget === "number" && bp ? c.budget / bp : null };
  };
  const sum = (rows, key) => {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const totalOf = (rows, label, cls) => {
    const t = { name: label, bp: sum(rows, "bp"), cb: sum(rows, "cb"), cs: sum(rows, "cs"), ca: sum(rows, "ca") };
    const shared = [...new Set(rows.filter((r) => r.sharedPb !== null).map((r) => r.salesName))];
    t.pb = sum(rows, "pb");
    for (const n of shared) t.pb = (t.pb || 0) + rows.find((r) => r.salesName === n).sharedPb;
    t.diff = typeof t.bp === "number" && typeof t.pb === "number" && rows.every((r) => r.pb !== null || r.sharedPb !== null) ? t.bp - t.pb : null;
    t.cpct = typeof t.cb === "number" && t.bp ? t.cb / t.bp : null;
    t.cls = cls;
    return t;
  };
  const line = (r) => `<tr class="${r.cls || ""}"><td class="lbl">${r.id ? `<button type="button" class="rm-link" data-id="${r.id}">${esc(r.name)}</button>` : esc(r.name)}</td>
    <td>${k(r.bp)}</td><td>${k(r.pb)}</td><td class="${typeof r.diff === "number" && Math.round(r.diff) !== 0 ? (r.diff < 0 ? "neg" : "pos") : ""}">${k(r.diff)}</td>
    <td class="sr-c">${k(r.cb)}</td><td class="sr-c">${k(r.cs)}</td><td class="sr-c">${k(r.ca)}</td><td>${pct(r.cpct)}</td></tr>`;
  let body = "";
  const all = [];
  for (const m of data.menu || []) {
    const rows = (m.item ? [m.item] : m.items).map((id) => byId[id]).filter(Boolean).map(row);
    all.push(...rows);
    body += rows.map(line).join("");
    if (m.group && rows.length > 1) body += line(totalOf(rows, `Total ${m.group}`, "sr-sub"));
  }
  body += line(totalOf(all, "Total", "sr-total"));
  const src = ps.configured && ps.updated ? `Power BI live · ${fmtTime(ps.updated)}`
    : ps.snapshot_as_of ? `Power BI snapshot · ${esc(ps.snapshot_as_of)}` : "Power BI not available";
  return `<section class="report portfolio sales-report">
    <div class="report-head"><div><div class="kicker">Reports Diogo</div><h1>Sales Report</h1>
      <div class="src">Values in k€ · ${src}</div></div></div>
    <div class="t-scroll"><table class="sr">
      <thead><tr><th class="lbl" rowspan="2">Project</th><th colspan="3">Sales</th><th colspan="4" class="sr-c">Agent commissions (511 – external sales fees)</th></tr>
        <tr><th>Business plan<small>Total revenue</small></th><th>Power BI<small>Total project amount + extras</small></th><th>Δ BP vs Power BI</th>
          <th class="sr-c">Budget<small>last Project Review</small></th><th class="sr-c">Awarded<small>signed commitments</small></th>
          <th class="sr-c">Available<small>budget − awarded</small></th><th>Commissions<small>% of sales</small></th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <div class="sm-foot">Business plan: TOTAL REVENUE, most recent column of each Project Review. Power BI: Typology Report,
      "TOTAL Project Amount" plus "Extras" when the report has them (€ Resi+Retail; 0 € is shown as "–"); projects that share one Power BI project (e.g. JCR phases) only show it in the group total.
      Commissions: budget sheet, line 511.</div>
  </section>`;
}

function cashflowReportHtml() {
  return `<section class="report portfolio">
    <div class="report-head"><div><div class="kicker">Reports Diogo</div><h1>Cashflow Vizta REM</h1></div></div>
    <div class="empty"><p>Content to be defined.</p></div></section>`;
}

// ---------- Vizta Portfolio (conteúdo a definir) ----------
function portfolioHtml(pg) {
  const [, title] = PORTFOLIO_PAGES.find(([k]) => k === pg) || PORTFOLIO_PAGES[0];
  if (pg === "roadmap") return roadmapHtml(title);
  if (pg === "summary") return summaryHtml(title);
  return `<section class="report portfolio">
    <div class="report-head"><div><div class="kicker">Vizta Portfolio</div><h1>${esc(title)}</h1></div></div>
    <div class="empty"><p>Content to be defined.</p></div>
  </section>`;
}

// ---------- Summary of all projects ----------
const PHASES = [["Delivered", "delivered"], ["Construction", "construction"], ["Pre-sales", "presales"], ["Pipeline", "pipeline"], ["Other", "other"]];
function phaseOf(status) {
  const s = (status || "").toLowerCase();
  if (s.startsWith("deliver")) return "Delivered";
  if (s.includes("construction")) return "Construction";
  if (s.startsWith("pre-sale") || s.startsWith("presale")) return "Pre-sales";
  if (s.startsWith("pipeline")) return "Pipeline";
  return "Other";
}

function summaryRows() {
  const m = (k) => (typeof k === "number" ? k / 1000 : null);  // k€ -> M€
  const pm = (txt) => {  // "8.2M€" / "8,2 M€" -> 8.2
    const x = String(txt || "").match(/(-?[\d.,]+)/);
    return x ? parseFloat(x[1].replace(",", ".")) : null;
  };
  const rows = [];
  for (const p of allProjects()) {
    const info = p.info || {};
    const phys = info.total || info;  // NOLA: colunas TOTAL
    const only = info.summary_kpis;   // p.ex. Domitys: só custos e receita
    const lpt = leveredPostTax(p);
    const irr = lpt.irr ? parseFloat(lpt.irr.replace(",", ".")) : null;
    rows.push({
      id: p.id, name: info.summary_name || p.label || p.name, order: info.summary_order ?? 999, phase: phaseOf(info.status),
      apartments: phys.apartments, gca: phys.gca_above, gpa: phys.gpa,
      gpa_retail: info.retail_label ? null : phys.retail_gpa,  // "Common Areas" (Domitys) não é retalho
      cost: m(lastValue(p, /^TOTAL COST/i)), revenue: m(lastValue(p, /^TOTAL REVENUE/i)),
      margin: !only || only.includes("margin") ? pm(lpt.profit) : null,
      irr: !only || only.includes("irr") ? irr : null,
      delivered: info.delivered || null, region: (info.location || "").split("|")[1],
    });
  }
  for (const info of data.info_extra || []) {  // projetos só com dados manuais (Turquesa)
    if (!info.summary_name) continue;
    rows.push({ id: null, name: info.summary_name, order: info.summary_order ?? 999, phase: phaseOf(info.status),
      apartments: info.apartments, gca: info.gca_above, gpa: info.gpa, gpa_retail: info.retail_gpa,
      cost: null, revenue: null, margin: null, irr: null, delivered: info.delivered || null,
      region: (info.location || "").split("|")[1] });
  }
  // data de entrega (roadmap: End of deliveries) para os projetos entregues
  const rm = (data.roadmap || {}).rows || [];
  for (const r of rows) {
    if (r.phase !== "Delivered" || r.delivered) continue;
    const hit = rm.find((x) => (r.id && x.project_id === r.id));
    if (hit && hit.end_deliveries && new Date(hit.end_deliveries) <= new Date()) r.delivered = hit.end_deliveries.slice(0, 7);
  }
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

function summaryHtml(title) {
  const rows = summaryRows();
  const mon = (ym) => {
    const [y, mo] = ym.split("-");
    return `${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][+mo - 1]}/${y.slice(2)}`;
  };
  const sum = (k) => rows.reduce((a, r) => a + (typeof r[k] === "number" ? r[k] : 0), 0);
  const n0 = (v) => (typeof v === "number" ? fmtNum(v) : "–");
  const n1 = (v) => (typeof v === "number" ? v.toFixed(1).replace(".", ",") : "–");
  const gpaR = (v) => (typeof v === "number" && v > 0 ? fmtNum(v) : "–");
  const totals = { apartments: sum("apartments"), gca: sum("gca"), gpa: sum("gpa"), gpa_retail: sum("gpa_retail"),
    cost: sum("cost"), revenue: sum("revenue"), margin: sum("margin") };

  let body = "";
  PHASES.forEach(([phase, cls], i) => {
    const rs = rows.filter((r) => r.phase === phase);
    rs.forEach((r, j) => {
      const name = r.id ? `<button type="button" class="rm-link" data-id="${r.id}">${esc(r.name)}</button>` : esc(r.name);
      body += `<tr class="sm-${cls}">${j === 0 ? `<th class="sm-phase" rowspan="${rs.length}"><span class="sm-num">${i + 1}</span>${phase}</th>` : ""}
        <td class="sm-name">${name}${r.delivered ? ` <small>(${mon(r.delivered)})</small>` : ""}</td>
        <td>${n0(r.apartments)}</td><td>${n0(r.gca)}</td><td>${n0(r.gpa)}</td><td>${gpaR(r.gpa_retail)}</td>
        <td>${n1(r.cost)}</td><td>${n1(r.revenue)}</td><td>${n1(r.margin)}</td><td>${n1(r.irr)}</td></tr>`;
    });
  });
  const ic = (k) => icon(k);
  const projects = rows.length;
  return `<section class="report portfolio summary">
    <div class="report-head"><div><div class="kicker">Vizta Portfolio</div><h1>${esc(title)}</h1>
      <div class="sm-sub">${projects} projects under management, with a total of ${fmtNum(totals.apartments)} apartments and ${fmtNum(totals.revenue)} M€ GDV</div></div></div>
    <div class="t-scroll"><table class="sm">
      <thead><tr><th class="sm-h-phase">Project phase</th><th class="sm-h-name">Projects</th>
        <th>${ic("home")}<div>Apartments (#)</div></th>
        <th>${ic("plan")}<div>GCA</div><small>ab. ground sqm</small></th>
        <th colspan="2">${ic("plan")}<div>GPA</div><div class="sm-split"><small>Residential</small><small>Retail</small></div></th>
        <th>${ic("coins")}<div>Project Total Cost <small>(M€)</small></div></th>
        <th>${ic("chart")}<div>Revenue <small>(M€)</small></div></th>
        <th>${ic("margin")}<div>Margin</div><small>Orion (M€)*</small></th>
        <th>${ic("pct")}<div>IRR</div><small>Orion (%)*</small></th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td></td><td class="sm-tot-l">Totals</td><td>${fmtNum(totals.apartments)}</td><td>${fmtNum(totals.gca)}</td>
        <td>${fmtNum(totals.gpa)}</td><td>${fmtNum(totals.gpa_retail)}</td><td>${fmtNum(totals.cost)}</td>
        <td>${fmtNum(totals.revenue)}</td><td>${fmtNum(totals.margin)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="sm-foot">Physical data: project_info.json · Cost and revenue: TOTAL COST / TOTAL REVENUE of the most recent column of each Project Review ·
      *Margin and IRR: Orion view, levered post-tax (most recent column)</div>
  </section>`;
}

// ---------- Roadmap (ficheiro "RM mensuelle Portugal") ----------
function roadmapHtml(title, withKpis = false) {
  // withKpis: vendas (RM) e KPIs Orion à direita — só no slide do Project Review - Orion
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
      <td class="rm-track">${bars}</td>${withKpis ? rmKpiCells(r) : ""}</tr>`;
  }).join("")).join("");

  const todayLeft = pos(today);
  return `<section class="report portfolio roadmap">${head}${notes}
    <div class="rm-scroll"><table class="rm">
      <thead>${withKpis ? `<tr class="rm-grp-row"><th colspan="3"></th><th class="rm-grp" colspan="${RM_SALES.length + 1}">Residential Units</th>
        <th class="rm-grp orion" colspan="3">Orion's view<small>(Levered post-tax)</small></th></tr>` : ""}
        <tr><th class="rm-hcorner" colspan="2">Area &amp; Projects</th>
        <th class="rm-years"><div class="rm-yearrow">${years.map((y) => `<span>${y}</span>`).join("")}</div>
          <span class="rm-today-lbl" style="left:${todayLeft}%">Today</span></th>
        ${withKpis ? `<th class="rm-k">Total units</th>${RM_SALES.map(([, l]) => `<th class="rm-k">${l}</th>`).join("")}
        <th class="rm-k orion">IRR</th><th class="rm-k orion">EM</th><th class="rm-k orion">€ / %<br>Margin</th>` : ""}</tr></thead>
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

// Vendas (ficheiro RM, colunas % PSPA ... Units in the market) e KPIs atuais do Project Review
const RM_SALES = [["pct_pspa", "PSPA"], ["pct_deeds", "Final deeds"], ["pct_sold", "Total sold"], ["pct_reserved", "Units reserved"],
  ["units_market", "Units on market"]];

function rmKpiCells(r) {
  const p = r.project_id ? allProjects().find((x) => x.id === r.project_id) : null;
  const info = p ? p.info || {} : (data.info_extra || []).find((x) => x.summary_name === r.label) || {};
  const pct = (v) => (typeof v === "number" ? `${Math.round(v * 100)}%` : v ? esc(v) : "");
  const units = `${typeof r.apartments === "number" ? fmtNum(r.apartments) : ""}${r.extra_units ? `<small>(+${fmtNum(r.extra_units)})</small>` : ""}`;
  // sem vendas (tudo a zero ou n/a): células tracejadas, como no PPT
  const noSales = ["pct_pspa", "pct_deeds", "pct_sold", "pct_reserved"].every((k) => !(typeof r[k] === "number" && r[k] > 0));
  const sales = noSales ? `<td class="rm-hatch" colspan="${RM_SALES.length}"></td>`
    : RM_SALES.map(([k]) => (k === "units_market"
      ? `<td class="rm-mkt">${r[k] === 0 ? "-" : typeof r[k] === "number" ? fmtNum(r[k]) : esc(r[k] || "")}</td>`
      : `<td>${pct(r[k])}</td>`)).join("");
  // KPIs: levered post-tax da coluna mais recente; margem % = lucro / receita total
  const km = info.kpis_manual;
  const lpt = km ? { irr: km.irr, em: null, profit: km.margin } : p ? leveredPostTax(p) : {};
  const rev = km ? km.revenue : p ? lastValue(p, /^TOTAL REVENUE/i) : null;
  const profit = lpt.profit ? parseFloat(lpt.profit.replace(",", ".")) * (/k€/i.test(lpt.profit) ? 0.001 : 1) : null;
  const mPct = profit !== null && typeof rev === "number" && rev ? `${((profit * 1000) / rev * 100).toFixed(1).replace(".", ",")}%` : "";
  const margin = lpt.profit ? `${esc(lpt.profit.replace(/\s*€$/, ""))}${mPct ? ` / ${mPct}` : ""}` : "";
  return `<td class="rm-units">${units}</td>${sales}
    <td class="rm-o">${esc((lpt.irr || "").replace(" %", "%"))}</td><td class="rm-o">${esc(lpt.em || "")}</td><td class="rm-o">${margin}</td>`;
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
  plan: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h6v11"/><path d="M9 14h12"/><path d="M14 4v10"/><path d="M17 17h2"/>',
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
  const em = txt.match(/(-?[\d.,]+)\s*x/i);
  const rest = txt.split("|").slice(1).join("|");
  const profit = rest.match(/(-?[\d.,]+)\s*(M|k)?\s*€/i);
  return { irr: irr ? `${irr[1]} %` : null, em: em ? `${em[1]}x` : null,
    profit: profit ? `${profit[1].replace(".", ",")} ${(profit[2] || "").toUpperCase()}€` : null };
}

function overviewHtml(p) {
  const info = p.info || {};
  const [place, city] = (info.location || "").split("|").map((s) => s.trim());
  const meur =(k) => (typeof k === "number" ? `${(k / 1000).toFixed(1).replace(".", ",")} M€` : "—");
  // números com separador de milhares; texto (p.ex. "TBD", "3/4") tal como está no project_info.json
  const num = (v, unit) => (typeof v === "number" ? `${fmtNum(v)}${unit ? ` ${unit}` : ""}`
    : typeof v === "string" && v.trim() ? esc(v) : "—");
  const km = info.kpis_manual;  // projetos sem budget no dashboard (p.ex. Turquesa): valores do último Project Review
  const cost = km ? km.cost : lastValue(p, /^TOTAL COST/i);
  const rev = km ? km.revenue : lastValue(p, /^TOTAL REVENUE/i);
  const lpt = km ? { irr: km.irr, profit: km.margin } : leveredPostTax(p);
  const avg = km ? km.avg_price
    : typeof rev === "number" && typeof info.gpa === "number" && info.gpa > 0 ? (rev * 1000) / info.gpa : null;
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
    <div class="ov-foot"><span><span class="ov-src">Costs, revenue, IRR and margin: ${km ? esc(km.source || "") : `${esc(p.sheet)}${lastCol ? ` · ${esc(lastCol)}` : ""}`} · </span>${notes}</span>
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

// ---------- Legal Information (certidão permanente da sociedade do projeto) ----------
function legalPageHtml(p) {
  const L = p.legal || {};
  const sub = L.as_of ? `Permanent certificate (certidão permanente) consulted on ${fmtDate(L.as_of)}` : "Permanent certificate";
  const head = simpleHead(p, "Legal Information", sub);
  if (L.error) {
    return `<section class="report page-legal">${head}<div class="banner">${esc(L.company || "")}: ${esc(L.error)}</div></section>`;
  }
  // validade da certidão: aviso nos últimos 60 dias e quando expirou
  const days = L.valid_until ? Math.floor((new Date(L.valid_until + "T00:00:00") - new Date()) / 86400000) : null;
  const validity = days === null ? "" : days < 0 ? `<span class="lg-pill bad">Expired</span>`
    : days <= 60 ? `<span class="lg-pill warn">Expires in ${days} days</span>` : `<span class="lg-pill ok">Valid</span>`;
  const item = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const cae = L.cae ? esc(L.cae) + ((L.cae_secondary || []).length
    ? `<div class="sub">Secondary: ${L.cae_secondary.map(esc).join(" · ")}</div>` : "") : "";
  const ident = [
    item("Company", `<b>${esc(L.firm)}</b>`),
    item("NIPC", esc(L.nipc)),
    item("Legal form", esc(L.legal_form)),
    item("Registered office", esc(L.address)),
    item("Share capital", esc(L.capital)),
    item("Financial year end", esc(L.year_end)),
    item("Term of office", esc(L.term)),
    item("Main CAE", cae),
  ].join("");
  const organs = (L.organs || []).map((g) => `<div class="lg-organ"><h3>${esc(g.organ)}</h3><ul>${g.members.map((m) =>
    `<li><span>${esc(m.name)}</span>${m.role ? `<small>${esc(m.role)}</small>` : ""}</li>`).join("")}</ul></div>`).join("");
  const docs = [["Permanent certificate", L.crc_url], ["Articles of association", L.statutes_url], ["RCBE (beneficial owners)", L.rcbe_url], ["Company folder", L.folder_url]]
    .filter(([, u]) => u).map(([t, u]) => `<a class="lg-doc" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${t} ↗</a>`).join("");
  const crcCode = L.code ? `<div class="lg-code"><div><dt>Access code</dt><dd><b>${esc(L.code)}</b></dd></div>
      <div><dt>Valid until</dt><dd>${fmtDate(L.valid_until)} ${validity}</dd></div>
      <a class="lg-doc" href="https://registo.justica.gov.pt/Empresas/Consultar-Certidao-Permanente/Iniciar?codcertidao=${encodeURIComponent(L.code)}"
        target="_blank" rel="noopener noreferrer">Consult online ↗</a></div>` : "";
  const notes = [
    L.newer_incomplete ? `There is a more recent certificate (${fmtDate(L.newer_incomplete)}), but without the corporate bodies; the data below is from ${fmtDate(L.as_of)}.` : "",
    ...(L.pending || []).map((f) => `Pending registration: ${esc(f)}`),
  ].filter(Boolean).map((t) => `<div class="banner">${t}</div>`).join("");
  return `<section class="report page-legal">${head}${notes}
    <div class="financing"><h2>Company <span>${esc(L.company || "")}</span></h2><dl class="fin-grid">${ident}</dl>
      ${L.object ? `<div class="lg-block"><dt>Corporate purpose</dt><dd>${esc(L.object)}</dd></div>` : ""}
      ${L.binding ? `<div class="lg-block"><dt>Binding signatures</dt><dd>${esc(L.binding)}</dd></div>` : ""}</div>
    ${organs ? `<div class="financing"><h2>Corporate bodies</h2><div class="lg-organs">${organs}</div></div>` : ""}
    <div class="financing"><h2>Permanent certificate &amp; documents</h2>${crcCode}<div class="lg-docs">${docs}</div></div>
  </section>`;
}

// ---------- Ponto de Situação (atas: só pontos Pendente / Standby) ----------
// Colunas da lista: [campo, título, tipo do filtro] — "select" para valores repetidos, texto para o resto
const PS_COLS = [["status", "Status", "select"], ["area", "Area", "select"], ["title", "Title", "text"],
  ["description", "Description", "text"], ["action", "Action", "text"], ["owner", "Owner", "select"],
  ["dept", "Dept.", "select"], ["created", "Created", "date"], ["target_initial", "Initial target", "date"],
  ["target", "Current target", "date"]];
const psFilters = {};  // filtros por projeto: {projectId: {campo: valor}}

const psDue = (it) => it.target || it.target_initial;  // data objetivo atual; senão a inicial
const psLate = (it) => psDue(it) && psDue(it) < new Date().toISOString().slice(0, 10);
const psFold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function psFiltered(p) {
  const f = psFilters[p.id] || {};
  return (p.status_items || []).filter((it) => PS_COLS.every(([k, , type]) => {
    const want = f[k];
    if (!want) return true;
    if (type === "select") return (it[k] || "") === want;
    const v = type === "date" ? (it[k] ? fmtDate(it[k]) : "") : it[k];
    return psFold(v).includes(psFold(want));
  })).sort((x, y) => (psDue(x) || "9999").localeCompare(psDue(y) || "9999"));
}

function psRowsHtml(rows) {
  const d = (iso, late) => (iso ? `<span class="${late ? "ps-late" : ""}">${fmtDate(iso)}</span>` : "—");
  const txt = (v) => (v ? esc(v).replace(/\n/g, "<br>") : "");
  if (!rows.length) return `<tr><td class="ps-none" colspan="${PS_COLS.length}">No items match the filters.</td></tr>`;
  return rows.map((it) => {
    const late = psLate(it);
    return `<tr class="${late ? "late" : ""}">
      <td><span class="ps-pill ${it.status === "Standby" ? "sb" : "pd"}">${esc(it.status)}</span></td>
      <td class="ps-area">${esc(it.area || "").replace(/\//g, "/<wbr>")}</td><td class="ps-title">${txt(it.title)}</td>
      <td>${txt(it.description)}</td><td>${txt(it.action)}</td>
      <td>${esc(it.owner || "")}</td><td>${esc(it.dept || "")}</td><td class="ps-d">${d(it.created)}</td>
      <td class="ps-d">${d(it.target_initial, !it.target && late)}</td><td class="ps-d">${d(it.target, it.target && late)}</td></tr>`;
  }).join("");
}

function psCountHtml(p) {
  const n = psFiltered(p).length, all = (p.status_items || []).length;
  const any = Object.values(psFilters[p.id] || {}).some(Boolean);
  return `${n === all ? `${all} items` : `Showing ${n} of ${all} items`}${any ? ` · <button type="button" class="ps-clear" data-ps-clear>Clear filters</button>` : ""}`;
}

function statusPageHtml(p) {
  const items = p.status_items || [];
  const rep = data.status_report || {};
  const sub = (rep.files || []).map((f) => `${esc(f.name)} · saved ${fmtTime(f.modified)}`).join("<br>");
  const head = simpleHead(p, "Ponto de Situação", sub);
  const err = rep.error ? `<div class="banner">${esc(rep.error)}</div>` : "";
  if (!items.length) {
    return `<section class="report page-status">${head}${err}<div class="empty"><p>No pending or standby items for this project.</p></div></section>`;
  }
  const n = (st) => items.filter((it) => it.status === st).length;
  const nLate = items.filter(psLate).length;
  const kpi = (v, l, cls = "") => `<div class="ps-kpi ${cls}"><b>${v}</b><span>${l}</span></div>`;
  const kpis = `<div class="ps-kpis">${kpi(items.length, "Open items")}${kpi(n("Pendente"), "Pendente")}${kpi(n("Standby"), "Standby")}
    ${kpi(nLate, "Overdue", nLate ? "late" : "")}</div>`;
  // filtros: listas com os valores existentes (estado, área, responsável, departamento); texto nas outras colunas
  const f = psFilters[p.id] || {};
  const filter = ([k, label, type]) => {
    if (type === "select") {
      const vals = [...new Set(items.map((it) => it[k] || ""))].filter(Boolean).sort((a, b) => a.localeCompare(b));
      return `<th><select data-psf="${k}" aria-label="Filter ${label}"><option value="">All</option>${vals.map((v) =>
        `<option${f[k] === v ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></th>`;
    }
    return `<th><input type="search" data-psf="${k}" value="${esc(f[k] || "")}" placeholder="${type === "date" ? "dd/mm/aaaa" : "Filter…"}"
      aria-label="Filter ${label}"></th>`;
  };
  return `<section class="report page-status">${head}${err}${kpis}
    <div class="ps-count" id="ps-count">${psCountHtml(p)}</div>
    <div class="t-scroll"><table class="ps"><thead><tr>${PS_COLS.map(([, l]) => `<th>${l}</th>`).join("")}</tr>
      <tr class="ps-filters">${PS_COLS.map(filter).join("")}</tr></thead>
      <tbody id="ps-body">${psRowsHtml(psFiltered(p))}</tbody></table></div>
    <div class="sm-foot">Only items with status "Pendente" or "Standby". Overdue: current target date (or initial, if there is no current one) before today.</div></section>`;
}

// filtros da lista: atualiza só as linhas e o contador (o campo onde se escreve não perde o foco)
function psApplyFilter(el) {
  const p = allProjects().find((x) => x.id === selectedId);
  if (!p) return;
  (psFilters[p.id] = psFilters[p.id] || {})[el.dataset.psf] = el.value.trim();
  $("#ps-body").innerHTML = psRowsHtml(psFiltered(p));
  $("#ps-count").innerHTML = psCountHtml(p);
}
$("#main").addEventListener("input", (e) => { const el = e.target.closest("[data-psf]"); if (el) psApplyFilter(el); });
$("#main").addEventListener("click", (e) => {
  if (!e.target.closest("[data-ps-clear]")) return;
  delete psFilters[selectedId];
  renderMain();
});

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
  const sb = e.target.closest("[data-slide]");
  if (sb) {
    if (sb.dataset.slide === "full") toggleFull(); else goSlide(sb.dataset.slide);
    return;
  }
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
    if (selectedId === ORION) {
      // apresentação: todos os slides, um por página 16:9 (297 × 167 mm, sem margens), como um PPT
      const slides = orionSlides();
      $("#print-area").innerHTML = slides.map((sl, k) => slideHtml(sl, k)).join("");
      document.body.classList.add("print-all", "print-deck");
      const pg = document.createElement("style");
      pg.id = "deck-page";
      pg.textContent = "@page { size: 297mm 167.0625mm; margin: 0; }";
      document.head.appendChild(pg);
      fitSlides($("#print-area"));
    } else if (pdf.dataset.pdf === "all") {
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

// Apresentação: setas / PageUp-PageDown / espaço, Home-End, F = ecrã inteiro; deslizar no ecrã tátil
document.addEventListener("keydown", (e) => {
  if (selectedId !== ORION || e.target.closest("input, select, textarea") || e.target.isContentEditable) return;
  const map = { ArrowRight: "next", ArrowDown: "next", PageDown: "next", " ": "next", ArrowLeft: "prev", ArrowUp: "prev", PageUp: "prev", Home: "first", End: "last" };
  if (map[e.key]) {
    e.preventDefault();
    goSlide(map[e.key]);
  } else if (e.key === "f" || e.key === "F") toggleFull();
});
let touchX = null;
$("#main").addEventListener("touchstart", (e) => { touchX = e.target.closest(".deck-view") ? e.touches[0].clientX : null; }, { passive: true });
$("#main").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) goSlide(dx < 0 ? "next" : "prev");
});
let fitTimer;
window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => selectedId === ORION && fitSlides(), 100); });
document.addEventListener("fullscreenchange", () => selectedId === ORION && setTimeout(fitSlides, 50));
// PDF da apresentação: a largura da página em px depende do browser e da escala do ecrã,
// por isso a escala dos slides é recalculada já com o layout de impressão.
matchMedia("print").addEventListener("change", (e) => {
  if (e.matches && document.body.classList.contains("print-deck")) fitSlides($("#print-area"));
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("print-all", "print-deck");
  const pg = document.getElementById("deck-page");
  if (pg) pg.remove();
  $("#print-area").innerHTML = "";
});

load().catch(() => setStatus(false));
setInterval(poll, POLL_MS);
