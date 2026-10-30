"""Ficheiro de apoio ao Project Review (p.ex. "PR Apoio_20261014.xlsx", pasta do PR na N_Operações).

Lê das folhas "Financing v.2" (e "Financing", oculta, para os projetos que só lá estão):
- o quadro de financiamento por projeto: Capex, Financiamento / Equity / Vendas, spread, Acq. Fin / Recap e garantias;
- a tabela "Data for graphs - Sources & Uses": Financing, Equity, Sales e Total costs (M€).
Os nomes das linhas ligam-se aos projetos do dashboard por config.json → "pr_support" → "projects".
"""

import os
import re
import tempfile
import unicodedata

from budget_parser import _load, copy_shared

SHEETS = ("financing v.2", "financing")  # a primeira tem prioridade


def _norm(v):
    s = unicodedata.normalize("NFKD", str(v)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().casefold()


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _txt(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def parse_rows(rows):
    """{"financing": {nome: {...}}, "su": {nome: {...}}} de uma folha."""
    fin, su = {}, {}
    head = next((i for i, r in enumerate(rows) if any(isinstance(v, str) and _norm(v) == "capex" for v in r)), None)
    su_at = next((i for i, r in enumerate(rows) if any(isinstance(v, str) and _norm(v).startswith("data for graphs - sources") for v in r)), None)
    if head is not None:
        cols = {}
        for j, v in enumerate(rows[head]):
            t = _norm(v) if isinstance(v, str) else ""
            for k, pat in (("capex", r"^capex"), ("fes", r"^fin/eq/sales"), ("margin", r"^margin"), ("recap", r"^acq\. fin"), ("guarantee", r"^guarantee")):
                if k not in cols and re.match(pat, t):
                    cols[k] = j
        label_col = min(cols.values()) - 2 if cols else 3
        for r in rows[head + 1:]:
            lab = r[label_col] if label_col < len(r) else None
            if isinstance(lab, str) and _norm(lab).startswith("data for graphs"):
                break
            if not isinstance(lab, str) or not lab.strip() or "capex" not in cols or _num(r[cols["capex"]]) is None:
                continue
            m = re.match(r"^(.*?)\s*\((.*)\)\s*$", " ".join(lab.split()))
            name, status = (m.group(1), m.group(2)) if m else (" ".join(lab.split()), None)
            g = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else None
            fes = [x.strip() for x in str(g("fes") or "").splitlines() if x.strip()]
            fin[name] = {"label": name, "status": status, "capex": _num(g("capex")),
                         "financing": fes[0] if len(fes) > 0 else None, "equity": fes[1] if len(fes) > 1 else None,
                         "sales": fes[2] if len(fes) > 2 else None,
                         "margin": " ".join(str(g("margin") or "").split()) or None,
                         "recap": _txt(g("recap")), "guarantee": _txt(g("guarantee"))}
    if su_at is not None:
        hdr = next((i for i in range(su_at, min(su_at + 4, len(rows))) if any(isinstance(v, str) and _norm(v) == "total costs" for v in rows[i])), None)
        if hdr is not None:
            cols = {_norm(v): j for j, v in enumerate(rows[hdr]) if isinstance(v, str)}
            jf, je, js, jt = (cols.get(k) for k in ("financing", "equity", "sales", "total costs"))
            lc = min(c for c in (jf, je, js, jt) if c is not None) - 2
            for r in rows[hdr + 1:]:
                lab = r[lc] if lc < len(r) else None
                if not isinstance(lab, str) or not lab.strip():
                    continue
                vals = [_num(r[j]) if j is not None and j < len(r) else None for j in (jf, je, js, jt)]
                if all(v is None for v in vals):
                    continue  # títulos dos gráficos por baixo da tabela
                su[" ".join(lab.split())] = dict(zip(("financing", "equity", "sales", "total"), vals))
    return {"financing": fin, "su": su}


def read_file(path):
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        copy_shared(path, tmp)
        wb = _load(tmp)
        try:
            by = {_norm(n): n for n in wb.sheetnames}
            sheets = {k: [tuple(r) for r in wb[by[k]].iter_rows(max_row=200, max_col=60, values_only=True)] for k in SHEETS if k in by}
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    if not sheets:
        raise ValueError("folha 'Financing v.2' não encontrada")
    out = {"financing": {}, "su": {}}
    for k in reversed(SHEETS):  # "Financing" primeiro; "Financing v.2" sobrepõe
        if k in sheets:
            res = parse_rows(sheets[k])
            out["financing"].update(res["financing"])
            out["su"].update(res["su"])
    return out


def by_project(data, mapping):
    """{nome do projeto no dashboard (normalizado): {"financing": {...}, "su": {...}}} pela tabela de nomes."""
    names = {_norm(k): v for k, v in (mapping or {}).items()}
    out = {}
    for part in ("financing", "su"):
        for label, rec in data.get(part, {}).items():
            target = names.get(_norm(label))
            if target:
                out.setdefault(" ".join(target.split()).casefold(), {})[part] = rec
    return out
