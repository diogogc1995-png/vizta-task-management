"""Informação societária de cada projeto, lida da certidão permanente (CRC) mais recente da sociedade.

Pasta "Sociedades" do Legal (config.json -> "legal" -> "folder"): uma subpasta por sociedade. Em cada
uma procura os PDFs da certidão permanente (nome com "CRC" ou "Certidão Permanente"), lê-os e usa o
mais recente que esteja completo (com os órgãos sociais). Liga também à certidão, aos estatutos e ao
RCBE mais recentes. A ligação projeto -> sociedade vem de config.json -> "legal" -> "companies".
"""

import datetime as dt
import os
import re
import unicodedata

DOC_EXT = (".pdf", ".docx", ".doc")
SKIP_DIRS = re.compile(r"^(old|activos|partilha|checklist)\b", re.I)
CRC_NAME = re.compile(r"(^|[^a-z])crc([^a-z]|$)|certid[aã]o\s*permanente|certidaopermanente", re.I)
# linhas do cabeçalho/rodapé do site do registo, repetidas em cada página
NOISE = re.compile(
    r"^(Certidão de Registo|Certidão$|Permanente$|de Registo$|Comercial$|A certidão encontra-se|atualizada\.|"
    r"A entrega deste código|apresentação de uma certidão|Comercial\)|https?://|\d{2}/\d{2}/\d{2}, \d{2}:\d{2}|"
    r"Os elementos constantes da matrícula|respectivos averbamentos|jurídica da entidade|Código de [Aa]cesso:)")


