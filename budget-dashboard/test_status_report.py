"""Testes do ponto de situação (atas fictícias, sem dados reais).  python -m unittest"""

import datetime as dt
import unittest

import status_report as sr

D = dt.datetime


class StatusReportTest(unittest.TestCase):
    MAIN = [
        (None,) * 22 + ("REUNIÃO", "Projecto"),
        ("ID", "PROJETO", "GP", "Área", "TITULO", "DESCRIÇÃO", "ACÇÂO", "RESP", "DEP", "DATA CRIACAO",
         "DATA OBJ INICIAL", "DATA OBJ ATUAL", "REUNIÃO", "ESTADO"),
        ("P1", "Projeto A", "XX", "OBRA", "Betão", "Descr 1", "Fazer X", "AB", "OP", D(2026, 1, 5), D(2026, 2, 1), D(2026, 3, 1), "RP", "Pendente"),
        ("P1", "Projeto A", "XX", "Pós Venda", "Fissuras", "Descr 2", "Ver Y", "AB", "OP", D(2026, 1, 5), None, dt.time(0, 0), "RP", "Standby"),
        ("P1", "Projeto A", "XX", "OBRA", "Antigo", "Descr 3", "-", "AB", "OP", D(2025, 1, 5), None, None, "RP", "Arquivado"),
        ("P2", "Outro", "XX", "LEGAL", "Contrato", "Descr 4", "-", "CD", "LEGAL", None, None, None, "RP", "Pendente"),
    ]
    # outro ficheiro, com outra ordem de colunas e uma linha de grupos por cima do cabeçalho
    AREEIRO = [
        ("ASSUNTO", "DESCRIÇÃO", "AÇÕES / DECISÕES", "RESP.", "DEP.", "DATA CRIAÇÃO", "DATA OBJECTIVO", "DATA ACTUALIZADA", "ESTADO"),
        ("PROJETO", "GRUPO", "FASES/GRUPOS ", "ASSUNTO", "DESCRIÇÃO", "DESCRITIVO / NOTAS NO SUB-ELEM", "RESP.", "DEP.",
         "DATA CRIAÇÃO", "DATA OBJECTIVO", "DATA ACTUALIZADA", "ESTADO"),
        ("PA", None, "7 - COMERCIAL", "Betão", "Descr 1", "Repetido", "AB", "OP", None, D(2026, 2, 1), None, "Pendente"),
        ("PA", "LICENCIAMENTO", "1 - PROJETO", "Licença", "Descr 5", "Pedir", "EF", "GP", None, D(2026, 5, 1), D(2026, 11, 6), "Standby"),
    ]

    def test_parse_and_group(self):
        a = sr.parse_rows(self.MAIN, "main.xlsx")
        self.assertEqual([i["title"] for i in a], ["Betão", "Fissuras", "Contrato"])  # sem "Arquivado"
        first, second = a[0], a[1]
        self.assertEqual((first["area"], first["owner"], first["dept"]), ("OBRA", "AB", "OP"))
        self.assertEqual((first["created"], first["target_initial"], first["target"]), ("2026-01-05", "2026-02-01", "2026-03-01"))
        self.assertEqual((second["area"], second["status"], second["target"]), ("PÓS-VENDA", "Standby", None))  # "00:00:00" = vazio

        b = sr.parse_rows(self.AREEIRO, "areeiro.xlsx")
        self.assertEqual([(i["title"], i["area"], i["action"], i["target"]) for i in b],
                         [("Betão", "7 - COMERCIAL", "Repetido", None), ("Licença", "LICENCIAMENTO", "Pedir", "2026-11-06")])

        groups, unmatched = sr.group_by_project(a + b, {"Projeto A": "PROJ A", "PA": "PROJ A"})
        self.assertEqual([i["title"] for i in groups["proj a"]], ["Betão", "Fissuras", "Licença"])  # "Betão" repetido conta 1 vez
        self.assertEqual(unmatched, ["Outro"])

    def test_missing_header(self):
        with self.assertRaises(ValueError):
            sr.parse_rows([("a", "b"), ("c", "d")], "x.xlsx")


if __name__ == "__main__":
    unittest.main()
