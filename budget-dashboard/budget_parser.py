"""Lê as folhas de "Project Review" dos ficheiros de budget.

Não faz cálculos: reporta os valores tal como estão (cacheados) no Excel.

Uma folha é considerada um quadro de Project Review quando, nas primeiras
linhas, tem uma célula "Δ" (cabeçalho da coluna de variação) e uma linha
"TOTAL COST". Um ficheiro pode ter várias destas folhas (um projeto/fase por
folha), p.ex. "PROJECT REVIEW -PPT" ou "PR PLENO I", "PR PLENO II", ...
"""

import datetime as dt
import os
import re
import shutil
import tempfile
import zipfile

import openpyxl
from openpyxl.utils import get_column_letter

SCAN_ROWS = 120
SCAN_COLS = 15

DATE_IN_HEADER = re.compile(r"\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{2,4}")
# "TOTAL COST (PROJECT)" sim; "Total costs (k€)" (folhas de comparação) não.
TOTAL_COST = re.compile(r"^\s*TOTAL COST\b", re.I)
DEFINED_NAMES = re.compile(rb"<definedNames>.*?</definedNames>|<definedNames\s*/>", re.S)


def _norm(v):
    return re.sub(r"\s+", " ", v).strip() if isinstance(v, str) else v


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _header_lines(text):
    """'Project Review      16 / 07 / 2026     Orion' -> ['Project Review', '16/07/2026', 'Orion']"""
    if text is None:
        return []
    text = str(text)
    if "\n" in text.strip():
        return [_norm(p) for p in text.split("\n") if _norm(p)]
    text = _norm(text)
    m = DATE_IN_HEADER.search(text)
    if not m:
        return [text]
    parts = [text[: m.start()], re.sub(r"\s+", "", m.group()), text[m.end():]]
    return [_norm(p) for p in parts if _norm(p)]


def _cell_value(v):
    """Valor serializável: números, texto (inclui erros tipo '#DIV/0!') ou None."""
    if _is_number(v):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def _row_kind(label):
    up = label.upper()
    if "ORION" in up:
        return "orion"
    if up.startswith("TOTAL") or up.startswith("MARGIN"):
        return "total"
    return "line"


