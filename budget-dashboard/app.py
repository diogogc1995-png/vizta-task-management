"""Budget Dashboard.

Lê os ficheiros Excel indicados em config.json (pastas do OneDrive sincronizadas
e/ou links do SharePoint), deteta as
folhas de Project Review e serve o dashboard em http://localhost:<port>.
Os ficheiros são relidos automaticamente quando mudam.

Uso:  python app.py            (no PC: abre o browser, login com a tua conta)
      python app.py --server   (no servidor: waitress, identidade da aplicação; ver deploy/DEPLOY.md)
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
import legal
import powerbi
import roadmap
import status_report
from budget_parser import apply_versions, attach_budget_details, parse_file
from excel_export import build_workbook
from sharepoint import SharePointClient, is_url

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.environ.get("BUDGET_DASHBOARD_CONFIG") or os.path.join(BASE_DIR, "config.json")
FINANCING_PATH = os.environ.get("BUDGET_DASHBOARD_FINANCING") or os.path.join(BASE_DIR, "financing.json")
INFO_PATH = os.environ.get("BUDGET_DASHBOARD_INFO") or os.path.join(BASE_DIR, "project_info.json")
IMAGES_DIR = os.path.join(BASE_DIR, "project_images")
SALES_SNAPSHOT_PATH = os.path.join(BASE_DIR, "sales_snapshot.json")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
# No servidor (IIS / HttpPlatformHandler a porta vem em HTTP_PLATFORM_PORT)
SERVER_MODE = "--server" in sys.argv or bool(os.environ.get("HTTP_PLATFORM_PORT"))
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
    # Ficheiros de dados: caminho local ou link do SharePoint (no servidor ficam numa pasta do SharePoint)
    cfg.setdefault("data", {})
    return cfg


def data_sources(cfg):
    """{chave: caminho ou link} dos ficheiros de dados (variáveis de ambiente > config.json > pasta da app)."""
    d = cfg.get("data", {})
    return {
        "financing": os.environ.get("BUDGET_DASHBOARD_FINANCING") or d.get("financing") or FINANCING_PATH,
        "project_info": os.environ.get("BUDGET_DASHBOARD_INFO") or d.get("project_info") or INFO_PATH,
        "sales_snapshot": d.get("sales_snapshot") or SALES_SNAPSHOT_PATH,
        "images": d.get("images") or IMAGES_DIR,
        "roadmap": (cfg.get("roadmap") or {}).get("file"),
        **{f"ps{i}": f for i, f in enumerate((cfg.get("ponto_situacao") or {}).get("files", []))},
    }


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
        # Roadmap (ficheiro "RM mensuelle Portugal")
        self.rm_rows, self.rm_unmatched, self.rm_error, self.rm_sig = [], [], None, None
        self.version = ""
        self.data_src = data_sources(cfg)
        self.extra_sigs = {}  # cópias do SharePoint: chave do item -> cTag
        # Informação societária (certidões permanentes): lida em segundo plano, PDFs em cache
        self.legal, self.legal_error, self.legal_sig, self.legal_folder = {}, None, None, None
        self.legal_cache = {}
        self.legal_lock = threading.Lock()
        # Ponto de situação (atas): pontos Pendente/Standby por projeto
        self.ps, self.ps_unmatched, self.ps_error, self.ps_sig, self.ps_files = {}, [], None, None, []
        self.ps_try = 0

    def data_path(self, key):
        """Caminho local de um ficheiro de dados (a cópia descarregada, se for um link do SharePoint)."""
        src = self.data_src.get(key)
        if not src:
            return None
        if not is_url(src):
            return _expand(src)
        if key == "images":
            return os.path.join(CACHE_DIR, "images")
        ext = ".xlsx" if key == "roadmap" or key.startswith("ps") else ".json"
        return os.path.join(CACHE_DIR, "data", key + ext)

    def remote_data(self):
        return {k: v for k, v in self.data_src.items() if v and is_url(v)}

    def _update_version(self):
        state = json.dumps(
            [(k, e["sig"], e["error"]) for k, e in sorted(self.files.items())]
            + self.missing + sorted(self.source_errors.items())
            + [self.financing_sig, self.financing_error, self.info_sig, self.info_error,
               self.snap_sig, self.snap_error, self.rm_sig, self.rm_error,
               self.legal_sig, self.legal_error, self.ps_sig, self.ps_error], default=str)
        self.version = hashlib.sha1(state.encode()).hexdigest()[:12]

    def _refresh_financing(self):
        fin_path, info_path, snap_path = (self.data_path(k) for k in ("financing", "project_info", "sales_snapshot"))
        try:
            st = os.stat(fin_path)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.financing_sig:
            self.financing, self.financing_error = financing.load(fin_path)
            self.financing_sig = sig
        try:
            st = os.stat(info_path)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.info_sig:
            self.info, self.info_error = financing.load_map(info_path)
            self.info_sig = sig
        try:
            st = os.stat(snap_path)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        if sig != self.snap_sig:
            self.snap, self.snap_as_of, self.snap_error = powerbi.load_snapshot(snap_path)
            self.snap_sig = sig
        self._refresh_roadmap()
        self._refresh_status()

    def _refresh_status(self):
        """Atas do ponto de situação: relê quando algum ficheiro muda (ou de minuto a minuto após erro)."""
        conf = self.cfg.get("ponto_situacao") or {}
        keys = [k for k in self.data_src if k.startswith("ps")]
        if not keys:
            return
        paths = [self.data_path(k) for k in keys]
        sig = []
        for path in paths:
            try:
                st = os.stat(path)
                sig.append((path, st.st_mtime, st.st_size))
            except OSError:
                sig.append((path, None, None))
        retry = self.ps_error and time.time() - self.ps_try > 60
        if sig == self.ps_sig and not retry:
            return
        self.ps_try = time.time()
        items, errors, files = [], [], []
        for (path, mtime, _), src in zip(sig, (self.data_src[k] for k in keys)):
            name = os.path.basename(src.split("?")[0]) if is_url(src) else os.path.basename(path)
            if mtime is None:
                errors.append(f"não encontrado: {name}")
                continue
            try:
                items += status_report.read_file(path, conf.get("sheet", "ATA"))
                files.append({"name": name, "modified": mtime})
            except Exception as e:  # ficheiro aberto/bloqueado: mantém os últimos dados
                errors.append(f"{name}: {type(e).__name__}: {e}")
        if not errors or items:
            self.ps, self.ps_unmatched = status_report.group_by_project(items, conf.get("projects"))
            self.ps_files = files
        self.ps_error = ("Ponto de situação: " + "; ".join(errors)) if errors else None
        self.ps_sig = sig

    def _refresh_roadmap(self):
        rm = self.cfg.get("roadmap") or {}
        if not rm.get("file"):
            return
        path = self.data_path("roadmap")
        try:
            st = os.stat(path)
            sig = (st.st_mtime, st.st_size)
        except OSError:
            sig = None
        retry = self.rm_error and sig and time.time() - getattr(self, "rm_try", 0) > 60
        if sig == self.rm_sig and not retry:
            return
        self.rm_try = time.time()
        if sig is None:
            self.rm_error = f"Ficheiro do roadmap não encontrado: {rm['file']}"
        else:
            try:
                self.rm_rows, self.rm_unmatched = roadmap.load(path, rm.get("sheet", "RM Portugal AllUpdate"),
                                                               rm.get("rows", []))
                self.rm_error = None
            except Exception as e:  # ficheiro aberto/bloqueado: mantém os últimos dados e tenta de novo
                self.rm_error = f"Roadmap: {type(e).__name__}: {e}"
        self.rm_sig = sig

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

    def sync_data(self, client):
        """Ficheiros de dados no SharePoint (JSON, imagens, roadmap): descarrega os que mudaram."""
        for key, url in self.remote_data().items():
            try:
                if client is None:
                    raise RuntimeError(sp_init_error or "SharePoint não configurado")
                dest = self.data_path(key)
                if key == "images":
                    os.makedirs(dest, exist_ok=True)
                    items = client.list_files(url, IMAGE_EXT, recursive=False)
                else:
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    items = client.list_files(url, (".json", ".xlsx", ".xlsm"))[:1]
                for it in items:
                    target = os.path.join(dest, it["name"]) if key == "images" else dest
                    if self.extra_sigs.get(it["key"]) == it["sig"] and os.path.exists(target):
                        continue
                    client.download(it, target)
                    self.extra_sigs[it["key"]] = it["sig"]
                with self.lock:
                    self.source_errors.pop(url, None)
            except Exception as e:  # mantém a última cópia
                with self.lock:
                    self.source_errors[url] = f"{type(e).__name__}: {e}"
        with self.lock:
            self._refresh_financing()
            self._update_version()

    def refresh_legal(self, client=None):
        """Lê as certidões permanentes das sociedades (config.json -> "legal"). Demora: corre numa thread."""
        conf = self.cfg.get("legal") or {}
        if not conf.get("folder"):
            return
        with self.legal_lock:  # nunca duas leituras ao mesmo tempo
            folder = conf["folder"]
            try:
                if is_url(folder):  # servidor: copia do SharePoint só certidões, estatutos e RCBE
                    local = os.path.join(CACHE_DIR, "legal")
                    if client is None:
                        raise RuntimeError(sp_init_error or "SharePoint não configurado")
                    for company in sorted(set((conf.get("companies") or {}).values())):
                        for rel, it in client.walk(folder, company, lambda n: bool(legal.SKIP_DIRS.match(n))):
                            if not legal.wanted_name(it["name"]):
                                continue
                            dest = os.path.join(local, company, *rel.split("/"))
                            if self.extra_sigs.get(it["key"]) == it["sig"] and os.path.exists(dest):
                                continue
                            os.makedirs(os.path.dirname(dest), exist_ok=True)
                            client.download(it, dest)
                            if it.get("modified"):
                                os.utime(dest, (it["modified"], it["modified"]))
                            self.extra_sigs[it["key"]] = it["sig"]
                else:
                    local = _expand(folder)
                data, err = legal.load({**conf, "folder": local}, self.legal_cache)
            except Exception as e:  # mantém os últimos dados
                data, err = self.legal, f"Legal: {type(e).__name__}: {e}"
            sig = hashlib.sha1(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:12]
            with self.lock:
                self.legal, self.legal_error, self.legal_sig, self.legal_folder = data, err, sig, local
                self._update_version()

    def data_src_has_ps(self):
        return any(k.startswith("ps") for k in self.data_src)

    def legal_view(self, name):
        """Dados societários de um projeto para o browser: links do SharePoint em vez de caminhos locais."""
        info = self.legal.get(financing.key(name)) if self.legal else None
        if not info:
            return None
        conf = self.cfg.get("legal") or {}
        web = conf.get("web_folder") or (conf["folder"] if is_url(conf.get("folder", "")) else None)
        if web and is_url(conf.get("folder", "")) and "?" in web:
            web = None  # link de partilha: não dá para montar o caminho dos ficheiros
        out = {k: v for k, v in info.items() if not k.endswith("_file")}
        for k in ("crc", "statutes", "rcbe"):
            out[k + "_url"] = legal.web_link(info.get(k + "_file"), self.legal_folder, web)
        if web and info.get("company"):
            out["folder_url"] = legal.web_link(os.path.join(self.legal_folder, info["company"]), self.legal_folder, web)
        return out

    def sync_sharepoint(self, client):
        """Ficheiros do SharePoint: compara o cTag de cada ficheiro e descarrega os que mudaram."""
        os.makedirs(CACHE_DIR, exist_ok=True)
        self.sync_data(client)
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
                                     "legal": self.legal_view(p["name"]),
                                     "status_items": (self.ps.get(k, []) if self.data_src_has_ps() else None),
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
                    "legal_error": self.legal_error,
                    "status_report": {"files": self.ps_files, "error": self.ps_error, "unmatched": self.ps_unmatched},
                    # entradas do project_info.json sem projeto no dashboard (p.ex. Turquesa, só no Summary)
                    "info_extra": [v for k, v in self.info.items() if k not in ids],
                    "roadmap": {"rows": [{**r, "project_id": ids.get(financing.key(r["project"])) if r.get("project") else None}
                                         for r in self.rm_rows],
                                "unmatched": self.rm_unmatched, "error": self.rm_error,
                                "from_year": (self.cfg.get("roadmap") or {}).get("from_year"),
                                "modified": self.rm_sig[0] if self.rm_sig else None,
                                "sheet": (self.cfg.get("roadmap") or {}).get("sheet")},
                    "financing_unmatched": sorted(c["project"] for k, c in self.financing.items()
                                                  if k not in matched),
                    "orion": build_orion(self.cfg.get("orion") or {}, ids, self.info),
                    **build_menu(self.cfg.get("menu", []), ids)}


def build_orion(conf, ids, info):
    """Apresentação "Project Review - Orion": projetos e slides de cada um, pela ordem do config.json.
    Projetos sem quadro de Project Review (p.ex. Turquesa) levam os dados do project_info.json."""
    out = []
    for entry in conf.get("projects", []):
        k = financing.key(entry["project"])
        out.append({"project": entry["project"], "id": ids.get(k), "slides": entry.get("slides", []),
                    "subtitles": entry.get("subtitles", {}),
                    "info": None if k in ids else info.get(k)})
    return {"projects": out}


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


def legal_loop(client, interval):
    """Certidões permanentes: primeira leitura logo no arranque, depois de tempos a tempos."""
    while True:
        try:
            store.refresh_legal(client)
        except Exception as e:
            print(f"Erro na leitura das certidões: {e}", flush=True)
        time.sleep(interval)


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
uses_powerbi = bool(cfg["powerbi"].get("app_id") or cfg["powerbi"].get("dataset_id")
                    or cfg["powerbi"].get("workspace_id"))
uses_sharepoint = (any(is_url(s) for s in cfg["sources"]) or bool(store.remote_data())
                   or is_url((cfg.get("legal") or {}).get("folder", "")))
if uses_sharepoint or uses_powerbi:
    try:
        sp_client = SharePointClient(cfg["sharepoint"], TOKEN_CACHE)
        if SERVER_MODE:
            sp_client.interactive = False  # no servidor ninguém pode fazer login no browser
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
    return send_from_directory(store.data_path("images"), name)


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
    try:
        chosen = json.loads(request.args.get("versions") or "{}")  # {id: [comparação, referência]}
    except ValueError:
        chosen = {}
    by_id = {p["id"]: (f["group"], apply_versions(p, chosen[p["id"]]) if p["id"] in chosen else p)
             for f in snap["files"] for p in f["projects"]}
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
    port = int(os.environ.get("HTTP_PLATFORM_PORT") or cfg["port"])
    print("A ler ficheiros...")
    if SERVER_MODE and sp_client and not sp_client.app_only:
        print("  AVISO: no servidor configura 'sharepoint.client_secret' (ou BUDGET_DASHBOARD_CLIENT_SECRET) "
              "ou 'sharepoint.certificate' — ver deploy/DEPLOY.md")
    store.refresh()
    if uses_sharepoint:
        if sp_client and not SERVER_MODE:
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
    if uses_sharepoint:
        interval = max(15, int(cfg["sharepoint"]["poll_seconds"]))
        threading.Thread(target=sharepoint_loop, args=(sp_client, interval), daemon=True).start()
        print(f"  SharePoint: verifica alterações a cada {interval}s")
    if cfg.get("legal", {}).get("folder"):
        interval = max(60, int(cfg["legal"].get("poll_seconds", 600)))
        threading.Thread(target=legal_loop, args=(sp_client, interval), daemon=True).start()
        print(f"  Legal: certidões permanentes lidas em segundo plano (a cada {interval}s)")
    if sales_store:
        sales_store.refresh()
        st = sales_store.state()
        print(f"  Vendas (Power BI): {len(st['data'])} projeto(s)" if not st["error"]
              else f"  VENDAS (Power BI): {st['error']}")
        threading.Thread(target=sales_store.loop, daemon=True).start()
    elif sales_init_error:
        print(f"  VENDAS: {sales_init_error}")
    host = cfg.get("host", "127.0.0.1")
    url = f"http://localhost:{port}"
    print(f"\nDashboard em {url}  (Ctrl+C para parar)", flush=True)
    if SERVER_MODE:
        from waitress import serve  # servidor de produção (pip install waitress)
        serve(app, host=host, port=port, threads=int(cfg.get("threads", 8)))
    else:
        if "--no-browser" not in sys.argv:
            threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        app.run(host=host, port=port, debug=False, threaded=True)
