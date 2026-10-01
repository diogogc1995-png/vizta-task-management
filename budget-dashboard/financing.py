"""Contratos de financiamento por projeto (financing.json, fora do Git).

Cada entrada tem como chave o nome do projeto tal como aparece no dashboard
(p.ex. "PLENO I"). A maturidade e o fim do período de utilização são
calculados a partir da data da escritura e dos prazos em meses.
"""

import calendar
import datetime as dt
import json
import os


def key(name):
    return " ".join(str(name).split()).casefold()


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _enrich(name, c):
    c = {**c, "project": name}
    try:
        signed = dt.date.fromisoformat(c["signed"])
    except (KeyError, TypeError, ValueError):
        return c
    if isinstance(c.get("term_months"), int):
        c["maturity"] = add_months(signed, c["term_months"]).isoformat()
    if isinstance(c.get("availability_months"), int):
        c["availability_end"] = add_months(signed, c["availability_months"]).isoformat()
    return c


def load_map(path):
    """JSON {"Projeto": {...}} -> (dados por nome normalizado, erro). Usado p.ex. no project_info.json."""
    if not os.path.exists(path):
        return {}, None
    try:
        with open(path, encoding="utf-8-sig") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raise ValueError("o ficheiro deve ser um objeto { \"Projeto\": {...} }")
    except (OSError, ValueError) as e:
        return {}, f"{os.path.basename(path)} inválido: {e}"
    return {key(n): {**c, "project": n} for n, c in raw.items()
            if not n.startswith("_") and isinstance(c, dict)}, None


def load(path):
    """Devolve (contratos por nome normalizado, erro). Chaves começadas por "_" são comentários."""
    if not os.path.exists(path):
        return {}, None
    try:
        with open(path, encoding="utf-8-sig") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raise ValueError("o ficheiro deve ser um objeto { \"Projeto\": {...} }")
    except (OSError, ValueError) as e:
        return {}, f"financing.json inválido: {e}"
    return {key(n): _enrich(n, c) for n, c in raw.items()
            if not n.startswith("_") and isinstance(c, dict)}, None
