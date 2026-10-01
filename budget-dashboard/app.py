"""Budget Dashboard — servidor local.

Lê os ficheiros Excel indicados em config.json (pastas do OneDrive sincronizadas
e/ou links do SharePoint), deteta as
folhas de Project Review e serve o dashboard em http://localhost:<port>.
Os ficheiros são relidos automaticamente quando mudam.

Uso:  python app.py
"""

import glob
import hashlib
import io
import json
import os
import sys
import threading
import time
import webbrowser

from flask import Flask, abort, jsonify, request, send_file, send_from_directory

import financing
import powerbi
from budget_parser import attach_budget_details, parse_file
from excel_export import build_workbook
from sharepoint import SharePointClient, is_url

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("BUDGET_DASHBOARD_CONFIG") or os.path.join(BASE_DIR, "config.json")
FINANCING_PATH = os.environ.get("BUDGET_DASHBOARD_FINANCING") or os.path.join(BASE_DIR, "financing.json")
INFO_PATH = os.environ.get("BUDGET_DASHBOARD_INFO") or os.path.join(BASE_DIR, "project_info.json")
IMAGES_DIR = os.path.join(BASE_DIR, "project_images")
SALES_SNAPSHOT_PATH = os.path.join(BASE_DIR, "sales_snapshot.json")
CACHE_DIR = os.path.join(BASE_DIR, ".cache")
TOKEN_CACHE = os.path.join(BASE_DIR, "token_cache.json")
EXCEL_EXT = (".xlsx", ".xlsm")


