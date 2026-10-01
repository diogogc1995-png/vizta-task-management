"""Testes do parser com um workbook sintético (sem dados reais).  python -m unittest"""

import datetime as dt
import os
import re
import tempfile
import unittest
import zipfile

from openpyxl import Workbook

from budget_parser import parse_workbook
from excel_export import build_workbook

LINES = ["1- Land costs", "2- Charges", "4- Construction", "12-Other Adjustments"]


def make_review_sheet(ws, name):
    ws["B1"], ws["C1"] = "Last Project Review Date", dt.datetime(2026, 7, 16)
    ws["B2"], ws["C2"] = "Next project review date", dt.datetime(2026, 10, 21)
    ws["B6"] = name
    ws["C6"] = "Investment Committee \nDec/24"
    ws["D6"] = "Project Review        16 / 07 / 2026        Orion"
    ws["E6"] = "Project Review        21 / 10 / 2026        Orion"
    ws["F6"], ws["H6"] = "Δ", "Residential "
    r = 9
    for i, label in enumerate(LINES):
        ws.cell(r, 2, label)
        for c in range(3, 6):
            ws.cell(r, c, 100.0 * (i + 1) + c)
        ws.cell(r, 6, 1.0)
        r += 1
    ws.cell(20, 2, "TOTAL COST (PROJECT)"); ws.cell(20, 5, 1000.0); ws.cell(20, 6, 5.0)
    ws.cell(27, 2, "MARGIN (€)*"); ws.cell(27, 5, 200.0); ws.cell(27, 6, 0.0)
    ws.cell(28, 2, "MARGIN (ORIONS VIEW) (€)*"); ws.cell(28, 5, 190.0); ws.cell(28, 6, 0.0)
    ws.cell(29, 2, "MARGIN (%)*"); ws.cell(29, 5, 0.2359); ws.cell(29, 6, 0.0019)
    ws.cell(31, 2, "*Margin Pre-Tax")
    ws.cell(31, 4, "Margin w/out internal fees"); ws.cell(31, 5, 0.2627)
    ws.cell(33, 2, "Orions View KPIs (IRR / EM / Profit / Equity)")
    ws.cell(34, 2, "Unlevered")
    for c in range(3, 6):
        ws.cell(34, c, "16,5% / 1,3x \n 12.0M€ / -42.4M€")
    ws.cell(38, 5, 0.17); ws.cell(38, 6, "Margin post tax")


class ParserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        wb = Workbook()
        wb.active.title = "Cover"
        wb.active["A1"] = "TOTAL COST"  # sem Δ: não é uma folha de review
        make_review_sheet(wb.create_sheet("PR NOLA"), "NOLA")
        make_review_sheet(wb.create_sheet("PR OTHER"), "OTHER")
        cmp_ws = wb.create_sheet("Comparison")  # tem Δ, mas "Total costs" não é TOTAL COST
        cmp_ws["B22"], cmp_ws["D22"], cmp_ws["F22"] = "Key milestones", "Current", "Δ"
        cmp_ws["B33"], cmp_ws["D33"], cmp_ws["F33"] = "Total costs (k€)", 66629.1, 1950.1
        hidden = wb.create_sheet("PR HIDDEN")
        make_review_sheet(hidden, "HIDDEN")
        hidden.sheet_state = "hidden"
        fd, cls.path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        wb.save(cls.path)
        cls.projects = parse_workbook(cls.path)

    @classmethod
    def tearDownClass(cls):
        os.remove(cls.path)

    def test_detects_review_sheets_only(self):
        self.assertEqual([p["name"] for p in self.projects], ["NOLA", "OTHER"])
        self.assertEqual(len(parse_workbook(self.path, include_hidden=True)), 3)

    def test_header_and_dates(self):
        p = self.projects[0]
        self.assertEqual([c["lines"] for c in p["columns"]], [
            ["Investment Committee", "Dec/24"],
            ["Project Review", "16/07/2026", "Orion"],
            ["Project Review", "21/10/2026", "Orion"],
        ])
        self.assertEqual((p["last_review"], p["next_review"]), ("2026-07-16", "2026-10-21"))

    def test_rows(self):
        rows = {r["label"]: r for r in self.projects[0]["rows"]}
        self.assertEqual(list(rows)[:4], LINES)
        self.assertEqual(rows["4- Construction"]["values"], [303.0, 304.0, 305.0])
        self.assertEqual(rows["TOTAL COST (PROJECT)"]["kind"], "total")
        self.assertEqual(rows["MARGIN (ORIONS VIEW) (€)*"]["kind"], "orion")
        self.assertTrue(rows["MARGIN (%)*"]["percent"])
        self.assertAlmostEqual(rows["MARGIN (%)*"]["delta"], 0.0019)
        self.assertNotIn("*Margin Pre-Tax", rows)

    def test_notes_and_kpis(self):
        p = self.projects[0]
        self.assertEqual(p["footnote"], "*Margin Pre-Tax")
        self.assertEqual([(n["label"], n["value"], n["below_kpis"]) for n in p["notes"]],
                         [("Margin w/out internal fees", 0.2627, False), ("Margin post tax", 0.17, True)])
        self.assertEqual(p["kpis"][0]["label"], "Unlevered")
        self.assertEqual(p["kpis"][0]["values"][0], ["16,5% / 1,3x", "12.0M€ / -42.4M€"])

    def test_invalid_defined_names(self):
        # Print_Titles = #N/A faz o openpyxl recusar o ficheiro; a app ignora os nomes.
        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        try:
            with zipfile.ZipFile(self.path) as zin, zipfile.ZipFile(path, "w") as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename == "xl/workbook.xml":
                        data = re.sub(rb"<definedNames>.*?</definedNames>|(?=<calcPr)",
                                      b'<definedNames><definedName name="_xlnm.Print_Titles" '
                                      b'localSheetId="1">#N/A</definedName></definedNames>',
                                      data, count=1, flags=re.S)
                    zout.writestr(item, data)
            self.assertEqual([p["name"] for p in parse_workbook(path)], ["NOLA", "OTHER"])
        finally:
            os.remove(path)

    def test_excel_export(self):
        wb = build_workbook([("File", p) for p in self.projects])
        self.assertEqual(wb.sheetnames, ["NOLA", "OTHER"])
        self.assertEqual(wb["NOLA"]["A3"].value, "NOLA")


if __name__ == "__main__":
    unittest.main()