def parse_sheet(grid, sheet_name):
    """grid: lista de linhas (tuplos de valores) das primeiras SCAN_ROWS linhas."""
    get = lambda r, c: grid[r][c] if r < len(grid) and c < len(grid[r]) else None

    header_r = delta_c = None
    total_found = False
    for r, row in enumerate(grid):
        for c, v in enumerate(row):
            if isinstance(v, str):
                if v.strip() == "Δ" and header_r is None:
                    header_r, delta_c = r, c
                if TOTAL_COST.match(v):
                    total_found = True
    if header_r is None or not total_found:
        return None

    # Outros quadros na mesma folha, mais abaixo (outro Δ): p.ex. a segunda vista de custos do
    # NOLA ou o Project Review anterior. Ficam em "views"; o quadro principal acaba antes deles.
    views = []
    nxt = next((r for r in range(header_r + 1, len(grid))
                if any(isinstance(v, str) and v.strip() == "Δ" for v in grid[r])), None)
    if nxt is not None:
        sub = parse_sheet(grid[nxt:], sheet_name)
        if sub:
            views = [{k: sub[k] for k in ("columns", "sqm_columns", "rows", "kpis", "kpi_title", "footnote", "notes")}]
            views += sub.get("views", [])
        grid = grid[:nxt]

    # Coluna das labels: a primeira coluna à esquerda do Δ com texto em linhas
    # abaixo do cabeçalho (normalmente B). O nome do projeto está no cabeçalho.
    label_c = None
    for c in range(delta_c):
        if any(isinstance(get(r, c), str) and get(r, c).strip()
               for r in range(header_r + 1, min(header_r + 15, len(grid)))):
            label_c = c
            break
    if label_c is None:
        return None
    value_cols = list(range(label_c + 1, delta_c))

    columns = [{"lines": _header_lines(get(header_r, c))} for c in value_cols]

    # Bloco €/sqm à direita do Δ (Residential / Retail / Park / Total): áreas na linha
    # a seguir ao cabeçalho e um valor por rubrica, na mesma linha do Project Review.
    sqm_cols = [c for c in range(delta_c + 1, len(grid[header_r]))
                if isinstance(get(header_r, c), str) and get(header_r, c).strip()]
    sqm_columns = [{"label": _norm(get(header_r, c)), "area": _cell_value(get(header_r + 1, c))}
                   for c in sqm_cols]

    rows = []
    kpi_r = None
    r = header_r + 1
    while r < len(grid):
        label = get(r, label_c)
        if isinstance(label, str) and label.strip():
            lab = _norm(label)
            if "KPI" in lab.upper():
                kpi_r = r
                break
            values = [_cell_value(get(r, c)) for c in value_cols]
            delta = _cell_value(get(r, delta_c))
            if lab.startswith("*"):
                pass  # nota de rodapé ("*Margin Pre-Tax"), tratada abaixo
            elif any(_is_number(v) for v in values + [delta]) or any(
                    isinstance(v, str) for v in values):
                row = {
                    "label": lab,
                    "kind": _row_kind(lab),
                    "percent": "(%)" in lab,
                    "values": values,
                    "delta": delta,
                }
                sqm = [_cell_value(get(r, c)) for c in sqm_cols]
                if any(v is not None for v in sqm):
                    row["sqm"] = sqm
                rows.append(row)
        r += 1

    kpis = []
    if kpi_r is not None:
        r = kpi_r + 1
        while r < len(grid):
            label = get(r, label_c)
            if isinstance(label, str) and label.strip():
                cells = [get(r, c) for c in value_cols]
                if not any(isinstance(v, str) and v.strip() for v in cells):
                    break
                kpis.append({
                    "label": _norm(label),
                    "values": [[_norm(p) for p in str(v).split("\n") if _norm(p)]
                               if v not in (None, "") else [] for v in cells],
                })
            elif kpis:
                break
            r += 1

    # Notas: "*Margin Pre-Tax", "Margin w/out internal fees", "Margin post tax", ...
    notes = []
    footnote = None
    last_table_r = kpi_r if kpi_r is not None else len(grid)
    for r in range(header_r + 1, len(grid)):
        for c in range(len(grid[r])):
            v = get(r, c)
            if not isinstance(v, str):
                continue
            t = _norm(v)
            if t.startswith("*") and footnote is None:
                footnote = t
            elif re.match(r"margin\b.*\b(internal|post tax|pre tax|w/)", t, re.I) and t != _norm(get(r, label_c) or ""):
                num = get(r, c + 1) if _is_number(get(r, c + 1)) else (
                    get(r, c - 1) if c > 0 and _is_number(get(r, c - 1)) else None)
                if num is not None:
                    notes.append({"label": t, "value": float(num), "percent": True,
                                  "below_kpis": r > last_table_r})

    # Datas de review (topo da folha)
    last_review = next_review = None
    for r in range(0, header_r):
        for c in range(len(grid[r])):
            v = get(r, c)
            if isinstance(v, str):
                t = v.lower()
                nxt = _cell_value(get(r, c + 1))
                if "last" in t and "review" in t:
                    last_review = nxt
                elif "next" in t and "review" in t:
                    next_review = nxt

    name = _norm(get(header_r, label_c)) or sheet_name
    return {
        "name": str(name),
        "sheet": sheet_name,
        "columns": columns,
        "sqm_columns": sqm_columns,
        "rows": rows,
        "kpis": kpis,
        "kpi_title": _norm(get(kpi_r, label_c)) if kpi_r is not None else None,
        "footnote": footnote,
        "notes": notes,
        "last_review": last_review,
        "next_review": next_review,
        "views": views,
    }


# ---------- Budget detalhado (folhas "BUDGET ...": rubricas e subrubricas) ----------

BUDGET_ROWS = 320
BUDGET_COLS = 120
RUBRIC_1 = re.compile(r"^\s*1\s*-\s*Land costs", re.I)
RUBRIC = re.compile(r"^\s*\d{1,2}\s*-")
BUDGET_GROUPS = re.compile(r"^\s*(BUDGET|COST OF THE PROJECT|VARIATION|TOTAL INVOICED)", re.I)
BUDGET_END = re.compile(r"^(Unlevered|Levered|IRR\b|Project KPI|Orions? View KPI)", re.I)


