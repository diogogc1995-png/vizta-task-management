"use strict";

const POLL_MS = 5000;
let data = null;
let version = null;
let selectedId = decodeURIComponent(location.hash.slice(1)) || null;

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
function marginPct(p) {
  const r = p.rows.find((r) => r.percent && r.kind === "total" && /^MARGIN/i.test(r.label));
  return r ? { value: r.values[r.values.length - 1], delta: r.delta } : null;
}

async function load() {
  const res = await fetch("/api/projects", { cache: "no-store" });
  data = await res.json();
  version = data.version;
  const ids = allProjects().map((p) => p.id);
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
  const files = data ? data.files.length : 0;
  el.innerHTML = `<span class="dot"></span>${n} project${n === 1 ? "" : "s"} from ${files} file${files === 1 ? "" : "s"} · live (checks every ${POLL_MS / 1000}s) · last check ${new Date().toLocaleTimeString("en-GB")}`;
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
  const html = data.files.map((f) => {
    const items = f.projects.map((p) => {
      const m = marginPct(p);
      let mhtml = "";
      if (m && typeof m.value === "number") {
        const d = typeof m.delta === "number" && Math.abs(m.delta) >= 0.00005
          ? ` <span class="${m.delta < 0 ? "neg" : "pos"}">${m.delta > 0 ? "▲" : "▼"}</span>` : "";
        mhtml = `${fmtPct(m.value)}${d}`;
      }
      return `<button type="button" class="proj ${p.id === selectedId ? "active" : ""}" data-id="${p.id}" title="${esc(f.file)} › ${esc(p.sheet)}">
        <span>${esc(p.name)}</span><span class="m">${mhtml}</span></button>`;
    }).join("");
    const err = f.error ? `<span class="err" title="${esc(f.error)}">⚠ read error</span>` : "";
    const none = !f.projects.length && !f.error ? `<div class="proj" style="color:var(--muted)">No review sheet found</div>` : "";
    return `<div class="group"><div class="group-title"><span title="${esc(f.location || "")}">${f.remote ? "☁ " : ""}${esc(f.group)}</span>${err}</div>${items}${none}</div>`;
  }).join("");
  $("#sidebar").innerHTML = html || `<div class="group-title">No files</div>`;
}

function banners() {
  const out = [];
  for (const m of data.missing) out.push(`Source not found: <code>${esc(m)}</code> — check <code>config.json</code> (is OneDrive synced?).`);
  for (const se of data.source_errors || []) out.push(`Could not read SharePoint link <code>${esc(se.source.slice(0, 70))}…</code>: ${esc(se.error)}`);
  for (const f of data.files) if (f.error) out.push(`Could not read <b>${esc(f.file)}</b> (showing last good data, retrying automatically): ${esc(f.error)}`);
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
  $("#main").innerHTML = banners() + reportHtml(p);
}

function reportHtml(p) {
  const n = p.columns.length;
  const latest = n - 1;
  const head = `<tr><th class="lbl">${esc(p.name)}</th>${p.columns
    .map((c, i) => `<th class="${i === latest ? "latest" : ""}">${c.lines.map(esc).join("<br>")}</th>`)
    .join("")}<th class="delta">Δ</th></tr>`;

  let body = `<tr class="spacer"><td></td>${"<td></td>".repeat(n)}<td></td></tr>`;
  let prevKind = null;
  for (const r of p.rows) {
    const cls = [r.kind === "line" ? "" : r.kind, r.kind !== "line" && prevKind === "line" ? "first-total" : ""].join(" ").trim();
    body += `<tr class="${cls}"><td class="lbl">${esc(r.label)}</td>${r.values
      .map((v, i) => `<td class="${i === latest ? "latest" : ""}">${fmt(v, r.percent)}</td>`)
      .join("")}<td class="delta">${fmt(r.delta, r.percent)}</td></tr>`;
    prevKind = r.kind;
  }

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
    <div class="report-head">
      <div><h1>${esc(p.name)}</h1><div class="src">${p.remote ? "SharePoint · " : ""}${esc(p.group)} › ${esc(p.sheet)} · k€</div></div>
      <div class="dates">Last project review: <b>${fmtDate(p.last_review)}</b><br>
        Next project review: <b>${fmtDate(p.next_review)}</b><br>
        File saved: ${fmtTime(p.modified)}</div>
    </div>
    <table class="pr"><thead>${head}</thead><tbody>${body}</tbody></table>
    ${notes}${kpis}${after}
  </section>`;
}

// ---------- eventos ----------
$("#sidebar").addEventListener("click", (e) => {
  const b = e.target.closest(".proj[data-id]");
  if (!b) return;
  selectedId = b.dataset.id;
  history.replaceState(null, "", "#" + encodeURIComponent(selectedId));
  render();
});

document.addEventListener("click", (e) => {
  const menuBtn = e.target.closest(".menu > button");
  document.querySelectorAll(".menu.open").forEach((m) => { if (!menuBtn || m !== menuBtn.parentElement) m.classList.remove("open"); });
  if (menuBtn) menuBtn.parentElement.classList.toggle("open");

  const pdf = e.target.closest("[data-pdf]");
  if (pdf) {
    if (pdf.dataset.pdf === "all") {
      $("#print-area").innerHTML = allProjects().map(reportHtml).join("");
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
