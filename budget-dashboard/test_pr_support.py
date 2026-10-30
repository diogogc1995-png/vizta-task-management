"""Testes do ficheiro de apoio ao Project Review (folha fictícia, sem dados reais).  python -m unittest"""

import unittest

import pr_support as ps

N = None


class PrSupportTest(unittest.TestCase):
    ROWS = [
        (N, N, N, N, N, "Capex", N, "Fin/Eq/Sales", N, "Margin", N, "Acq. Fin / \nRecap ", N, "Guarantee"),
        (N,),
        (N, N, N, "Projeto A\n(signed)", N, 20.0, N, "10,0M€ (80% HC)\n4,0M€\n6,0M€", N, "1,5%\n(+Euribor 3M)", N, "- / 1M€", N, "Mortgage"),
        (N, N, N, "Data for graphs - Sources & Uses"),
        (N, N, N, N, N, "Financing", N, "Equity", N, "Sales", N, "Total costs"),
        (N, N, N, "Proj A", N, 10.0, N, 4.0, N, 6.0, N, 20.0),
        (N, N, N, "Outro"),
    ]

    def test_parse(self):
        d = ps.parse_rows(self.ROWS)
        f = d["financing"]["Projeto A"]
        self.assertEqual((f["status"], f["capex"], f["financing"], f["equity"], f["sales"]), ("signed", 20.0, "10,0M€ (80% HC)", "4,0M€", "6,0M€"))
        self.assertEqual((f["margin"], f["recap"], f["guarantee"]), ("1,5% (+Euribor 3M)", "- / 1M€", "Mortgage"))
        self.assertEqual(d["su"], {"Proj A": {"financing": 10.0, "equity": 4.0, "sales": 6.0, "total": 20.0}})

    def test_by_project(self):
        d = ps.parse_rows(self.ROWS)
        out = ps.by_project(d, {"Projeto A": "PROJ A", "Proj A": "PROJ A"})
        self.assertEqual(set(out["proj a"]), {"financing", "su"})


if __name__ == "__main__":
    unittest.main()