def _find_budget_layout(grid):
    """(linha da 1.ª rubrica, coluna das labels, linha dos grupos) ou None."""
    for r, row in enumerate(grid[:60]):
        for c, v in enumerate(row[:8]):
            if isinstance(v, str) and RUBRIC_1.match(v):
                for g in range(r - 1, max(-1, r - 12), -1):
                    if any(isinstance(x, str) and x.strip().upper().startswith("BUDGET")
                           for x in grid[g][c + 1:]):
                        return r, c, g
                return None
    return None


def parse_budget_sheet(grid, sheet_name, hidden_cols=()):
    """Quadro de budget completo (grid e hidden_cols 0-based).

    Todas as colunas são lidas (as escondidas no Excel ficam marcadas com
    "hidden"), porque o Project Review pode usar uma revisão que está escondida.
    As linhas escondidas também: normalmente são subrubricas agrupadas e recolhidas.
    """
    layout = _find_budget_layout(grid)
    if not layout:
        return None
    first_r, label_c, group_r = layout
    head_r = group_r + 1
    get = lambda r, c: grid[r][c] if r < len(grid) and c < len(grid[r]) else None
    width = max(len(row) for row in grid)

    # Colunas: grupos BUDGET / COST OF THE PROJECT / VARIATION / INVOICED, sem as escondidas.
    columns, col_idx, group = [], [], None
    for c in range(label_c + 1, width):
        g = get(group_r, c)
        if isinstance(g, str) and g.strip():
            if not BUDGET_GROUPS.search(g):
                break
            group = _norm(g.replace("\n", " "))
        if group is None:
            continue
        head = get(head_r, c)
        has_data = any(_is_number(get(r, c)) for r in range(first_r, min(first_r + 120, len(grid))))
        if not (isinstance(head, str) and head.strip()) and not has_data:
            continue
        lines = _header_lines(head) if isinstance(head, str) and head.strip() else []
        sub = get(head_r + 1, c)
        columns.append({
            "group": group,
            "lines": lines or [group],
            "sub": _norm(str(sub)) if sub not in (None, "") and not _is_number(sub) else None,
            "percent": bool(lines) and lines[0].startswith("%"),
            "hidden": c in hidden_cols,
            "letter": get_column_letter(c + 1),
        })
        col_idx.append(c)
    if not columns:
        return None

    items, current, blanks, end_r = [], None, 0, len(grid)
    for r in range(first_r, len(grid)):
        label = get(r, label_c)
        if not (isinstance(label, str) and label.strip()):
            blanks += 1
            if blanks > 8:
                end_r = r
                break
            continue
        blanks = 0
        lab = _norm(label)
        if BUDGET_END.match(lab):
            end_r = r
            break
        values = [_cell_value(get(r, c)) for c in col_idx]
        if not any(v is not None for v in values):
            continue
        code = get(r, label_c - 1) if label_c > 0 else None
        up = lab.upper()
        row = {"label": lab, "code": _cell_value(code), "values": values,
               "percent": "%" in lab and up.startswith("MARGIN")}
        if up.startswith("TOTAL") or up.startswith("MARGIN"):
            items.append({**row, "kind": "orion" if "ORION" in up else "total"})
            current = None
        elif RUBRIC.match(lab):
            current = {**row, "kind": "rubric", "children": []}
            items.append(current)
        elif current is not None:
            current["children"].append({**row, "kind": "sub"})
        else:
            items.append({**row, "kind": "line"})

    # Blocos de KPIs por versão ("Project KPIs = Orions KPIs", "Orions View KPIs", ...):
    # linhas Unlevered / Levered / Levered post tax com texto tipo "16,5% / 1,3x | 12.0M€ / -42.4M€".
    kpi_blocks, block = {}, None
    for r in range(end_r, len(grid)):
        label = get(r, label_c)
        lab = _norm(label) if isinstance(label, str) else ""
        if re.match(r"^(Project KPIs|Orions? View KPIs)", lab, re.I):
            block = kpi_blocks.setdefault(_kpi_key(lab), {"title": lab, "rows": {}})
            continue
        if block is None or not lab:
            continue
        vals = [get(r, c) for c in col_idx]
        if not any(isinstance(v, str) and v.strip() for v in vals):
            block = None if block["rows"] else block
            continue
        block["rows"][lab] = [[_norm(p) for p in str(v).split("\n") if _norm(p)]
                              if isinstance(v, str) and v.strip() else [] for v in vals]

    return {"sheet": sheet_name, "title": _norm(str(get(head_r - 1, label_c) or "")) or None,
            "columns": columns, "rows": items, "kpi_blocks": list(kpi_blocks.values())}