def load_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("config.json não encontrado. Copia config.example.json para "
                 "config.json e indica as pastas/ficheiros do OneDrive.")
    try:
        with open(CONFIG_PATH, encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except json.JSONDecodeError as e:
        sys.exit(f"config.json inválido ({e}). Nos caminhos usa / ou \\\\ em vez de \\.")
    cfg.setdefault("sources", [])
    cfg.setdefault("include_hidden_sheets", False)
    cfg.setdefault("port", 8765)
    cfg.setdefault("sharepoint", {})
    cfg["sharepoint"].setdefault("poll_seconds", 60)
    cfg.setdefault("powerbi", {})
    cfg["powerbi"].setdefault("poll_seconds", 900)
    return cfg


def _expand(p):
    return os.path.normpath(os.path.expanduser(os.path.expandvars(p)))


def list_files(sources):
    """Ficheiros Excel a ler: caminhos diretos ou todos os .xlsx/.xlsm de uma pasta."""
    files, missing = [], []
    for src in sources:
        if is_url(src):
            continue  # tratado pela sincronização com o SharePoint
        path = _expand(src)
        if os.path.isdir(path):
            for f in glob.glob(os.path.join(path, "**", "*"), recursive=True):
                name = os.path.basename(f)
                if name.lower().endswith(EXCEL_EXT) and not name.startswith("~$"):
                    files.append(os.path.normpath(f))
        elif os.path.isfile(path):
            files.append(path)
        else:
            missing.append(src)
    return sorted(set(files)), missing


def _parse(path, include_hidden, entry, sig, **extra):
    """Lê o ficheiro; se falhar mantém os últimos dados válidos (tenta de novo no ciclo seguinte)."""
    try:
        res = parse_file(path, include_hidden)
        return {**extra, "sig": sig, "projects": res["projects"], "budgets": res["budgets"],
                "error": None, "loaded_at": time.time()}
    except Exception as e:  # ficheiro a meio de sincronizar, bloqueado, corrompido, ...
        old = entry or {"projects": [], "budgets": {}, "loaded_at": None}
        return {**extra, "sig": None, "projects": old["projects"], "budgets": old.get("budgets", {}),
                "error": f"{type(e).__name__}: {e}", "loaded_at": old["loaded_at"]}


class Store:
    """Cache dos ficheiros lidos; relê um ficheiro só quando muda.

    Chaves de self.files: caminho local, ou "sp:<drive>:<item>" para ficheiros do SharePoint.
    """

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.files = {}  # chave -> {"name", "location", "modified", "sig", "projects", "error", "loaded_at"}
        self.missing = []
        self.source_errors = {}  # link SharePoint -> erro
        self.financing, self.financing_error, self.financing_sig = {}, None, None
        self.info, self.info_error, self.info_sig = {}, None, None
        # Vendas transcritas do Power BI, usadas enquanto não houver leitura automática
        self.snap, self.snap_as_of, self.snap_error, self.snap_sig = {}, None, None, None
        self.version = ""

    def _update_version(self):
        state = json.dumps(
            [(k, e["sig"], e["error"]) for k, e in sorted(self.files.items())]
            + self.missing + sorted(self.source_errors.items())
            + [self.financing_sig, self.financing_error, self.info_sig, self.info_error,
               self.snap_sig, self.snap_error], default=str)
        self.version = hashlib.sha1(state.encode()).hexdigest()[:12]

    def _refresh_financing(self):
        try:
            st = os.stat(FINANCING_PATH)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.financing_sig:
            self.financing, self.financing_error = financing.load(FINANCING_PATH)
            self.financing_sig = sig
        try:
            st = os.stat(INFO_PATH)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.info_sig:
            self.info, self.info_error = financing.load_map(INFO_PATH)
            self.info_sig = sig
        try:
            st = os.stat(SALES_SNAPSHOT_PATH)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.snap_sig:
            self.snap, self.snap_as_of, self.snap_error = powerbi.load_snapshot(SALES_SNAPSHOT_PATH)
            self.snap_sig = sig

    def refresh(self):
        """Ficheiros locais (OneDrive sincronizado): verifica mtime/tamanho."""
        with self.lock:
            self._refresh_financing()
            paths, self.missing = list_files(self.cfg["sources"])
            local = {k for k in self.files if not k.startswith("sp:")}
            for gone in local - set(paths):
                del self.files[gone]
            for path in paths:
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                sig = (st.st_mtime, st.st_size)
                entry = self.files.get(path)
                if entry and entry["sig"] == sig:
                    continue
                self.files[path] = _parse(path, self.cfg["include_hidden_sheets"], entry, sig,
                                          name=os.path.basename(path), location=path,
                                          modified=st.st_mtime)
            self._update_version()

    def sync_sharepoint(self, client):
        """Ficheiros do SharePoint: compara o cTag de cada ficheiro e descarrega os que mudaram."""
        os.makedirs(CACHE_DIR, exist_ok=True)
        for url in [s for s in self.cfg["sources"] if is_url(s)]:
            try:
                if client is None:
                    raise RuntimeError(sp_init_error or "SharePoint não configurado")
                items = client.list_excel(url)
            except Exception as e:
                with self.lock:
                    self.source_errors[url] = f"{type(e).__name__}: {e}"
                    self._update_version()
                continue
            keys = {it["key"] for it in items}
            for it in items:
                with self.lock:
                    entry = self.files.get(it["key"])
                if entry and entry["sig"] == it["sig"]:
                    continue
                dest = os.path.join(CACHE_DIR, hashlib.sha1(it["key"].encode()).hexdigest()[:16]
                                    + os.path.splitext(it["name"])[1])
                try:
                    client.download(it, dest)
                    new = _parse(dest, self.cfg["include_hidden_sheets"], entry, it["sig"],
                                 name=it["name"], location=it["web_url"], modified=it["modified"],
                                 source=url)
                except Exception as e:
                    old = entry or {"projects": [], "budgets": {}, "loaded_at": None}
                    new = {"name": it["name"], "location": it["web_url"], "modified": it["modified"],
                           "source": url, "sig": None, "projects": old["projects"],
                           "budgets": old.get("budgets", {}),
                           "error": f"{type(e).__name__}: {e}", "loaded_at": old["loaded_at"]}
                with self.lock:
                    self.files[it["key"]] = new
            with self.lock:
                self.source_errors.pop(url, None)
                for k in [k for k, e in self.files.items()
                          if k.startswith("sp:") and e.get("source") == url and k not in keys]:
                    del self.files[k]
                self._update_version()

    def snapshot(self):
        menu_conf = menu_index(self.cfg.get("menu", []))
        sales = sales_store.state() if sales_store else {"data": {}, "error": None, "updated": None}
        with self.lock:
            files = []
            matched = set()
            ids = {}  # nome normalizado -> id
            for key, e in sorted(self.files.items(), key=lambda kv: kv[1]["name"].lower()):
                projects = []
                budgets = e.get("budgets", {})
                for p in e["projects"]:
                    pid = hashlib.sha1(f"{key}|{p['sheet']}".encode()).hexdigest()[:10]
                    k = financing.key(p["name"])
                    ids.setdefault(k, pid)
                    fin = self.financing.get(k)
                    if fin:
                        matched.add(k)
                    conf = menu_conf.get(k, {})
                    sheet = conf.get("budget_sheet")
                    if sheet:
                        budget = budgets.get(sheet)
                    else:  # sem configuração: só se o ficheiro tiver uma única folha de budget
                        budget = next(iter(budgets.values())) if len(budgets) == 1 else None
                    # Subrubricas da folha de budget dentro das rubricas do Project Review
                    detailed = attach_budget_details(p, budget) if budget else p
                    # Vendas (Power BI): nome do projeto no Power BI; "sales_project": null = sem vendas
                    sales_name = conf.get("sales_project", p["name"]) if conf else p["name"]
                    sk = financing.key(sales_name) if sales_name else None
                    live = sales["data"].get(sk) if sk else None
                    snap = self.snap.get(sk) if sk and not live else None
                    projects.append({**detailed, "id": pid, "financing": fin, "info": self.info.get(k),
                                     "label": conf.get("label") or p["name"],
                                     "menu_group": conf.get("group"),
                                     "budget_missing": sheet if sheet and not budget else None,
                                     "sales_name": sales_name,
                                     "sales": live or snap,
                                     "sales_source": "live" if live else "snapshot" if snap else None})
                files.append({
                    "file": e["name"],
                    "group": os.path.splitext(e["name"])[0],
                    "path": key,
                    "location": e["location"],
                    "remote": key.startswith("sp:"),
                    "modified": e["modified"],
                    "loaded_at": e["loaded_at"],
                    "error": e["error"],
                    "projects": projects,
                })
            return {"version": self.version, "files": files, "missing": list(self.missing),
                    "source_errors": [{"source": s, "error": err}
                                      for s, err in sorted(self.source_errors.items())],
                    "sales_status": {"configured": sales_store is not None, "error": sales["error"] or sales_init_error,
                                     "updated": sales["updated"], "snapshot_as_of": self.snap_as_of,
                                     "snapshot_error": self.snap_error},
                    "financing_error": self.financing_error,
                    "info_error": self.info_error,
                    "financing_unmatched": sorted(c["project"] for k, c in self.financing.items()
                                                  if k not in matched),
                    **build_menu(self.cfg.get("menu", []), ids)}


def _menu_items(menu):
    """Percorre o "menu" do config.json: (grupo ou None, entrada do projeto)."""
    for entry in menu:
        if isinstance(entry, dict) and isinstance(entry.get("items"), list):
            for item in entry["items"]:
                if isinstance(item, dict) and item.get("project"):
                    yield entry.get("group"), item
        elif isinstance(entry, dict) and entry.get("project"):
            yield None, entry


def menu_index(menu):
    return {financing.key(item["project"]): {**item, "group": group} for group, item in _menu_items(menu)}


def build_menu(menu, ids):
    """Menu lateral com ids de projeto; projetos fora do menu vão para o fim, pela ordem dos ficheiros."""
    out, used, unmatched = [], set(), []
    for entry in menu:
        if not isinstance(entry, dict):
            continue
        if isinstance(entry.get("items"), list):
            items = []
            for item in entry["items"]:
                k = financing.key(item.get("project", ""))
                if k in ids:
                    items.append(ids[k])
                    used.add(k)
                elif item.get("project"):
                    unmatched.append(item["project"])
            if items:
                out.append({"group": entry.get("group") or "", "items": items})
        elif entry.get("project"):
            k = financing.key(entry["project"])
            if k in ids:
                out.append({"item": ids[k]})
                used.add(k)
            else:
                unmatched.append(entry["project"])
    out += [{"item": pid} for k, pid in ids.items() if k not in used]
    return {"menu": out, "menu_unmatched": unmatched}


def sharepoint_loop(client, interval):
    while True:
        time.sleep(interval)
        try:
            store.sync_sharepoint(client)
        except Exception as e:  # nunca deixar morrer a thread
            print(f"Erro na sincronização com o SharePoint: {e}", flush=True)


cfg = load_config()
store = Store(cfg)
sp_client = None
sp_init_error = None
uses_powerbi = bool(cfg["powerbi"].get("app_id") or cfg["powerbi"].get("dataset_id"))
if any(is_url(s) for s in cfg["sources"]) or uses_powerbi:
    try:
        sp_client = SharePointClient(cfg["sharepoint"], TOKEN_CACHE)
    except Exception as e:
        sp_init_error = str(e)
# Vendas (Power BI): mesma conta/App registration do SharePoint, permissão Dataset.Read.All
sales_store = None
sales_init_error = None
if uses_powerbi:
    if sp_client:
        sales_store = powerbi.SalesStore(powerbi.PowerBIClient(sp_client, cfg["powerbi"]),
                                         max(60, int(cfg["powerbi"]["poll_seconds"])))
    else:
        sales_init_error = f"Power BI: {sp_init_error}"
app = Flask(__name__, static_folder=None)


@app.get("/")
def index():
    return send_from_directory(os.path.join(BASE_DIR, "static"), "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(os.path.join(BASE_DIR, "static"), name)


@app.get("/project-images/<path:name>")
def project_images(name):
    return send_from_directory(IMAGES_DIR, name)


def full_version():
    """Versão dos ficheiros + da última leitura do Power BI (o browser recarrega quando muda)."""
    if not sales_store:
        return store.version
    st = sales_store.state()
    return f"{store.version}-{st['updated'] or 0:.0f}-{hash(st['error']) & 0xffff:x}"


@app.get("/api/version")
def api_version():
    store.refresh()
    return jsonify({"version": full_version()})


@app.get("/api/projects")
def api_projects():
    store.refresh()
    return jsonify({**store.snapshot(), "version": full_version()})


@app.get("/api/export.xlsx")
def api_export():
    store.refresh()
    snap = store.snapshot()
    wanted = request.args.get("id")
    by_id = {p["id"]: (f["group"], p) for f in snap["files"] for p in f["projects"]}
    order = [pid for m in snap["menu"] for pid in ([m["item"]] if "item" in m else m["items"])]
    projects = [by_id[pid] for pid in order if pid in by_id and (not wanted or pid == wanted)]
    if not projects:
        abort(404)
    buf = io.BytesIO()
    build_workbook(projects).save(buf)
    buf.seek(0)
    if wanted:
        group, p = projects[0]
        name = f"Project Review - {p['label']}.xlsx"
    else:
        name = f"Project Review - All projects - {time.strftime('%Y-%m-%d')}.xlsx"
    name = "".join(ch for ch in name if ch not in '\\/:*?"<>|')
    return send_file(buf, as_attachment=True, download_name=name,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


if __name__ == "__main__":
    port = int(cfg["port"])
    print("A ler ficheiros...")
    store.refresh()
    if any(is_url(s) for s in cfg["sources"]):
        if sp_client:
            try:
                sp_client.token()  # login (browser) antes de arrancar
            except Exception as e:
                print(f"  Login Microsoft falhou: {e}")
        store.sync_sharepoint(sp_client)
    snap = store.snapshot()
    for f in snap["files"]:
        status = f"ERRO: {f['error']}" if f["error"] else f"{len(f['projects'])} projeto(s)"
        print(f"  {f['file']}{' (SharePoint)' if f['remote'] else ''}: {status}")
    for m in snap["missing"]:
        print(f"  NÃO ENCONTRADO: {m}")
    for se in snap["source_errors"]:
        print(f"  SHAREPOINT ERRO: {se['source'][:80]}...\n    {se['error']}")
    all_p = [p for f in snap["files"] for p in f["projects"]]
    print(f"  Subrubricas do budget: {sum(1 for p in all_p if p.get('budget_link'))} de {len(all_p)} projetos")
    for p in all_p:
        if p["budget_missing"]:
            print(f"  BUDGET: folha \"{p['budget_missing']}\" não encontrada para {p['name']}")
    for name in snap["menu_unmatched"]:
        print(f"  MENU: projeto \"{name}\" não encontrado (o nome tem de ser igual ao do quadro)")
    n_fin = sum(1 for p in all_p if p["financing"])
    if snap["financing_error"]:
        print(f"  FINANCIAMENTO: {snap['financing_error']}")
    elif n_fin or snap["financing_unmatched"]:
        print(f"  Financiamento: {n_fin} contrato(s) associados a projetos")
    for name in snap["financing_unmatched"]:
        print(f"  FINANCIAMENTO SEM PROJETO: \"{name}\" (o nome tem de ser igual ao do dashboard)")
    if any(is_url(s) for s in cfg["sources"]):
        interval = max(15, int(cfg["sharepoint"]["poll_seconds"]))
        threading.Thread(target=sharepoint_loop, args=(sp_client, interval), daemon=True).start()
        print(f"  SharePoint: verifica alterações a cada {interval}s")
    if sales_store:
        sales_store.refresh()
        st = sales_store.state()
        print(f"  Vendas (Power BI): {len(st['data'])} projeto(s)" if not st["error"]
              else f"  VENDAS (Power BI): {st['error']}")
        threading.Thread(target=sales_store.loop, daemon=True).start()
    elif sales_init_error:
        print(f"  VENDAS: {sales_init_error}")
    url = f"http://localhost:{port}"
    print(f"\nDashboard em {url}  (Ctrl+C para parar)")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
