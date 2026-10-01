"""Leitura de ficheiros diretamente do SharePoint/OneDrive via Microsoft Graph.

Aceita links de partilha ("Copy link") de ficheiros ou de pastas. O login é
feito com a conta Microsoft do utilizador (MSAL); o token fica guardado em
token_cache.json para não pedir login a cada arranque.

Requer uma "App registration" no Azure AD do tenant (ver README).
"""

import base64
import datetime as dt
import os
import threading
import urllib.parse

import msal
import requests

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Files.Read.All"]
EXCEL_EXT = (".xlsx", ".xlsm")


def is_url(source):
    return isinstance(source, str) and source.lower().startswith(("https://", "http://"))


def encode_share_url(url):
    """Formato pedido pelo endpoint /shares: 'u!' + base64url sem padding."""
    b64 = base64.urlsafe_b64encode(url.encode("utf-8")).decode("ascii")
    return "u!" + b64.rstrip("=")


def _strip_query(url):
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _ts(iso):
    if not iso:
        return None
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


class GraphError(Exception):
    pass


class SharePointClient:
    def __init__(self, sp_cfg, cache_path):
        self.cfg = sp_cfg
        client_id = sp_cfg.get("client_id")
        if not client_id:
            raise GraphError("Falta 'sharepoint.client_id' no config.json (ver README: App registration).")
        tenant = sp_cfg.get("tenant") or "organizations"
        self.cache_path = cache_path
        self.cache = msal.SerializableTokenCache()
        if os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as f:
                self.cache.deserialize(f.read())
        self.app = msal.PublicClientApplication(
            client_id, authority=f"https://login.microsoftonline.com/{tenant}",
            token_cache=self.cache)
        self.session = requests.Session()
        self._login_lock = threading.Lock()
        # Depois de um login falhado não volta a abrir o browser sozinho em cada ciclo.
        self._login_failed = False

    # ---------- autenticação ----------
    def _save_cache(self):
        if self.cache.has_state_changed:
            with open(self.cache_path, "w", encoding="utf-8") as f:
                f.write(self.cache.serialize())

    def token(self, scopes=None):
        """Token de acesso (por omissão para o Graph; o Power BI pede os seus próprios scopes)."""
        scopes = scopes or SCOPES
        with self._login_lock:
            accounts = self.app.get_accounts(username=self.cfg.get("login_hint")) or self.app.get_accounts()
            result = None
            if accounts:
                result = self.app.acquire_token_silent(scopes, account=accounts[0])
            if not result or "access_token" not in result:
                if self._login_failed:
                    raise GraphError("Login Microsoft necessário: reinicia a app para voltar a fazer login.")
                self._login_failed = True
                if self.cfg.get("auth_flow") == "device_code":
                    flow = self.app.initiate_device_flow(scopes=scopes)
                    if "user_code" not in flow:
                        raise GraphError(f"Login falhou: {flow.get('error_description', flow)}")
                    print("\n" + flow["message"] + "\n", flush=True)
                    result = self.app.acquire_token_by_device_flow(flow)
                else:
                    print("A abrir o browser para login na Microsoft...", flush=True)
                    result = self.app.acquire_token_interactive(
                        scopes, login_hint=self.cfg.get("login_hint"), prompt="select_account")
            if "access_token" not in result:
                raise GraphError(f"Login falhou: {result.get('error')}: {result.get('error_description')}")
            self._login_failed = False
            self._save_cache()
            return result["access_token"]

    # ---------- Graph ----------
    def _get(self, url, stream=False):
        r = self.session.get(url, headers={"Authorization": f"Bearer {self.token()}"},
                             timeout=120, stream=stream)
        if r.status_code >= 400:
            try:
                err = r.json().get("error", {})
                msg = f"{err.get('code')}: {err.get('message')}"
            except ValueError:
                msg = r.text[:200]
            raise GraphError(f"HTTP {r.status_code} {msg}")
        return r

    def resolve(self, share_url):
        """driveItem apontado por um link de partilha (ficheiro ou pasta)."""
        last = None
        for candidate in dict.fromkeys([share_url, _strip_query(share_url)]):
            try:
                return self._get(f"{GRAPH}/shares/{encode_share_url(candidate)}/driveItem").json()
            except GraphError as e:
                last = e
        raise last

    def _children(self, drive_id, item_id):
        url = f"{GRAPH}/drives/{drive_id}/items/{item_id}/children?$top=200"
        while url:
            data = self._get(url).json()
            yield from data.get("value", [])
            url = data.get("@odata.nextLink")

    @staticmethod
    def _describe(item, drive_id):
        return {
            "key": f"sp:{drive_id}:{item['id']}",
            "name": item["name"],
            "drive_id": drive_id,
            "id": item["id"],
            # cTag muda só quando o conteúdo muda (eTag muda também com metadados)
            "sig": item.get("cTag") or item.get("eTag") or item.get("lastModifiedDateTime"),
            "modified": _ts(item.get("lastModifiedDateTime")),
            "web_url": item.get("webUrl"),
        }

    def list_excel(self, share_url):
        """Ficheiros Excel do link: o próprio ficheiro, ou todos os de uma pasta (recursivo)."""
        root = self.resolve(share_url)
        drive_id = root.get("parentReference", {}).get("driveId")
        if "folder" not in root:
            return [self._describe(root, drive_id)]
        out, stack = [], [root["id"]]
        while stack:
            for child in self._children(drive_id, stack.pop()):
                if "folder" in child:
                    stack.append(child["id"])
                elif child["name"].lower().endswith(EXCEL_EXT) and not child["name"].startswith("~$"):
                    out.append(self._describe(child, drive_id))
        return out

    def download(self, item, dest):
        r = self._get(f"{GRAPH}/drives/{item['drive_id']}/items/{item['id']}/content", stream=True)
        tmp = dest + ".part"
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
        os.replace(tmp, dest)
