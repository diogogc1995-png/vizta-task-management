"""Testes da sincronização com o SharePoint, com um cliente Graph simulado.  python -m unittest"""

import json
import os
import shutil
import tempfile
import unittest

from openpyxl import Workbook

from sharepoint import GraphError, SharePointClient, app_only_scopes, encode_share_url, is_url
from test_budget_parser import make_review_sheet

SHARE = "https://contoso.sharepoint.com/:x:/s/Site/abc?e=1"


class FakeClient:
    def __init__(self, src_xlsx):
        self.src = src_xlsx
        self.sig = "c1"
        self.downloads = 0
        self.fail_list = False

    def list_excel(self, url):
        if self.fail_list:
            raise RuntimeError("HTTP 403 accessDenied")
        return [{"key": "sp:d1:i1", "name": "Budget Remote.xlsx", "drive_id": "d1", "id": "i1",
                 "sig": self.sig, "modified": 1_700_000_000.0, "web_url": "https://x/y.xlsx"}]

    def download(self, item, dest):
        self.downloads += 1
        shutil.copyfile(self.src, dest)


class FakeDataClient:
    """Ficheiros de dados (JSON e imagens) numa pasta do SharePoint simulada."""

    def __init__(self, files):
        self.files = files  # nome -> (cTag, conteúdo)
        self.downloads = []

    def list_files(self, url, exts, recursive=True):
        names = [n for n in self.files if n.lower().endswith(exts)]
        if "financing" in url:
            names = ["financing.json"]
        return [{"key": f"sp:d:{n}", "name": n, "drive_id": "d", "id": n, "sig": self.files[n][0],
                 "modified": 0, "web_url": ""} for n in names]

    def download(self, item, dest):
        self.downloads.append(item["name"])
        with open(dest, "wb") as f:
            f.write(self.files[item["name"]][1])


class SharePointSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        wb = Workbook()
        make_review_sheet(wb.active, "REMOTE")
        cls.xlsx = os.path.join(cls.tmp, "src.xlsx")
        wb.save(cls.xlsx)
        cfg = os.path.join(cls.tmp, "config.json")
        with open(cfg, "w") as f:
            json.dump({"sources": [SHARE], "sharepoint": {"client_id": "00000000-0000-0000-0000-000000000000"}}, f)
        os.environ["BUDGET_DASHBOARD_CONFIG"] = cfg
        import app
        cls.app = app
        app.CACHE_DIR = os.path.join(cls.tmp, "cache")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_encode_share_url(self):
        # Exemplo da documentação do Microsoft Graph (/shares)
        self.assertEqual(
            encode_share_url("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1"),
            "u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx")
        self.assertTrue(is_url(SHARE))
        self.assertFalse(is_url("C:/OneDrive/x.xlsx"))

    def test_app_only_scopes(self):
        self.assertEqual(app_only_scopes(["Files.Read.All"]), ["https://graph.microsoft.com/.default"])
        self.assertEqual(app_only_scopes(["https://analysis.windows.net/powerbi/api/Dataset.Read.All"]),
                         ["https://analysis.windows.net/powerbi/api/.default"])

    def test_app_only_needs_tenant(self):
        with self.assertRaises(GraphError):
            SharePointClient({"client_id": "x", "client_secret": "s"}, os.path.join(self.tmp, "tok.json"))
        c = SharePointClient({"client_id": "x", "client_secret": "s", "tenant": "11111111-1111-1111-1111-111111111111"},
                             os.path.join(self.tmp, "tok.json"))
        self.assertTrue(c.app_only)
        self.assertFalse(c.interactive)

    def test_data_files_from_sharepoint(self):
        cfg = {**self.app.cfg, "data": {"financing": "https://contoso.sharepoint.com/:u:/s/S/financing",
                                        "images": "https://contoso.sharepoint.com/:f:/s/S/imagens"}}
        store = self.app.Store(cfg)
        fin = json.dumps({"REMOTE": {"bank": "Banco X", "amount": 1000}}).encode()
        client = FakeDataClient({"financing.json": ("t1", fin), "a.jpg": ("t1", b"jpg"), "notas.txt": ("t1", b"x")})
        store.sync_data(client)
        self.assertEqual(store.financing_error, None)
        self.assertIn("remote", store.financing)
        self.assertTrue(os.path.exists(os.path.join(store.data_path("images"), "a.jpg")))
        self.assertFalse(os.path.exists(os.path.join(store.data_path("images"), "notas.txt")))
        store.sync_data(client)  # nada mudou: não volta a descarregar
        self.assertEqual(sorted(client.downloads), ["a.jpg", "financing.json"])

    def test_sync_downloads_only_when_changed(self):
        store = self.app.Store(self.app.cfg)
        client = FakeClient(self.xlsx)
        store.refresh()  # o link não conta como caminho local em falta
        self.assertEqual(store.missing, [])

        store.sync_sharepoint(client)
        snap = store.snapshot()
        self.assertEqual([(f["file"], f["remote"]) for f in snap["files"]], [("Budget Remote.xlsx", True)])
        self.assertEqual(snap["files"][0]["projects"][0]["name"], "REMOTE")
        v1 = store.version

        store.sync_sharepoint(client)
        self.assertEqual(client.downloads, 1)
        self.assertEqual(store.version, v1)

        client.sig = "c2"
        store.sync_sharepoint(client)
        self.assertEqual(client.downloads, 2)
        self.assertNotEqual(store.version, v1)

        # link inacessível: aviso, mas mantém os últimos dados
        client.fail_list = True
        store.sync_sharepoint(client)
        snap = store.snapshot()
        self.assertEqual(len(snap["files"]), 1)
        self.assertIn("accessDenied", snap["source_errors"][0]["error"])


if __name__ == "__main__":
    unittest.main()
