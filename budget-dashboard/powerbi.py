"""Vendas a partir do Power BI (relatório "vizta - sales dashboards").

Usa a mesma conta Microsoft e a mesma App registration do SharePoint
(config.json → "sharepoint"), com a permissão delegada do Power BI Service
"Dataset.Read.All". O relatório está numa App do Power BI: a partir do
app_id/report_id do link descobre-se o dataset e corre-se uma consulta DAX
(executeQueries) que devolve, por projeto, as unidades, áreas e valores por
tipologia e estado. É com isso que se monta o Typology Report.

A consulta DAX depende dos nomes das tabelas/colunas do modelo, que só se
conhecem depois de haver acesso: `python powerbi.py --probe` lista-os.

Formato esperado das linhas da consulta (nomes das colunas configuráveis em
config.json → "powerbi" → "columns"):
    project, status, typology, units, amount, area
"""

import re
import sys
import threading
import time

import requests

API = "https://api.powerbi.com/v1.0/myorg"
SCOPES = ["https://analysis.windows.net/powerbi/api/Dataset.Read.All"]

# Estados do Typology Report, pela ordem do Power BI
STATUSES = [("PSPA", "PSPA"), ("Reserved", "Reserved"),
            ("Off-market", "Off-market units"), ("Available", "Available to sell units")]
DEFAULT_COLUMNS = {"project": "project", "status": "status", "typology": "typology",
                   "units": "units", "amount": "amount", "area": "area"}


class PowerBIError(Exception):
    pass


def _clean_key(k):
    """'Table[Column]' / '[Measure]' -> 'Column' / 'Measure' (executeQueries devolve assim)."""
    m = re.search(r"\[([^\]]+)\]\s*$", k)
    return m.group(1) if m else k


def _status_key(text):
    t = str(text or "").strip().lower()
    if t.startswith("pspa") or "cpcv" in t:
        return "PSPA"
    if t.startswith("reserv"):
        return "Reserved"
    if t.startswith("off"):
        return "Off-market"
    if t.startswith("avail"):
        return "Available"
    return None


def _typology_order(t):
    m = re.match(r"T(\d+)(\+(\d+))?", t or "", re.I)
    return (0, int(m.group(1)), int(m.group(3) or 0), t) if m else (1, 0, 0, str(t))


def build_typology(rows, columns=None):
    """Linhas da consulta -> {projeto normalizado: typology report}.

    Os totais e percentagens são somas e divisões dos valores devolvidos pelo
    Power BI (como no relatório): Reserved + PSPA, Off-market + Available, total.
    Tipologias começadas por "R"/"Retail"/"Loja" contam como retalho.
    """
    cols = {**DEFAULT_COLUMNS, **(columns or {})}
    out = {}
    for raw in rows:
        r = {_clean_key(k): v for k, v in raw.items()}
        get = lambda key: r.get(cols[key])
        project, status = get("project"), _status_key(get("status"))
        if not project or not status:
            continue
        typ = str(get("typology") or "—").strip()
        retail = bool(re.match(r"^(r\b|retail|loja|comerc)", typ, re.I))
        p = out.setdefault(" ".join(str(project).split()).casefold(), {
            "project": str(project), "typologies": set(),
            "rows": {s: {"units": {}, "retail_units": 0, "amount": 0.0, "area": 0.0, "retail_amount": 0.0}
                     for s, _ in STATUSES}})
        row = p["rows"][status]
        units = float(get("units") or 0)
        if retail:
            row["retail_units"] += units
            row["retail_amount"] += float(get("amount") or 0)
        else:
            p["typologies"].add(typ)
            row["units"][typ] = row["units"].get(typ, 0) + units
            row["amount"] += float(get("amount") or 0)
            row["area"] += float(get("area") or 0)
    for p in out.values():
        p["typologies"] = sorted(p["typologies"], key=_typology_order)
        p["rows"] = [{"status": s, "label": label, **p["rows"][s]} for s, label in STATUSES]
    return out


def load_snapshot(path):
    """sales_snapshot.json (Typology Report transcrito do Power BI) -> (dados, data/hora, erro).

    Cada projeto fica já no formato de apresentação ("units"/"amounts" com os
    valores tal como aparecem no Power BI, incluindo totais, % e €/m²).
    """
    import json
    import os
    if not os.path.exists(path):
        return {}, None, None
    try:
        with open(path, encoding="utf-8-sig") as f:
            raw = json.load(f)
        typ = raw.get("_typologies") or []
        out = {}
        for name, s in raw.items():
            if name.startswith("_") or not isinstance(s, dict):
                continue
            out[" ".join(name.split()).casefold()] = {
                "project": name, "typologies": typ,
                "units_rows": [{"label": r[0], "kind": r[1], "units": dict(zip(typ, r[2])), "total": r[3],
                                "pct": r[4], "retail": r[5], "resi_retail": r[6]} for r in s.get("units", [])],
                "amount_rows": [{"label": r[0], "kind": r[1], "residential": r[2], "price_sqm": r[3],
                                 "pct": r[4], "retail": r[5], "resi_retail": r[6]} for r in s.get("amounts", [])],
            }
        return out, raw.get("_as_of"), None
    except (OSError, ValueError, IndexError, TypeError) as e:
        return {}, None, f"sales_snapshot.json inválido: {e}"


