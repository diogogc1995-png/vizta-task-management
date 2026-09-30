"""Exporta o(s) quadro(s) de Project Review para um .xlsx formatado como o dashboard."""

import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

PEACH = PatternFill("solid", fgColor="F4C7A1")
PEACH_LIGHT = PatternFill("solid", fgColor="FADCC4")
PEACH_PALE = PatternFill("solid", fgColor="FDF0E6")
BLUE = PatternFill("solid", fgColor="CFDAF0")
GRID = Side(style="thin", color="B7B7B7")
DOTTED = Side(style="dotted", color="7F7F7F")
BOLD = Font(bold=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
RIGHT = Alignment(horizontal="right", vertical="center")
NUM_FMT = '#,##0;-#,##0;0'
PCT_FMT = '0.00%'


def _sheet_title(text, used):
    t = re.sub(r"[\\/*?:\[\]]", "", text)[:31] or "Project"
    base, i = t, 2
    while t in used:
        suffix = f" ({i})"
        t = base[: 31 - len(suffix)] + suffix
        i += 1
    used.add(t)
    return t


def write_project(ws, group, p):
    ncol = len(p["columns"])
    last = 2 + ncol  # coluna do Δ (1-based: A=labels)
    ws.column_dimensions["A"].width = 34
    for c in range(2, last + 1):
        ws.column_dimensions[ws.cell(1, c).column_letter].width = 20
    ws.column_dimensions[ws.cell(1, last).column_letter].width = 10

    ws.cell(1, 1, f"{group} — {p['sheet']}").font = Font(italic=True, color="7F7F7F")

    r = 3
    ws.cell(r, 1, p["name"])
    for i, col in enumerate(p["columns"]):
        ws.cell(r, 2 + i, "\n".join(col["lines"]))
    ws.cell(r, last, "Δ")
    for c in range(1, last + 1):
        cell = ws.cell(r, c)
        cell.font, cell.alignment = BOLD, CENTER
        cell.fill = PEACH_LIGHT if c == last - 1 else PEACH
        cell.border = Border(top=GRID, bottom=GRID, left=GRID, right=GRID)
    ws.row_dimensions[r].height = 48

    r += 1
    for row in p["rows"]:
        r += 1
        fill = BLUE if row["kind"] == "orion" else PEACH if row["kind"] == "total" else None
        ws.cell(r, 1, row["label"])
        for i, v in enumerate(row["values"] + [row["delta"]]):
            ws.cell(r, 2 + i, v)
        for c in range(1, last + 1):
            cell = ws.cell(r, c)
            if c > 1:
                cell.alignment = RIGHT
                cell.number_format = PCT_FMT if row["percent"] else NUM_FMT
            if fill:
                cell.fill, cell.font = fill, BOLD
            elif c == last - 1:
                cell.fill = PEACH_PALE
            cell.border = Border(left=GRID, right=GRID, bottom=DOTTED)

    if p["footnote"] or p["notes"]:
        r += 2
        if p["footnote"]:
            ws.cell(r, 1, p["footnote"]).font = Font(italic=True, size=9)
        for n in p["notes"]:
            ws.cell(r, last - 2 if ncol >= 2 else 2, n["label"]).font = Font(size=9)
            v = ws.cell(r, last - 1, n["value"])
            v.number_format, v.font = PCT_FMT, Font(size=9)
            r += 1

    if p["kpis"]:
        r += 2
        ws.cell(r, 1, p["kpi_title"] or "KPIs").font = BOLD
        for k in p["kpis"]:
            r += 1
            ws.cell(r, 1, k["label"])
            for i, lines in enumerate(k["values"]):
                ws.cell(r, 2 + i, "\n".join(lines))
            for c in range(1, last):
                cell = ws.cell(r, c)
                cell.fill = BLUE
                cell.font = BOLD if c == 1 else Font()
                cell.alignment = CENTER if c > 1 else Alignment(vertical="center")
                cell.border = Border(bottom=DOTTED)
            ws.row_dimensions[r].height = 32

    ws.sheet_view.showGridLines = False


def build_workbook(projects):
    """projects: lista de (grupo/ficheiro, projeto)."""
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    for group, p in projects:
        ws = wb.create_sheet(_sheet_title(p["name"], used))
        write_project(ws, group, p)
    return wb