def _kpi_key(title):
    t = re.sub(r"[^a-z]", "", (title or "").lower())
    return "orion" if t.startswith("orion") or "orionskpis" in t else "project"


RUBRIC_NUM = re.compile(r"^\s*(\d{1,2})\s*-")
DATE_TOKEN = re.compile(r"(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})|(\d{4})-(\d{2})-(\d{2})")


def _rubric_num(label):
    m = RUBRIC_NUM.match(label or "")
    return int(m.group(1)) if m else None


def _dates(lines):
    """Datas de um cabeçalho, normalizadas para (ano, mês, dia)."""
    out = set()
    for m in DATE_TOKEN.finditer(" ".join(lines or [])):
        if m.group(4):
            out.add((int(m.group(4)), int(m.group(5)), int(m.group(6))))
        else:
            y = int(m.group(3))
            out.add((y + 2000 if y < 100 else y, int(m.group(2)), int(m.group(1))))
    return out


def _row_key(label):
    """'TOTAL COST (PROJECT)' ~ 'TOTAL COST'; "MARGIN (ORIONS' VIEW) (€)*" ~ 'MARGIN (ORIONS VIEW) (€)'."""
    t = (label or "").upper().replace("(PROJECT)", "").replace("ORIONS", "ORION")
    return re.sub(r"[^A-Z0-9€%]", "", t)


def _code_str(code):
    """111.0 -> "111", 321.1 -> "321.1", 464.01 -> "464.01"."""
    if code is None:
        return None
    if _is_number(code):
        return f"{code:g}"
    return str(code).strip() or None


def _close(a, b):
    return _is_number(a) and _is_number(b) and abs(a - b) <= max(0.5, abs(b) * 0.0005)


