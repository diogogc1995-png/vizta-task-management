"""Testes do leitor das certidões permanentes (texto fictício, sem dados reais).  python -m unittest"""

import os
import shutil
import tempfile
import unittest
from unittest import mock

import legal

CRC = """Matrícula
NIF/NIPC: 500000001
Firma: EMPRESA TESTE, S.A.
Natureza Jurídica: SOCIEDADE ANóNIMA
Sede: Rua do Teste, nº 1, 2º andar
Distrito: Lisboa — Concelho: Lisboa — Freguesia: Avenidas Novas
1050 185 LISBOA
Objecto: Promoção imobiliária e
gestão de imóveis próprios
Capital: 50.000,00 Euros
CAE Principal: 68120-R4 - Desenvolvimento de projetos de edifícios CAE Secundário (1): 68200-R4 - Arrendamento
Data do
Encerramento do
Exercício:
31 Dezembro
Forma de Obrigar: com a assinatura de dois administradores.
Prazo de duração
dos(s) Mandato(s):
quadriénio 2024/2027.
Órgãos
Sociais/Liquidatário
CONSELHO DE ADMINISTRAÇÃO:
Nome: MARIA TESTE
NIF/NIPC: 100000002
Certidão de Registo
Código de acesso: 1111-2222-3333 Válida até: 20/11/2026 Certidão Válida
27/03/26, 12:49 Consulta de Certidão Permanente
https://registo.justica.gov.pt/x 1/7/Administrador ou
Cargo: Presidente
Nome: JOÃO TESTE
NIF/NIPC: 100000003
Cargo: Vogal
FISCAL ÚNICO:
Nome: AUDITORA TESTE, SROC S.A.
NIF/NIPC: 500000004
Entidade com os documentos integralmente depositados em suporte electrónico.
Factos pendentes de elaboração ( susceptíveis de alterar o conteúdo da certidão )
Facto 1 AP. 1/20260220 - Mudança da sede
Inscrições - Averbamentos - Anotações
Insc.1 AP. 20/20220211 - CONSTITUIÇÃO
"""


class LegalTest(unittest.TestCase):
    def test_parse_crc(self):
        d = legal.parse_crc(CRC)
        self.assertEqual((d["nipc"], d["firm"], d["legal_form"]), ("500000001", "EMPRESA TESTE, S.A.", "Sociedade anónima"))
        self.assertEqual(d["address"], "Rua do Teste, nº 1, 2º andar, 1050-185 Lisboa")
        self.assertEqual(d["object"], "Promoção imobiliária e gestão de imóveis próprios")
        self.assertEqual(d["cae"], "68120-R4 - Desenvolvimento de projetos de edifícios")
        self.assertEqual(d["cae_secondary"], ["68200-R4 - Arrendamento"])
        self.assertEqual((d["year_end"], d["term"]), ("31 Dezembro", "quadriénio 2024/2027."))
        self.assertEqual((d["code"], d["valid_until"], d["consulted"]), ("1111-2222-3333", "2026-11-20", "2026-03-27"))
        self.assertEqual([g["organ"] for g in d["organs"]], ["CONSELHO DE ADMINISTRAÇÃO", "FISCAL ÚNICO"])
        self.assertEqual([(m["name"], m.get("role")) for m in d["organs"][0]["members"]],
                         [("MARIA TESTE", "Presidente"), ("JOÃO TESTE", "Vogal")])
        self.assertEqual(d["pending"], ["AP. 1/20260220 - Mudança da sede"])

    def test_company_info_picks_latest_complete(self):
        tmp = tempfile.mkdtemp()
        try:
            folder = os.path.join(tmp, "Empresa Teste")
            os.makedirs(os.path.join(folder, "old"))
            files = {"CRC_Empresa_2025.pdf": CRC.replace("27/03/26", "01/01/25"),
                     "CRC_Empresa_2026.pdf": CRC,
                     "Certidao Permanente_incompleta.pdf": CRC.split("Órgãos")[0].replace("27/03/26", "01/09/26") + "\n28/09/26, 10:00 IRN",
                     "old/CRC_antiga.pdf": CRC.replace("27/03/26", "01/12/26"),
                     "Estatutos_Empresa.pdf": "", "RCBE_Empresa.pdf": ""}
            for name, _ in files.items():
                open(os.path.join(folder, *name.split("/")), "w").close()
            texts = {os.path.join(folder, *n.split("/")): t for n, t in files.items()}
            with mock.patch.object(legal, "pdf_text", lambda p: texts[p]):
                info = legal.company_info(folder)
            self.assertEqual(info["as_of"], "2026-03-27")  # dados da última completa; a pasta "old" não conta
            self.assertEqual(info["newer_incomplete"], "2026-09-28")
            self.assertTrue(info["crc_file"].endswith("Certidao Permanente_incompleta.pdf"))  # link da mais recente
            self.assertTrue(info["statutes_file"].endswith("Estatutos_Empresa.pdf"))
            self.assertTrue(info["rcbe_file"].endswith("RCBE_Empresa.pdf"))
            link = legal.web_link(os.path.join(folder, "CRC_Empresa_2026.pdf"), tmp, "https://x.sharepoint.com/sites/S/Nexity Docs/Sociedades")
            self.assertEqual(link, "https://x.sharepoint.com/sites/S/Nexity%20Docs/Sociedades/Empresa%20Teste/CRC_Empresa_2026.pdf?web=1")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
