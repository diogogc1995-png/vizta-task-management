"""Roadmap dos projetos a partir do ficheiro "RM mensuelle Portugal" (folha "RM Portugal AllUpdate").

As colunas são encontradas pelos cabeçalhos (PSPA, Acquisition Date, Projeto
Base, Licensing/Permit, Commercial Launch, Construction, End of deliveries);
Licensing e Construction têm "Start"/"End" na linha seguinte. A zona (coluna B)
vale para as linhas seguintes até aparecer outra. As linhas a mostrar, a ordem e
os nomes vêm de config.json → "roadmap" → "rows".
"""

import datetime as dt
import os
import re
import tempfile

from budget_parser import _load, copy_shared

HEADERS = {
    "pspa": r"^PSPA$",
    "acquisition": r"^Acquisition Date",
    "projeto_base": r"^Projeto Base",
    "licensing": r"^Licensing",
    "launch": r"^Commercial Launch",
    "construction": r"^Construction$",
    "end_deliveries": r"^End of deliveries",
    "apartments": r"^Nb\.? Apartments",
    "name": r"^BUILDING NAMES",
    # vendas (residential units), mais à direita na folha
    "pct_pspa": r"^% PSPA",
    "pct_deeds": r"^% Final deeds",
    "pct_sold": r"^% Total sold",
    "pct_reserved": r"^% Units reserved",
    "units_market": r"^Units in the market",
}


def _norm(v):
    return " ".join(str(v).split()) if v is not None else ""


def _val(v):
    """Número, ou o texto da célula ("n/a", "-"); vazio -> None."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    t = _norm(v)
    return t or None


def _date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def _find_columns(grid):
    """{campo: índice} e a linha onde acabam os cabeçalhos."""
    cols, last = {}, 0
    for r, row in enumerate(grid[:15]):
        for c, v in enumerate(row):
            t = _norm(v)
            for key, pat in HEADERS.items():
                if key not in cols and t and re.match(pat, t, re.I):
                    cols[key] = c
                    last = max(last, r)
    return cols, last


def parse_sheet(grid):
    """Linhas do roadmap (todas as que têm nome), com a zona herdada da coluna B."""
    cols, head = _find_columns(grid)
    missing = [k for k in ("launch", "construction", "end_deliveries") if k not in cols]
    if missing:
        raise ValueError(f"cabeçalhos não encontrados: {', '.join(missing)}")
    name_c = cols.get("name", 2)
    area_c = max(0, name_c - 1)
    get = lambda row, c: row[c] if c is not None and c < len(row) else None
    out, area = [], ""
    for row in grid[head + 1:]:
        own_area = _norm(get(row, area_c))
        if own_area:
            area = own_area
        c = lambda key, off=0: get(row, cols[key] + off) if key in cols else None
        name = _norm(get(row, name_c))
        if not name and own_area and _date(c("end_deliveries")):
            name = own_area  # p.ex. "Vilamoura": projeto sem nome próprio na coluna C
        if not name or name.lower().startswith("info changes"):
            continue
        out.append({
            "area": area, "name": name,
            "apartments": c("apartments") if isinstance(c("apartments"), (int, float)) else None,
            "pspa": _date(c("pspa")),
            "acquisition": _date(c("acquisition")),
            "projeto_base": _date(c("projeto_base")),
            "licensing_start": _date(c("licensing")), "licensing_end": _date(c("licensing", 1)),
            "launch": _date(c("launch")),
            "construction_start": _date(c("construction")), "construction_end": _date(c("construction", 1)),
            "end_deliveries": _date(c("end_deliveries")),
            **{k: _val(c(k)) for k in ("pct_pspa", "pct_deeds", "pct_sold", "pct_reserved", "units_market")},
        })
    return out


def _key(s):
    return " ".join(str(s or "").split()).casefold()


def load(path, sheet, rows_conf):
    """Lê o ficheiro e devolve as linhas configuradas, pela ordem do config."""
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        copy_shared(path, tmp)
        wb = _load(tmp)
        try:
            if sheet not in wb.sheetnames:
                raise ValueError(f"folha '{sheet}' não encontrada")
            grid = [tuple(r) for r in wb[sheet].iter_rows(max_row=120, max_col=170, values_only=True)]
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    rows = parse_sheet(grid)
    out, unmatched = [], []
    for conf in rows_conf:
        want_area, want_name = _key(conf.get("area_match")), _key(conf.get("name_match"))
        in_area = [r for r in rows if not want_area or _key(r["area"]).startswith(want_area)]
        # nome exato primeiro ("Flower Tower I" não pode apanhar "Flower Tower II"), depois "começa por"
        hit = (next((r for r in in_area if _key(r["name"]) == want_name), None)
               or next((r for r in in_area if _key(r["name"]).startswith(want_name)), None))
        if not hit:
            unmatched.append(conf.get("label") or conf.get("name_match"))
            continue
        # unidades de outra linha da mesma zona a somar à parte (p.ex. NOLA "111 (+42)": Donation)
        plus = next((r for r in in_area if conf.get("plus_match") and _key(r["name"]) == _key(conf["plus_match"])), None)
        out.append({**hit, "group": conf.get("group") or hit["area"], "label": conf.get("label") or hit["name"],
                    "project": conf.get("project"), "extra_units": plus["apartments"] if plus else None})
    return out, unmatched
