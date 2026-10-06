"""Testes do Vizta Debt Summary (folhas fictícias, sem dados reais).  python -m unittest"""

import datetime as dt
import unittest

import debt_summary as ds

D = dt.datetime
N = None


class DebtSummaryTest(unittest.TestCase):
    FIN = [
        (N,) * 5,
        (N, "Company:", "Empresa X, S.A.", N, N, N, N, "Total Costs", 1000, "LTC >", 0.6),
        (N, "Project:", "Projeto A", N, N, N, N, "Hard Costs", 800, "LTHC >", 0.75),
        (N, "Financing Entity:", "Banco Y"),
        (N, "Approved Loan Amount", 700),
        (N, "Loan Amount", 600, N, 1, N, N, "Status", "Financing being drawn"),
        (N, "Nº Auto", "Invoice Nr.", "Invoice Date", "Inv. Amount \n(w/o VAT)", "Inv. Amount \n(w/ VAT)",
         "% auto\n(com vistoria)", "Data Valor\ndesmobilização", "Utilization", "Drawdown", "Stamp Duty", "Acc.", "Initial", "Allowed", "Utilization"),
        (N, 1, "FT 1", D(2026, 1, 31), 100, 123, 0.1, N, 0),
        (N, 2, "FT 2", D(2026, 2, 28), 50, 61.5, 0.15, D(2026, 3, 5), 100, 99.5, 0.5, N, N, N, -100),
        (N, 3, N, N, N, 0, 0.15, D(2026, 2, 10), 40, 40, N),
        (N, 4, N, N, N, 0, 0.15, N, 0),
        (N, N, N, N, 150, 184.5, N, N, 140, 139.5, 0.5),
    ]
    INT = [
        (N, "Cálculo de juros"),
        (N, "Data", "Trimestre", "Euribor", N, N, "Trimestre", "Juros Calculado (€)", "Juros Cobrado Banco (€)", "Diferença"),
        (N, D(2026, 2, 10), "Q1 2026", 0.02, N, N, "Q1 2026", 1.5, 1.4, 0.1),
        (N, D(2026, 2, 11), "Q1 2026", 0.02, N, N, "Q2 2026", 3.0, N, N),
        (N, D(2026, 2, 12), "Q1 2026", 0.02),
    ]

    def test_financing(self):
        f = ds.parse_financing(self.FIN)
        self.assertEqual((f["company"], f["project"], f["bank"]), ("Empresa X, S.A.", "Projeto A", "Banco Y"))
        self.assertEqual((f["approved"], f["loan"], f["ltc"], f["lthc"]), (700, 600, 0.6, 0.75))
        self.assertEqual([u["date"] for u in f["utilizations"]], ["2026-02-10", "2026-03-05"])  # por data
        self.assertEqual(f["totals"], {"utilization": 140, "drawdown": 139.5, "stamp": 0.5})
        self.assertEqual((f["drawn"], f["available"]), (140, 460))
        self.assertEqual((f["work_pct"], f["last_drawdown"]), (0.15, "2026-03-05"))
        self.assertEqual(len(f["invoices"]), 2)
        self.assertFalse(f["repaid"])

    def test_repaid(self):
        rows = [r if r[1:2] != ("Loan Amount",) else (N, "Loan Amount", 600, N, N, N, N, "Status", "Repaid in full (24/07/2026)")
                for r in self.FIN]
        f = ds.parse_financing(rows)
        self.assertTrue(f["repaid"])
        self.assertEqual((f["drawn"], f["available"], f["totals"]["utilization"]), (0, 0, 140))

    def test_interests(self):
        self.assertEqual(ds.parse_interests(self.INT), [
            {"quarter": "Q1 2026", "calculated": 1.5, "charged": 1.4},
            {"quarter": "Q2 2026", "calculated": 3.0, "charged": None}])


if __name__ == "__main__":
    unittest.main()
