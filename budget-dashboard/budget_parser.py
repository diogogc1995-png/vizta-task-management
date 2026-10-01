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

SCAN_ROWS = 80
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
                rows.append({
                    "label": lab,
                    "kind": _row_kind(lab),
                    "percent": "(%)" in lab,
                    "values": values,
                    "delta": delta,
                })
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
        "rows": rows,
        "kpis": kpis,
        "kpi_title": _norm(get(kpi_r, label_c)) if kpi_r is not None else None,
        "footnote": footnote,
        "notes": notes,
        "last_review": last_review,
        "next_review": next_review,
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

    As colunas escondidas no Excel (revisões antigas) ficam de fora. As linhas
    escondidas não: normalmente são subrubricas agrupadas e recolhidas.
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
        if group is None or c in hidden_cols:
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
        })
        col_idx.append(c)
    if not columns:
        return None

    items, current, blanks = [], None, 0
    for r in range(first_r, len(grid)):
        label = get(r, label_c)
        if not (isinstance(label, str) and label.strip()):
            blanks += 1
            if blanks > 8:
                break
            continue
        blanks = 0
        lab = _norm(label)
        if BUDGET_END.match(lab):
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

    return {"sheet": sheet_name, "title": _norm(str(get(head_r - 1, label_c) or "")) or None,
            "columns": columns, "rows": items}


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
        shutil.copyfile(path, tmp)
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