class PowerBIClient:
    def __init__(self, auth, pbi_cfg):
        """auth: objeto com token(scopes) (o SharePointClient)."""
        self.auth = auth
        self.cfg = pbi_cfg
        self.session = requests.Session()
        self._dataset_id = pbi_cfg.get("dataset_id")

    def _call(self, method, url, **kw):
        r = self.session.request(method, url, timeout=120,
                                 headers={"Authorization": f"Bearer {self.auth.token(SCOPES)}"}, **kw)
        if r.status_code >= 400:
            try:
                err = r.json().get("error", {})
                msg = f"{err.get('code')}: {err.get('message') or err.get('pbi.error', '')}"
            except ValueError:
                msg = r.text[:300]
            raise PowerBIError(f"HTTP {r.status_code} {msg}")
        return r.json()

    def dataset_id(self):
        if not self._dataset_id:
            app_id, report_id = self.cfg.get("app_id"), self.cfg.get("report_id")
            if not app_id or not report_id:
                raise PowerBIError("Falta 'powerbi.app_id' / 'powerbi.report_id' no config.json")
            rep = self._call("GET", f"{API}/apps/{app_id}/reports/{report_id}")
            self._dataset_id = rep.get("datasetId")
            if not self._dataset_id:
                raise PowerBIError("O relatório não indica o dataset (datasetId)")
        return self._dataset_id

    def query(self, dax):
        body = {"queries": [{"query": dax}], "serializerSettings": {"includeNulls": True}}
        res = self._call("POST", f"{API}/datasets/{self.dataset_id()}/executeQueries", json=body)
        try:
            return res["results"][0]["tables"][0]["rows"]
        except (KeyError, IndexError):
            raise PowerBIError(f"Resposta inesperada do Power BI: {str(res)[:300]}")

    def typology(self):
        dax = self.cfg.get("typology_query")
        if not dax:
            raise PowerBIError("Falta 'powerbi.typology_query' (consulta DAX) no config.json — "
                               "corre 'python powerbi.py --probe' para ver as tabelas do modelo.")
        return build_typology(self.query(dax), self.cfg.get("columns"))


class SalesStore:
    """Lê o Power BI de tempos a tempos (por omissão 15 min) e guarda o último resultado válido."""

    def __init__(self, client, interval):
        self.client = client
        self.interval = interval
        self.data, self.error, self.updated = {}, None, None
        self.lock = threading.Lock()

    def refresh(self):
        try:
            data = self.client.typology()
            with self.lock:
                self.data, self.error, self.updated = data, None, time.time()
        except Exception as e:  # mantém os últimos dados válidos
            with self.lock:
                self.error = f"{type(e).__name__}: {e}"

    def loop(self):
        while True:
            time.sleep(self.interval)
            self.refresh()

    def state(self):
        with self.lock:
            return {"data": self.data, "error": self.error, "updated": self.updated}


if __name__ == "__main__":
    # python powerbi.py --probe : mostra o dataset e as tabelas/colunas do modelo
    import json
    import os
    from sharepoint import SharePointClient

    base = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(base, "config.json"), encoding="utf-8-sig") as f:
        cfg = json.load(f)
    client = PowerBIClient(SharePointClient(cfg.get("sharepoint", {}), os.path.join(base, "token_cache.json")),
                           cfg.get("powerbi", {}))
    print("Dataset:", client.dataset_id())
    if "--probe" in sys.argv:
        for dax in ("EVALUATE INFO.VIEW.COLUMNS()", "EVALUATE INFO.VIEW.MEASURES()"):
            try:
                rows = client.query(dax)
                print(f"\n{dax}: {len(rows)} linhas")
                for r in rows:
                    r = {_clean_key(k): v for k, v in r.items()}
                    print("  ", r.get("Table"), "|", r.get("Name"), "|", r.get("Expression", "")[:80])
            except PowerBIError as e:
                print(f"\n{dax}: {e}")
    elif client.cfg.get("typology_query"):
        print(json.dumps(client.typology(), ensure_ascii=False, indent=1, default=list)[:4000])