def attach_budget_details(project, budget):
    """Junta às rubricas do Project Review as subrubricas da folha de budget.

    Não há correspondência fixa entre colunas: cada coluna do quadro (e o Δ) é
    associada à coluna do budget cujos valores das rubricas são iguais aos do
    quadro. Em caso de empate, ganha a que tem a mesma data no cabeçalho, depois
    uma coluna visível, depois a mais recente. Devolve uma cópia do projeto.
    """
    pr_rub = {}
    for r in project["rows"]:
        n = _rubric_num(r["label"])
        if n is not None and n not in pr_rub:
            pr_rub[n] = r
    b_rub = {}
    for r in budget["rows"]:
        n = _rubric_num(r["label"]) if r["kind"] == "rubric" else None
        if n is not None and n not in b_rub:
            b_rub[n] = r
    common = [n for n in pr_rub if n in b_rub]
    if not common:
        return project

    bcols = budget["columns"]

    def best(get_pr, header_lines):
        wanted = _dates(header_lines)
        cands = []
        for k, col in enumerate(bcols):
            pairs = [(get_pr(pr_rub[n]), b_rub[n]["values"][k]) for n in common]
            pairs = [(a, b) for a, b in pairs if _is_number(a)]
            if not pairs:
                continue
            hits = sum(1 for a, b in pairs if _close(b, a))
            if hits < max(2, 0.8 * len(pairs)):
                continue
            nonzero = sum(1 for a, b in pairs if _close(b, a) and abs(a) > 0.5)
            cands.append((hits, nonzero, bool(wanted & _dates(col["lines"])), not col.get("hidden"), k))
        return max(cands)[-1] if cands else None

    ncol = len(project["columns"])
    mapping = [best(lambda r, j=j: r["values"][j], project["columns"][j]["lines"]) for j in range(ncol)]
    # Δ do quadro = última coluna − penúltima? Então nas subrubricas faz-se a mesma diferença
    # (é a regra do próprio quadro). Senão, procura uma coluna do budget (p.ex. VARIATION).
    checks = [n for n in common
              if all(_is_number(v) for v in (pr_rub[n]["delta"], *pr_rub[n]["values"][-2:]))]
    delta_is_diff = ncol >= 2 and bool(checks) and all(
        _close(pr_rub[n]["delta"], pr_rub[n]["values"][-1] - pr_rub[n]["values"][-2]) for n in checks)
    delta_k = None if delta_is_diff else best(lambda r: r["delta"], ["VARIATION"])

    def sub_row(c):
        vals = [c["values"][k] if k is not None else None for k in mapping]
        if delta_is_diff:
            delta = vals[-1] - vals[-2] if _is_number(vals[-1]) and _is_number(vals[-2]) else None
        else:
            delta = c["values"][delta_k] if delta_k is not None else None
        return {"label": c["label"], "code": _code_str(c["code"]), "values": vals, "delta": delta}

    # Linha do budget que corresponde a cada linha do quadro (rubrica pelo número, totais/margens
    # pelo texto). Só fica ligada se os valores coincidirem nas colunas já associadas.
    b_by_key = {}
    for br in budget["rows"]:
        b_by_key.setdefault(_row_key(br["label"]), br)

    def budget_row(r):
        n = _rubric_num(r["label"])
        br = b_rub.get(n) if n is not None else b_by_key.get(_row_key(r["label"]))
        if not br:
            return None
        checks = [(r["values"][j], br["values"][k]) for j, k in enumerate(mapping)
                  if k is not None and _is_number(r["values"][j])]
        same = lambda a, b: (_close(b, a) or (b is None and abs(a) < 0.5)
                             or (r.get("percent") and _is_number(b) and abs(a - b) < 0.0005))
        hits = sum(1 for a, b in checks if same(a, b))
        # tolera uma coluna diferente (p.ex. erro numa célula do quadro), desde que as outras coincidam
        return br if checks and hits >= max(1, len(checks) - 1) and hits >= min(2, len(checks)) else None

    # Subrubricas numa lista simples, como no Excel (o Excel não indica se umas
    # estão contidas noutras, p.ex. 321 / 321.1, por isso não se assume nada).
    rows = []
    for orig in project["rows"]:
        n = _rubric_num(orig["label"])
        r = dict(orig)
        br = budget_row(orig)
        if br:
            r["bvalues"] = br["values"]
        if n in b_rub and orig is pr_rub.get(n) and b_rub[n]["children"]:
            r["children"] = [{**sub_row(c), "bvalues": c["values"]} for c in b_rub[n]["children"]]
        rows.append(r)

    # Versões que se podem escolher no quadro: colunas BUDGET (incl. escondidas) e o TOTAL atual
    versions = []
    for k, col in enumerate(bcols):
        g = (col.get("group") or "").upper()
        if g.startswith("BUDGET"):
            label = " ".join(col["lines"])
        elif g.startswith("COST") and col["lines"] and col["lines"][0].upper() == "TOTAL":
            label = "Current (signed + forecasted)"
        else:
            continue
        versions.append({"col": k, "label": label, "hidden": bool(col.get("hidden")),
                         "letter": col.get("letter"), "lines": col["lines"]})

    # KPIs por versão: o bloco com o mesmo título do quadro, se coincidir nas colunas associadas
    bkpis = None
    want = _kpi_key(project.get("kpi_title"))
    blocks = sorted(budget.get("kpi_blocks", []), key=lambda b: _kpi_key(b["title"]) != want)
    flat = lambda v: " ".join(v or []).replace(" ", "").replace(",", ".")  # "7,2M€" == "7.2M€"
    for b in blocks:
        rows_k = {re.sub(r"\s+", " ", k).strip().lower(): v for k, v in b["rows"].items()}
        ok = 0
        for kpi in project.get("kpis", []):
            bv = rows_k.get(kpi["label"].lower())
            if bv is None:
                continue
            for j, k in enumerate(mapping):
                if k is not None and kpi["values"][j] and flat(kpi["values"][j]) == flat(bv[k]):
                    ok += 1
        if ok:
            bkpis = {kpi["label"]: rows_k.get(kpi["label"].lower()) for kpi in project.get("kpis", [])}
            break

    # Comissões de mediadores (rubrica 511 "External sales fees"): orçamento na coluna do budget do
    # Project Review mais recente, adjudicado em "Signed commitments", disponível = orçamento − adjudicado
    commissions = None
    signed_k = next((k for k, col in enumerate(bcols) if (col.get("group") or "").upper().startswith("COST")
                     and col["lines"] and "signed" in col["lines"][0].lower()), None)
    c511 = next((c for r in budget["rows"] for c in [r, *r.get("children", [])] if _code_str(c.get("code")) == "511"), None)
    last_k = next((k for k in reversed(mapping) if k is not None), None)
    if c511 and last_k is not None:
        num = lambda v: float(v) if _is_number(v) else 0.0
        bud = num(c511["values"][last_k])
        signed = num(c511["values"][signed_k]) if signed_k is not None else None
        commissions = {"code": "511", "label": c511["label"], "budget": bud, "signed": signed,
                       "available": bud - signed if signed is not None else None,
                       "budget_column": " ".join(bcols[last_k]["lines"])}

    return {**project, "rows": rows, "versions": versions, "version_default": mapping, "bkpis": bkpis,
            "commissions": commissions,
            "budget_link": {"sheet": budget["sheet"],
                            "columns": [bcols[k]["lines"] if k is not None else None for k in mapping],
                            "delta": ("column" if delta_k is not None else "difference" if delta_is_diff else None)}}


