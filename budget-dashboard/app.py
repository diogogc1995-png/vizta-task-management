"""Budget Dashboard — servidor local.

Lê os ficheiros Excel indicados em config.json (pastas do OneDrive), deteta as
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

from budget_parser import parse_workbook
from excel_export import build_workbook

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
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
    return cfg


def _expand(p):
    return os.path.normpath(os.path.expanduser(os.path.expandvars(p)))


def list_files(sources):
    """Ficheiros Excel a ler: caminhos diretos ou todos os .xlsx/.xlsm de uma pasta."""
    files, missing = [], []
    for src in sources:
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


class Store:
    """Cache dos ficheiros lidos; relê um ficheiro só quando o mtime/tamanho muda."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.files = {}  # path -> {"sig", "projects", "error", "loaded_at"}
        self.missing = []
        self.version = ""

    def refresh(self):
        with self.lock:
            paths, self.missing = list_files(self.cfg["sources"])
            for gone in set(self.files) - set(paths):
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
                try:
                    projects = parse_workbook(path, self.cfg["include_hidden_sheets"])
                    self.files[path] = {"sig": sig, "projects": projects,
                                        "error": None, "loaded_at": time.time()}
                except Exception as e:  # ficheiro a meio de sincronizar, corrompido, ...
                    # Mantém os últimos dados válidos e tenta outra vez no próximo ciclo.
                    old = entry or {"projects": [], "loaded_at": None}
                    self.files[path] = {"sig": None, "projects": old["projects"],
                                        "error": f"{type(e).__name__}: {e}",
                                        "loaded_at": old["loaded_at"]}
            state = json.dumps(
                [(p, e["sig"], e["error"]) for p, e in sorted(self.files.items())]
                + self.missing, default=str)
            self.version = hashlib.sha1(state.encode()).hexdigest()[:12]

    def snapshot(self):
        with self.lock:
            files = []
            for path, e in sorted(self.files.items(), key=lambda kv: os.path.basename(kv[0]).lower()):
                projects = []
                for p in e["projects"]:
                    pid = hashlib.sha1(f"{path}|{p['sheet']}".encode()).hexdigest()[:10]
                    projects.append({**p, "id": pid})
                files.append({
                    "file": os.path.basename(path),
                    "group": os.path.splitext(os.path.basename(path))[0],
                    "path": path,
                    "modified": e["sig"][0] if e["sig"] else None,
                    "loaded_at": e["loaded_at"],
                    "error": e["error"],
                    "projects": projects,
                })
            return {"version": self.version, "files": files, "missing": list(self.missing)}


cfg = load_config()
store = Store(cfg)
app = Flask(__name__, static_folder=None)


@app.get("/")
def index():
    return send_from_directory(os.path.join(BASE_DIR, "static"), "index.html")


@app.get("/static/<path:name>")
def static_files(name):
    return send_from_directory(os.path.join(BASE_DIR, "static"), name)


@app.get("/api/version")
def api_version():
    store.refresh()
    return jsonify({"version": store.version})


@app.get("/api/projects")
def api_projects():
    store.refresh()
    return jsonify(store.snapshot())


@app.get("/api/export.xlsx")
def api_export():
    store.refresh()
    snap = store.snapshot()
    wanted = request.args.get("id")
    projects = [(f["group"], p) for f in snap["files"] for p in f["projects"]
                if not wanted or p["id"] == wanted]
    if not projects:
        abort(404)
    buf = io.BytesIO()
    build_workbook(projects).save(buf)
    buf.seek(0)
    if wanted:
        group, p = projects[0]
        name = f"Project Review - {group} - {p['name']}.xlsx"
    else:
        name = f"Project Review - All projects - {time.strftime('%Y-%m-%d')}.xlsx"
    name = "".join(ch for ch in name if ch not in '\\/:*?"<>|')
    return send_file(buf, as_attachment=True, download_name=name,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


if __name__ == "__main__":
    port = int(cfg["port"])
    print("A ler ficheiros...")
    store.refresh()
    snap = store.snapshot()
    for f in snap["files"]:
        status = f"ERRO: {f['error']}" if f["error"] else f"{len(f['projects'])} projeto(s)"
        print(f"  {f['file']}: {status}")
    for m in snap["missing"]:
        print(f"  NÃO ENCONTRADO: {m}")
    url = f"http://localhost:{port}"
    print(f"\nDashboard em {url}  (Ctrl+C para parar)")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
