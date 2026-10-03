"""Ponto de situação dos projetos: atas em Excel (folha "ATA"), só os pontos "Pendente" e "Standby".

As colunas são encontradas pelo cabeçalho (os ficheiros não têm todos a mesma estrutura). Os nomes dos
projetos na ata ligam-se aos do dashboard por config.json -> "ponto_situacao" -> "projects". Pontos
repetidos em mais de um ficheiro (mesmo projeto, título e descrição) contam uma só vez.
"""

import datetime as dt
import os
import re
import shutil
import tempfile
import unicodedata

from budget_parser import _load

OPEN = ("pendente", "standby")
# campo -> padrões do cabeçalho (sem acentos, minúsculas)
COLUMNS = {
    "project": r"^projeto$|^projecto$",
    "area": r"^area$|^grupo$",
    "phase": r"^fases",
    "title": r"^titulo$|^assunto$",
    "description": r"^descricao$",
    "action": r"^accao$|^acao$|^acoes|^descritivo",
    "owner": r"^resp",
    "dept": r"^dep",
    "created": r"^data cria",
    "target_initial": r"^data obj(ectivo)?( inicial)?$",
    "target": r"^data obj atual$|^data actualizada$|^data atualizada$",
    "status": r"^estado$",
}


def _fold(v):
    s = unicodedata.normalize("NFKD", " ".join(str(v or "").split())).encode("ascii", "ignore").decode()
    return s.lower().rstrip(". ")


def _key(name):
    return " ".join(str(name or "").split()).casefold()


def _date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None  # vazio, "00:00:00" (só hora) ou texto


def _text(v):
    if v is None or isinstance(v, (dt.time, dt.datetime, dt.date)):
        return None
    s = str(v).strip()
    return s or None


def find_columns(rows):
    """(índice da linha do cabeçalho, {campo: coluna}) — a primeira linha com PROJETO e ESTADO."""
    for i, row in enumerate(rows[:10]):
        names = [_fold(v) for v in row]
        if "estado" in names and any(re.match(COLUMNS["project"], n) for n in names):
            cols = {}
            for field, pat in COLUMNS.items():
                c = next((j for j, n in enumerate(names) if n and re.match(pat, n)), None)
                if c is not None:
                    cols[field] = c
            return i, cols
    raise ValueError("cabeçalho não encontrado (linha com PROJETO e ESTADO)")


def _area(v):
    """'POS-VENDA' / 'Pós Venda' -> 'PÓS-VENDA'; vazio -> 'OUTROS'."""
    s = " ".join(str(v or "").split()).upper()
    if re.sub(r"[\s-]", "", _fold(s)) == "posvenda":
        return "PÓS-VENDA"
    return s or "OUTROS"


def parse_rows(rows, source):
    """Pontos abertos (Pendente/Standby) de uma folha ATA."""
    head, cols = find_columns(rows)
    get = lambda row, f: row[cols[f]] if f in cols and cols[f] < len(row) else None
    out = []
    for row in rows[head + 1:]:
        status = _text(get(row, "status"))
        if not status or _fold(status) not in OPEN:
            continue
        out.append({
            "project": _text(get(row, "project")),
            "area": _area(_text(get(row, "area")) or _text(get(row, "phase"))),
            "title": _text(get(row, "title")),
            "description": _text(get(row, "description")),
            "action": _text(get(row, "action")),
            "owner": _text(get(row, "owner")),
            "dept": _text(get(row, "dept")),
            "created": _date(get(row, "created")),
            "target_initial": _date(get(row, "target_initial")),
            "target": _date(get(row, "target")),
            "status": "Standby" if _fold(status) == "standby" else "Pendente",
            "source": source,
        })
    return out


def read_file(path, sheet="ATA"):
    """Lê a folha a partir de uma cópia (o Excel pode estar aberto por alguém)."""
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        shutil.copyfile(path, tmp)
        wb = _load(tmp)
        try:
            ws = wb[sheet] if sheet in wb.sheetnames else wb.worksheets[0]
            rows = [tuple(r) for r in ws.iter_rows(max_col=40, values_only=True)]
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return parse_rows(rows, os.path.basename(path))


def group_by_project(items, mapping):
    """{nome do projeto no dashboard (normalizado): [pontos]}, sem repetidos; nomes sem ligação à parte."""
    names = {_key(k): v for k, v in (mapping or {}).items()}
    out, unmatched, seen = {}, set(), set()
    for it in items:
        target = names.get(_key(it["project"]))
        if not target:
            if it["project"]:
                unmatched.add(it["project"])
            continue
        sig = (_key(target), _fold(it["title"]), _fold(it["description"]))
        if sig in seen:
            continue
        seen.add(sig)
        out.setdefault(_key(target), []).append(it)
    return out, sorted(unmatched)