def apply_versions(project, sel):
    """Quadro com a 2.ª e 3.ª colunas trocadas pelas versões do budget escolhidas (sel = [comparação,
    referência], índices das colunas do budget). Δ = referência − comparação. Igual ao que o browser faz."""
    d = project.get("version_default") or []
    cols = {v["col"]: v for v in project.get("versions") or []}
    if (len(project["columns"]) != 3 or len(d) != 3 or None in (d[1], d[2])
            or not isinstance(sel, (list, tuple)) or len(sel) != 2 or any(s not in cols for s in sel)
            or (sel[0] == d[1] and sel[1] == d[2])):
        return project
    slots = [d[0], sel[0], sel[1]]

    def pick(r, s):
        if s == 0 or slots[s] == d[s]:
            return r["values"][s]
        b = r.get("bvalues")
        return b[slots[s]] if b and slots[s] < len(b) else None

    def mk(r):
        values = [pick(r, 0), pick(r, 1), pick(r, 2)]
        delta = values[2] - values[1] if _is_number(values[1]) and _is_number(values[2]) else None
        out = {**r, "values": values, "delta": delta}
        if r.get("children"):
            out["children"] = [mk(c) for c in r["children"]]
        return out

    def kpi_col(k, s):
        if slots[s] == d[s]:
            return k["values"][s]
        b = (project.get("bkpis") or {}).get(k["label"]) or []
        return b[slots[s]] if slots[s] < len(b) else []

    return {**project,
            "columns": [project["columns"][0]] + [
                {"lines": project["columns"][s]["lines"] if slots[s] == d[s] else cols[slots[s]]["lines"]} for s in (1, 2)],
            "rows": [mk(r) for r in project["rows"]],
            "kpis": [{**k, "values": [k["values"][0], kpi_col(k, 1), kpi_col(k, 2)]} for k in project.get("kpis", [])],
            "notes": []}


def _hidden_cols(path, sheet_names):
    """{folha: colunas escondidas (0-based)}, lido diretamente do XML (o modo read-only não as expõe)."""
    out = {}
    try:
        with zipfile.ZipFile(path) as z:
            wb_xml = z.read("xl/workbook.xml").decode("utf-8", "replace")
            rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "replace")
            targets = {m.group(1): m.group(2) for m in re.finditer(
                r'<Relationship[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"', rels)}
            targets.update({m.group(2): m.group(1) for m in re.finditer(
                r'<Relationship[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"', rels)})
            for m in re.finditer(r"<sheet\b[^>]*>", wb_xml):
                tag = m.group(0)
                name = re.search(r'name="([^"]*)"', tag)
                rid = re.search(r'r:id="([^"]*)"', tag)
                if not name or not rid:
                    continue
                name = (name.group(1).replace("&amp;", "&").replace("&apos;", "'")
                        .replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">"))
                if name not in sheet_names:
                    continue
                target = targets.get(rid.group(1), "").lstrip("/")
                target = target if target.startswith("xl/") else "xl/" + target
                xml = z.read(target).decode("utf-8", "replace")
                cols = set()
                for col in re.finditer(r"<col\b[^>]*>", xml):
                    t = col.group(0)
                    if re.search(r'\bhidden="(1|true)"', t):
                        lo = int(re.search(r'\bmin="(\d+)"', t).group(1))
                        hi = int(re.search(r'\bmax="(\d+)"', t).group(1))
                        cols.update(range(lo - 1, min(hi, BUDGET_COLS)))
                out[name] = cols
    except (KeyError, zipfile.BadZipFile, AttributeError, ValueError):
        pass
    return out


