"""Testes do financing.json (valores fictícios).  python -m unittest"""

import json
import os
import tempfile
import unittest

import financing
from excel_export import write_financing
from openpyxl import Workbook

SAMPLE = {
    "_info": "comentário",
    "Projeto  Teste": {
        "bank": "Banco", "signed": "2025-11-30", "amount": 1000000,
        "term_months": 48, "availability_months": 3, "index": "Euribor 3M", "spread": 1.375,
        "distributions": {"max": 500000, "conditions": ["Obra ≥ 50%"], "note": "Nota"},
    },
}


class FinancingTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".json")
        os.close(fd)

    def tearDown(self):
        os.remove(self.path)

    def write(self, content):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(content if isinstance(content, str) else json.dumps(content))

    def test_load_and_dates(self):
        self.write(SAMPLE)
        data, err = financing.load(self.path)
        self.assertIsNone(err)
        self.assertEqual(list(data), ["projeto teste"])  # comentários ignorados, nome normalizado
        c = data[financing.key("PROJETO TESTE")]
        self.assertEqual(c["maturity"], "2029-11-30")
        self.assertEqual(c["availability_end"], "2026-02-28")  # fim de mês ajustado
        self.assertEqual(c["project"], "Projeto  Teste")

    def test_missing_and_invalid(self):
        self.assertEqual(financing.load(self.path + ".nao-existe"), ({}, None))
        self.write("{ inválido")
        data, err = financing.load(self.path)
        self.assertEqual(data, {})
        self.assertIn("financing.json inválido", err)

    def test_excel_block(self):
        self.write(SAMPLE)
        c = next(iter(financing.load(self.path)[0].values()))
        ws = Workbook().active
        write_financing(ws, 1, c, 5)
        values = [v for row in ws.iter_rows(values_only=True) for v in row if v is not None]
        self.assertIn("Euribor 3M + 1,375%", values)
        self.assertIn("Distributions to promoter — up to 500 000 €", values)
        self.assertIn("• Obra ≥ 50%", values)


if __name__ == "__main__":
    unittest.main()
