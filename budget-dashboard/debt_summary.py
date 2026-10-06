"""Vizta Debt Summary (DFIN): financiamentos bancários por projeto.

Uma folha "Financing <projeto>" por empréstimo: cabeçalho (empresa, banco, montante, LTC/LTHC, estado) e a
tabela de autos de obra / utilizações. A folha "Interests <projeto>" correspondente tem os juros por
trimestre (calculados e cobrados pelo banco). Os rótulos e colunas são encontrados pelo texto, não pela
posição. Valores em €.
"""

import datetime as dt
import os
import re
import shutil
import tempfile
import unicodedata

from budget_parser import _load

# rótulo do cabeçalho (sem acentos, minúsculas, sem ":" / ">") -> campo
HEADER = {
    "company": "company", "project": "project", "financing entity": "bank",
    "approved loan amount": "approved", "loan amount": "loan",
    "construction works contract": "works_contract", "total costs": "total_cost", "hard costs": "hard_cost",
    "ltc": "ltc", "lthc": "lthc", "status": "status",
}
# coluna da tabela -> padrão do cabeçalho
COLS = {
    "auto": r"^n. auto", "invoice": r"^invoice nr", "invoice_date": r"^invoice date",
    "inv_net": r"^inv\. amount \(w/o vat\)", "inv_vat": r"^inv\. amount \(w/ vat\)", "pct": r"^% auto",
    "date": r"^utilization date|^data valor", "utilization": r"^utilization$", "drawdown": r"^drawdown$",
    "stamp": r"^stamp duty$",
}


def _norm(v):
    s = unicodedata.normalize("NFKD", str(v)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def _header(rows):
    """Pares rótulo -> valor (o primeiro valor não vazio à direita do rótulo), antes da tabela."""
    out = {}
    for row in rows:
        for j, v in enumerate(row):
            if not isinstance(v, str):
                continue
            key = HEADER.get(_norm(v).rstrip(":> ").strip())
            if not key or key in out:
                continue
            val = next((x for x in row[j + 1:] if x not in (None, "")), None)
            if val is not None:
                out[key] = val.strip() if isinstance(val, str) else val
    return out


def parse_financing(rows):
    """Folha "Financing ...": cabeçalho, autos (faturas de obra) e utilizações do empréstimo."""
    hi = next((i for i, r in enumerate(rows) if any(isinstance(v, str) and re.match(COLS["auto"], _norm(v)) for v in r)), None)
    if hi is None:
        raise ValueError("cabeçalho 'Nº Auto' não encontrado")
    head = _header(rows[:hi])
    cols = {}
    for j, v in enumerate(rows[hi]):
        if isinstance(v, str):
            t = _norm(v)
            for k, pat in COLS.items():
                if k not in cols and re.match(pat, t):
                    cols[k] = j
    get = lambda r, k: r[cols[k]] if k in cols and cols[k] < len(r) else None
    invoices, uses, pct, pct_date = [], [], None, None
    for r in rows[hi + 1:]:
        if _num(get(r, "auto")) is None:  # fim da tabela (linha de totais ou vazia)
            if any(_num(v) for v in r):
                break
            continue
        d_inv, inv = _date(get(r, "invoice_date")), _num(get(r, "inv_vat"))
        if d_inv and inv:
            invoices.append({"date": d_inv, "number": get(r, "invoice"), "amount": inv,
                             "net": _num(get(r, "inv_net")), "pct": _num(get(r, "pct"))})
            if _num(get(r, "pct")) is not None:
                pct = _num(get(r, "pct"))
        d_use, use = _date(get(r, "date")), _num(get(r, "utilization"))
        if d_use and use:
            uses.append({"date": d_use, "utilization": use, "drawdown": _num(get(r, "drawdown")),
                         "stamp": _num(get(r, "stamp"))})
    uses.sort(key=lambda u: u["date"])
    drawn = sum(u["utilization"] for u in uses)
    loan = _num(head.get("loan"))
    status = str(head.get("status") or "")
    repaid = status.lower().startswith("repaid")
    return {
        "company": head.get("company"), "project": head.get("project"), "bank": head.get("bank"),
        "approved": _num(head.get("approved")), "loan": loan, "works_contract": _num(head.get("works_contract")),
        "total_cost": _num(head.get("total_cost")), "hard_cost": _num(head.get("hard_cost")),
        "ltc": _num(head.get("ltc")), "lthc": _num(head.get("lthc")), "status": status, "repaid": repaid,
        "invoices": invoices, "utilizations": uses,
        "totals": {"utilization": drawn, "drawdown": sum(u["drawdown"] or 0 for u in uses),
                   "stamp": sum(u["stamp"] or 0 for u in uses)},
        "drawn": 0 if repaid else drawn,  # em dívida
        "available": 0 if repaid else (loan - drawn if loan is not None else None),
        "work_pct": pct, "last_drawdown": uses[-1]["date"] if uses else None,
    }


def parse_interests(rows):
    """Folha "Interests ...": tabela por trimestre (Trimestre | Juros Calculado | Juros Cobrado Banco)."""
    for i, r in enumerate(rows):
        for j, v in enumerate(r):
            if not (isinstance(v, str) and _norm(v) == "trimestre"):
                continue
            nxt = [_norm(x) if isinstance(x, str) else "" for x in r[j + 1:j + 3]]
            if not (nxt and nxt[0].startswith("juros calculado")):
                continue
            out = []
            for rr in rows[i + 1:]:
                q = rr[j] if j < len(rr) else None
                if not isinstance(q, str) or not re.match(r"^Q[1-4]\s+\d{4}$", q.strip()):
                    break
                calc = _num(rr[j + 1]) if j + 1 < len(rr) else None
                charged = _num(rr[j + 2]) if j + 2 < len(rr) else None
                out.append({"quarter": q.strip(), "calculated": calc, "charged": charged})
            return out
    return []


def read_file(path):
    """Lê todas as folhas "Financing ..." (e os juros) a partir de uma cópia (o Excel pode estar aberto)."""
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        shutil.copyfile(path, tmp)
        wb = _load(tmp)
        try:
            names = wb.sheetnames
            sheets = {n: [tuple(r) for r in wb[n].iter_rows(max_col=40, values_only=True)]
                      for n in names if re.match(r"^(financing|interests) ", n.strip(), re.I)}
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    loans, errors = [], []
    for n in names:  # pela ordem das folhas no ficheiro
        m = re.match(r"^financing (.+)$", n.strip(), re.I)
        if not m:
            continue
        try:
            loan = parse_financing(sheets[n])
        except Exception as e:
            errors.append(f"{n}: {e}")
            continue
        inter = next((k for k in sheets if re.match(rf"^interests {re.escape(m.group(1).strip())}$", k.strip(), re.I)), None)
        loan["interests"] = parse_interests(sheets[inter]) if inter else []
        loan["sheet"] = n
        loans.append(loan)
    return loans, errors