def _strip_defined_names(path):
    """Remove os nomes definidos do workbook.xml (reescreve o ficheiro).

    O openpyxl recusa abrir ficheiros com p.ex. Print_Titles = #N/A ou #REF!.
    A app não usa nomes definidos, por isso podem ser retirados da cópia.
    """
    fd, out = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/workbook.xml":
                data = DEFINED_NAMES.sub(b"", data)
            zout.writestr(item, data)
    shutil.move(out, path)


def copy_shared(path, dest):
    """Copia um ficheiro que pode estar aberto por outro programa.

    No Windows, um Excel aberto por alguém (ou o OneDrive) pode ter o ficheiro com acesso de
    eliminação, e o open() do Python (que não partilha esse acesso) falha com PermissionError;
    nesse caso abre-se com partilha de leitura, escrita e eliminação, como faz o Explorador.
    """
    try:
        shutil.copyfile(path, dest)
        return
    except PermissionError:
        if os.name != "nt":
            raise
    import ctypes
    import msvcrt
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateFileW.restype = wintypes.HANDLE
    k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    GENERIC_READ, SHARE_ALL, OPEN_EXISTING = 0x80000000, 0x7, 3
    h = k32.CreateFileW(os.path.abspath(path), GENERIC_READ, SHARE_ALL, None, OPEN_EXISTING, 0x80, None)
    if h in (None, wintypes.HANDLE(-1).value):
        raise PermissionError(ctypes.get_last_error(), "Permission denied", path)
    with open(msvcrt.open_osfhandle(h, os.O_RDONLY | os.O_BINARY), "rb") as src, open(dest, "wb") as out:
        shutil.copyfileobj(src, out)


def _load(tmp):
    try:
        return openpyxl.load_workbook(tmp, data_only=True, read_only=True)
    except ValueError as e:
        if "assign names" not in str(e):
            raise
    _strip_defined_names(tmp)
    return openpyxl.load_workbook(tmp, data_only=True, read_only=True)


def parse_workbook(path, include_hidden=False):
    """Devolve a lista de projetos encontrados no ficheiro."""
    return parse_file(path, include_hidden)["projects"]


def parse_file(path, include_hidden=False):
    """{"projects": [...quadros de Project Review], "budgets": {folha: budget detalhado}}."""
    # Copia para um ficheiro temporário: evita problemas com ficheiros abertos
    # no Excel ou a meio de uma sincronização do OneDrive.
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        copy_shared(path, tmp)
        wb = _load(tmp)
        try:
            projects, budget_sheets = [], []
            for ws in wb.worksheets:
                if ws.sheet_state != "visible" and not include_hidden:
                    continue
                grid = [tuple(row) for row in ws.iter_rows(
                    min_row=1, max_row=SCAN_ROWS, max_col=SCAN_COLS, values_only=True)]
                p = parse_sheet(grid, ws.title)
                if p:
                    projects.append(p)
                elif _find_budget_layout(grid):
                    budget_sheets.append(ws)
            budgets = {}
            hidden = _hidden_cols(tmp, {ws.title for ws in budget_sheets}) if budget_sheets else {}
            for ws in budget_sheets:
                grid = [tuple(row) for row in ws.iter_rows(
                    min_row=1, max_row=BUDGET_ROWS, max_col=BUDGET_COLS, values_only=True)]
                b = parse_budget_sheet(grid, ws.title, hidden.get(ws.title, set()))
                if b:
                    budgets[ws.title] = b
            return {"projects": projects, "budgets": budgets}
        finally:
            wb.close()
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