def _fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def _date(s):
    """'20/11/2026', '28-12-2026', '2026-03-10' ou '27/03/26' -> 'AAAA-MM-DD'."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s or "")
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", s or "")
    if not m:
        return None
    y = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
    try:
        return dt.date(y, int(m[2]), int(m[1])).isoformat()
    except ValueError:
        return None


def pdf_text(path):
    import pypdf
    return "\n".join((p.extract_text() or "") for p in pypdf.PdfReader(_lp(path)).pages)


def _lp(path):
    """Caminhos com mais de 260 caracteres no Windows (pastas do SharePoint muito fundas)."""
    if os.name == "nt" and len(path) > 240 and not path.startswith("\\\\?\\"):
        return "\\\\?\\" + os.path.abspath(path)
    return path


def _mtime(path):
    return os.path.getmtime(_lp(path))


def parse_crc(text):
    """Campos da matrícula da certidão permanente (a situação atual da sociedade)."""
    text = unicodedata.normalize("NFC", text)  # algumas certidões trazem "Ó" decomposto
    out = {}
    m = re.search(r"C[oó]digo de [Aa]cesso:\s*([\d-]{10,})\s*V[aá]lida at[eé]:\s*([\d/-]+)", text)
    if m:
        out["code"], out["valid_until"] = m[1], _date(m[2])
    m = re.search(r"^(\d{2}/\d{2}/\d{2}), \d{2}:\d{2}", text, re.M)
    if m:
        out["consulted"] = _date(m[1])
    start = text.find("Matrícula")
    if start < 0:
        return out
    end = len(text)
    for stop in ("Inscrições - Averbamentos", "Inscrições -", "\nInsc.1"):
        i = text.find(stop, start)
        if i > 0:
            end = min(end, i)
    body = text[start + len("Matrícula"):end]
    body = re.sub(r"de uma certidão em papel\.?\s*\(artº 75º, nº ?5 do Código do Registo Comercial\)", "", body)
    lines = [ln.strip() for ln in body.splitlines()]
    lines = [ln for ln in lines if ln and not NOISE.match(ln)]
    # a matrícula repete-se em cada página nas certidões impressas do portal novo: só a primeira
    joined, seen = [], False
    for ln in lines:
        if ln.startswith(("NIF/NIPC:", "NIPC:")) and seen and not (joined and joined[-1].startswith("Nome:")):
            break
        seen = seen or ln.startswith(("NIF/NIPC:", "NIPC:"))
        joined.append(ln)
    lines = joined
    # factos pendentes de registo (podem alterar a certidão): guardados à parte
    pend_at = next((i for i, ln in enumerate(lines) if ln.startswith("Factos pendentes")), None)
    if pend_at is not None:
        pend = " ".join(lines[pend_at + 1:])
        out["pending"] = [re.sub(r"\s+", " ", f).strip() for f in re.split(r"Facto \d+\s*", pend) if f.strip()]
        lines = lines[:pend_at]
    lines = [ln for ln in lines if not ln.startswith("Entidade com os documentos")]

    labels = {
        "nipc": r"(NIF/)?NIPC", "firm": r"Firma", "legal_form": r"Natureza Jur[ií]dica", "address": r"Sede",
        "object": r"Objec?to", "capital": r"Capital", "cae": r"CAE Principal",
        "year_end": r"Data do\b.*|Data de Encerramento.*", "binding": r"Forma de Obrigar",
        "term": r"Prazo de dura[cç][aã]o.*",
    }
    head = re.compile(r"^(" + "|".join(f"(?P<{k}>{v})" for k, v in labels.items()) + r")\s*:?\s*(?P<rest>.*)$", re.I)
    organs_at = next((i for i, ln in enumerate(lines) if re.search(r"[ÓO]rg[aã]os(\s|$)", ln)), None)
    if organs_at is not None and not lines[organs_at].startswith(("Órgãos", "Orgãos", "Orgaos")):
        # "assinatura de dois gerentes. Órgãos Sociais/...": o título vem na mesma linha
        pre, post = re.split(r"(?=[ÓO]rg[aã]os(?:\s|$))", lines[organs_at], maxsplit=1)
        lines = lines[:organs_at] + [pre.strip(), post] + lines[organs_at + 1:]
        organs_at += 1
    fields, cur = {}, None
    for ln in lines[:organs_at]:
        mm = head.match(ln)
        key = next((k for k in labels if mm and mm.group(k)), None) if mm else None
        if key and key not in fields:
            cur = key
            fields[key] = [mm.group("rest")] if mm.group("rest") else []
        elif cur:
            fields[cur].append(ln)
    for k, parts in fields.items():
        txt = " ".join(p for p in parts if p and p not in ("Encerramento do", "Exercício:", "dos(s) Mandato(s):"))
        txt = re.sub(r"^(Encerramento do Exercício:|Exercício:|dos\(s\) Mandato\(s\):)\s*", "", txt).strip()
        out[k] = re.sub(r"\s+", " ", txt).strip(" :")
    if out.get("nipc"):
        out["nipc"] = re.sub(r"\D", "", out["nipc"])[:9]
    if out.get("address"):
        # "Rua X ... Distrito: Lisboa — Concelho: Lisboa — Freguesia: Y 1070 374 Lisboa" -> "Rua X ..., 1070-374 Lisboa"
        a = re.sub(r"\b(Morada|Código Postal):\s*", "", out["address"])
        cp = re.search(r"(\d{4})\s*[-–]?\s*(\d{3})\s+([^\d—]+?)\s*$", a)
        street = re.split(r"\s*Distrito:", a)[0].strip(" ,")
        if cp:
            street = street.replace(cp.group(0), "").strip(" ,")
            a = f"{street}, {cp[1]}-{cp[2]} {cp[3].strip().title()}"
        else:
            a = street
        out["address"] = a
    if out.get("cae"):
        parts = re.split(r"\s*CAE Secund[aá]rio \(\d+\):\s*", out["cae"])
        out["cae"], out["cae_secondary"] = parts[0].strip(), [p.strip() for p in parts[1:] if p.strip()]
    if out.get("legal_form"):
        out["legal_form"] = out["legal_form"].capitalize()

    # órgãos sociais: "CONSELHO DE ADMINISTRAÇÃO:" / "GERÊNCIA:" / "FISCAL ÚNICO:" + Nome / NIF / Cargo
    organs = []
    if organs_at is not None:
        group = None
        title = re.compile(r"((?:\b[A-ZÀ-Ý()/\-]{2,}\s*)+):\s*$")
        for ln in lines[organs_at:]:
            for tk in (t.strip() for t in re.split(r"(?=Nome:)|(?=NIF/NIPC:)|(?=NIPC:)|(?=Cargo:)", ln)):
                if not tk:
                    continue
                if tk.startswith("Nome:"):
                    if group is None:
                        group = {"organ": "", "members": []}
                        organs.append(group)
                    group["members"].append({"name": tk[5:].strip()})
                elif tk.startswith(("NIF/NIPC:", "NIPC:")):
                    if group and group["members"]:
                        group["members"][-1]["nif"] = re.sub(r"\D", "", tk.split(":", 1)[1])[:9]
                    tail = re.sub(r"^(NIF/)?NIPC:\s*\d[\d ]*", "", tk).strip()  # "NIF: 123 FISCAL ÚNICO:"
                    mm = title.search(tail)
                    if mm:
                        group = {"organ": mm[1].strip(), "members": []}
                        organs.append(group)
                elif tk.startswith("Cargo:"):
                    role = tk.split(":", 1)[1].strip()
                    mm = title.search(role)
                    if mm:  # "Cargo: Vogal FISCAL ÚNICO:"
                        role = role[:mm.start()].strip()
                    if group and group["members"] and role:
                        group["members"][-1]["role"] = role[:1].upper() + role[1:].lower()
                    if mm:
                        group = {"organ": mm[1].strip(), "members": []}
                        organs.append(group)
                else:
                    mm = title.search(tk)
                    if mm:
                        group = {"organ": mm[1].strip(), "members": []}
                        organs.append(group)
    out["organs"] = [g for g in organs if g["members"]]
    return out


def _walk(folder):
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not SKIP_DIRS.match(d)]
        for f in files:
            if f.lower().endswith(DOC_EXT) and not f.startswith("~$"):
                yield os.path.join(root, f)


def _latest(paths, pattern):
    hits = [p for p in paths if re.search(pattern, os.path.basename(p), re.I)]
    # PDF antes de Word, depois o mais recente
    return max(hits, key=lambda p: (p.lower().endswith(".pdf"), _mtime(p)), default=None)


def company_info(folder, cache=None):
    """Dados da sociedade a partir da pasta dela. cache: {caminho: (mtime, campos)} para não reler PDFs."""
    cache = {} if cache is None else cache
    files = list(_walk(folder))
    words = [w for w in re.findall(r"[a-z]{4,}", _fold(os.path.basename(folder))) if w not in ("vizta", "lda")]
    best, newest = None, None
    for p in files:
        if not (p.lower().endswith(".pdf") and CRC_NAME.search(os.path.basename(p))):
            continue
        mt = _mtime(p)
        if p not in cache or cache[p][0] != mt:
            try:
                cache[p] = (mt, parse_crc(pdf_text(p)))
            except Exception as e:  # PDF ilegível: ignora este
                cache[p] = (mt, {"error": f"{type(e).__name__}: {e}"})
        info = cache[p][1]
        if not info.get("firm"):
            continue
        # certidões de outras entidades guardadas na pasta (p.ex. de um vendedor): o nome tem de bater
        if words and not any(w in _fold(info["firm"]) for w in words):
            continue
        when = info.get("consulted") or dt.date.fromtimestamp(mt).isoformat()
        cand = (when, mt, p, info)
        if newest is None or cand[:2] > newest[:2]:
            newest = cand
        if info.get("organs") and (best is None or cand[:2] > best[:2]):
            best = cand
    chosen = best or newest
    if not chosen:
        return {"error": "Certidão permanente não encontrada na pasta da sociedade"}
    when, _, path, info = chosen
    out = {**info, "as_of": when, "crc_file": path,
           "statutes_file": _latest(files, r"estatutos"),
           "rcbe_file": _latest([p for p in files if p.lower().endswith(".pdf")], r"rcbe")}
    if newest and newest[2] != path:
        # há uma certidão mais recente, mas sem os órgãos sociais: dados da última completa,
        # código de acesso, validade e link da mais recente
        out["newer_incomplete"] = newest[0]
        out["crc_file"] = newest[2]
        for k in ("code", "valid_until"):
            if newest[3].get(k):
                out[k] = newest[3][k]
    return out


def load(conf, cache=None):
    """{nome do projeto normalizado: dados da sociedade}; erros por projeto em "error"."""
    folder = os.path.normpath(os.path.expandvars(conf.get("folder", "")))
    out = {}
    if not folder or not os.path.isdir(folder):
        return out, f"Pasta das sociedades não encontrada: {conf.get('folder')}"
    for project, company in (conf.get("companies") or {}).items():
        project = " ".join(str(project).split()).casefold()  # como financing.key
        path = os.path.join(folder, company)
        if not os.path.isdir(path):
            out[project] = {"company": company, "error": f"Pasta '{company}' não encontrada"}
            continue
        out[project] = {"company": company, **company_info(path, cache)}
    return out, None


def web_link(path, folder, web_folder):
    """Link do SharePoint para um ficheiro da pasta das sociedades (abre no browser)."""
    if not path or not web_folder:
        return None
    from urllib.parse import quote
    rel = os.path.relpath(path, folder).replace("\\", "/")
    base = quote(web_folder.rstrip("/"), safe=":/%")
    return base + "/" + "/".join(quote(p) for p in rel.split("/")) + "?web=1"


def wanted_name(name):
    """Ficheiros a copiar do SharePoint no servidor: certidões, estatutos e RCBE."""
    return name.lower().endswith(DOC_EXT) and bool(CRC_NAME.search(name) or re.search(r"estatutos|rcbe", name, re.I))
