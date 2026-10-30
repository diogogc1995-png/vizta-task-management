"""Evolução mensal de CPCV e reservas por projeto (Master Vendas, folha "Master Real Price").

Uma linha por fração: projeto, preço de aquisição, data do CPCV (PSA) e data da reserva. O valor de cada
mês é a soma dos preços de aquisição das frações com CPCV / reserva nesse mês (em €), como no gráfico
"PSPA / Reservation" do Power BI. Os nomes dos projetos ligam-se aos do dashboard por config.json →
"sales_pace" → "projects".
"""

import datetime as dt
import os
import re
import tempfile
import unicodedata

from budget_parser import _load, copy_shared

SHEET = "master real price"
COLS = {"project": r"^project$", "price": r"^acquisition price", "psa": r"^psa signed date", "res": r"^reservation date"}


def _norm(v):
    s = unicodedata.normalize("NFKD", str(v)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().casefold()


def _month(v):
    return v.strftime("%Y-%m") if isinstance(v, (dt.datetime, dt.date)) else None


def parse_rows(rows):
    """{projeto: {"AAAA-MM": [cpcv €, reservas €]}}"""
    head = next((i for i, r in enumerate(rows) if any(isinstance(v, str) and _norm(v) == "project" for v in r)), None)
    if head is None:
        raise ValueError("cabeçalho 'Project' não encontrado")
    cols = {}
    for j, v in enumerate(rows[head]):
        if isinstance(v, str):
            for k, pat in COLS.items():
                if k not in cols and re.match(pat, _norm(v)):
                    cols[k] = j
    missing = [k for k in COLS if k not in cols]
    if missing:
        raise ValueError("colunas em falta: " + ", ".join(missing))
    out = {}
    for r in rows[head + 1:]:
        g = lambda k: r[cols[k]] if cols[k] < len(r) else None
        proj, price = g("project"), g("price")
        if not isinstance(proj, str) or not proj.strip() or not isinstance(price, (int, float)) or not price:
            continue
        months = out.setdefault(proj.strip(), {})
        for i, k in ((0, "psa"), (1, "res")):
            m = _month(g(k))
            if m:
                months.setdefault(m, [0, 0])[i] += price
    return out


def read_file(path):
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        copy_shared(path, tmp)
        wb = _load(tmp)
        try:
            name = next((n for n in wb.sheetnames if _norm(n) == SHEET), None)
            if not name:
                raise ValueError("folha 'Master Real Price' não encontrada")
            rows = [tuple(r) for r in wb[name].iter_rows(max_col=40, values_only=True)]
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return parse_rows(rows)


def series(months, until=None):
    """Meses seguidos (do primeiro com movimento até `until`, AAAA-MM) com os valores em M€."""
    if not months:
        return None
    keys = sorted(months)
    last = max(keys[-1], until or keys[-1])
    y, m = map(int, keys[0].split("-"))
    out = {"months": [], "pspa": [], "res": []}
    while True:
        k = f"{y:04d}-{m:02d}"
        v = months.get(k, [0, 0])
        out["months"].append(k)
        out["pspa"].append(round(v[0] / 1e6, 2))
        out["res"].append(round(v[1] / 1e6, 2))
        if k >= last:
            break
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def by_project(data, mapping, until=None):
    names = {_norm(k): v for k, v in (mapping or {}).items()}
    out = {}
    for proj, months in data.items():
        target = names.get(_norm(proj))
        if target:
            out[" ".join(target.split()).casefold()] = series(months, until)
    return out
