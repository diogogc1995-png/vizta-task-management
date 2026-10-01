"""Testes da montagem do Typology Report a partir de linhas do Power BI (valores fictícios)."""

import unittest
from unittest import mock

import powerbi


class TypologyTest(unittest.TestCase):
    ROWS = [  # formato do executeQueries: "Tabela[Coluna]" / "[Medida]"
        {"Units[project]": "Projeto A", "Units[status]": "PSPA", "Units[typology]": "T2", "[units]": 3, "[amount]": 900000, "[area]": 300},
        {"Units[project]": "Projeto A", "Units[status]": "PSPA", "Units[typology]": "T1", "[units]": 2, "[amount]": 400000, "[area]": 120},
        {"Units[project]": "Projeto A", "Units[status]": "Reservation", "Units[typology]": "T2", "[units]": 1, "[amount]": 310000, "[area]": 100},
        {"Units[project]": "Projeto A", "Units[status]": "Available to sell", "Units[typology]": "T3+1", "[units]": 1, "[amount]": 500000, "[area]": 150},
        {"Units[project]": "Projeto A", "Units[status]": "Off-market", "Units[typology]": "Retail", "[units]": 1, "[amount]": 200000, "[area]": 80},
        {"Units[project]": "Projeto A", "Units[status]": "Withdrawal", "Units[typology]": "T1", "[units]": 9, "[amount]": 1, "[area]": 1},
    ]

    def test_build_typology(self):
        out = powerbi.build_typology(self.ROWS)
        a = out["projeto a"]
        self.assertEqual(a["typologies"], ["T1", "T2", "T3+1"])  # ordenadas; retalho à parte
        rows = {r["status"]: r for r in a["rows"]}
        self.assertEqual([r["status"] for r in a["rows"]], ["PSPA", "Reserved", "Off-market", "Available"])
        self.assertEqual(rows["PSPA"]["units"], {"T2": 3, "T1": 2})
        self.assertEqual((rows["PSPA"]["amount"], rows["PSPA"]["area"]), (1300000, 420))
        self.assertEqual(rows["Reserved"]["units"], {"T2": 1})
        self.assertEqual((rows["Off-market"]["retail_units"], rows["Off-market"]["retail_amount"]), (1, 200000))
        self.assertEqual(rows["Available"]["units"], {"T3+1": 1})
        # estado desconhecido (Withdrawal) é ignorado
        self.assertEqual(sum(sum(r["units"].values()) for r in a["rows"]), 7)

    def test_client_finds_dataset_and_queries(self):
        auth = mock.Mock()
        auth.token.return_value = "tok"
        client = powerbi.PowerBIClient(auth, {"app_id": "app", "report_id": "rep", "typology_query": "EVALUATE X"})
        responses = [{"datasetId": "ds1"}, {"results": [{"tables": [{"rows": self.ROWS}]}]}]
        calls = []

        def fake(method, url, **kw):
            calls.append((method, url, kw.get("json")))
            r = mock.Mock(status_code=200)
            r.json.return_value = responses.pop(0)
            return r

        client.session.request = fake
        out = client.typology()
        self.assertIn("projeto a", out)
        self.assertEqual(calls[0][:2], ("GET", f"{powerbi.API}/apps/app/reports/rep"))
        self.assertEqual(calls[1][:2], ("POST", f"{powerbi.API}/datasets/ds1/executeQueries"))
        self.assertEqual(calls[1][2]["queries"][0]["query"], "EVALUATE X")
        auth.token.assert_called_with(powerbi.SCOPES)

    def test_load_snapshot(self):
        import json, os, tempfile
        snap = {"_as_of": "2026-10-01 13:02", "_typologies": ["T1", "T2"],
                "Projeto  A": {"units": [["PSPA", "line", [1, None], 1, 50, None, 1]],
                               "amounts": [["PSPA", "line", 100, 10, 50, None, 100]]}}
        fd, path = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(snap, f)
        try:
            data, as_of, err = powerbi.load_snapshot(path)
        finally:
            os.remove(path)
        self.assertIsNone(err)
        self.assertEqual(as_of, "2026-10-01 13:02")
        a = data["projeto a"]
        self.assertEqual(a["units_rows"][0]["units"], {"T1": 1, "T2": None})
        self.assertEqual((a["amount_rows"][0]["price_sqm"], a["amount_rows"][0]["pct"]), (10, 50))
        self.assertEqual(powerbi.load_snapshot(path + ".x"), ({}, None, None))

    def test_missing_query_is_explained(self):
        client = powerbi.PowerBIClient(mock.Mock(), {"app_id": "a", "report_id": "r"})
        with self.assertRaises(powerbi.PowerBIError) as ctx:
            client.typology()
        self.assertIn("--probe", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
