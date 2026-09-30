# Budget Dashboard

App local (corre só no teu PC) que junta os budgets de vários projetos num dashboard, com o formato do quadro de **Project Review**.

- Lê os ficheiros Excel diretamente das pastas do OneDrive. Não há cópias nem base de dados.
- **Não faz cálculos.** Mostra os valores tal como estão guardados no Excel, e a coluna **Δ** também vem da folha. Os valores estão em k€.
- **Atualiza sozinha.** De 5 em 5 segundos verifica se algum ficheiro mudou. Se mudou, relê-o e o dashboard atualiza sem ser preciso recarregar a página.
- Exporta para **PDF** (o projeto atual ou todos, um por página) e para **Excel** (formatado como o quadro, um separador por projeto).
- Nada sai do teu PC: o servidor só aceita ligações de `localhost` e não precisa de internet.

## Como deteta os projetos

Cada ficheiro pode ter um ou mais projetos. A app percorre as folhas visíveis de cada ficheiro. Considera "quadro de Project Review" qualquer folha que tenha, nas primeiras ~80 linhas, uma célula `Δ` no cabeçalho e uma linha `TOTAL COST`. Por exemplo, `PROJECT REVIEW -PPT` no Areeiro, ou `PR PLENO I`, `PR PLENO II` e `PR PLENO III` na Pícua.

Numa folha destas:

| O quê | Onde está |
|---|---|
| Nome do projeto | célula do cabeçalho por cima das labels (p.ex. `B6` = "PLENO I") |
| Colunas (IC, Project Reviews…) | cabeçalhos entre a coluna das labels e a coluna `Δ` (a última é destacada) |
| Linhas | todas as labels com valores entre o cabeçalho e "Orions View KPIs…" |
| KPIs | as linhas por baixo de "Orions View KPIs…" |
| Notas | "*Margin Pre-Tax", "Margin w/out internal fees", "Margin post tax" |
| Datas | "Last Project Review Date" e "Next project review date" no topo |

As linhas são encontradas pela label e não por posição fixa. Por isso, uma linha a mais (p.ex. `MARGIN (ORIONS VIEW)`) aparece sem mexer no código. As linhas `TOTAL…`/`MARGIN…` ficam a laranja e as que têm "ORION" ficam a azul.

## Instalação (Windows, uma vez)

1. Instala o **Python 3.10+** a partir de <https://www.python.org/downloads/> e marca "Add python.exe to PATH".
2. Copia `config.example.json` para `config.json` e indica os ficheiros e/ou pastas do OneDrive:

   ```json
   {
     "sources": [
       "%OneDriveCommercial%/Projetos/Areeiro/Bugdet_BP_Areeiro - NEW VERSION.xlsx",
       "%OneDriveCommercial%/Projetos/Budgets"
     ],
     "include_hidden_sheets": false,
     "port": 8765
   }
   ```

   - Cada entrada pode ser um **ficheiro** ou uma **pasta**. Numa pasta, são lidos todos os `.xlsx`/`.xlsm`, incluindo subpastas.
   - `%OneDriveCommercial%` é o OneDrive da empresa e `%OneDrive%` o pessoal. Também podes pôr o caminho completo.
   - Nos caminhos usa `/` ou `\\`. Uma `\` sozinha não é válida em JSON.
   - O `config.json` fica fora do Git, porque tem os teus caminhos pessoais.

## Arrancar

- **Duplo clique em `run.bat`.** Da primeira vez cria o ambiente Python e instala as dependências. Depois abre o browser em <http://localhost:8765>.
- **No VS Code:** abre a pasta `budget-dashboard` e carrega em F5 ("Budget Dashboard").
- **Ou no terminal:**

  ```bash
  python -m venv .venv
  .venv\Scripts\activate
  pip install -r requirements.txt
  python app.py
  ```

Para parar, fecha a janela ou carrega em Ctrl+C.

## Notas

- **Ficheiros com fórmulas e links externos.** A app lê os valores que o Excel guardou da última vez que o ficheiro foi gravado. Não recalcula nada. Se um valor estiver desatualizado no dashboard, também está no ficheiro.
- **Ficheiros abertos no Excel ou a meio de sincronizar.** Se a leitura falhar, a app continua a mostrar os últimos dados válidos e um aviso, e tenta outra vez automaticamente.
- **OneDrive "Files On-Demand".** Os ficheiros são descarregados automaticamente quando são lidos. Se quiseres, marca a pasta como "Always keep on this device".
- **PDF.** O botão *Export PDF* abre a janela de impressão do browser: escolhe "Guardar como PDF".
- **Os ficheiros Excel nunca devem ser adicionados ao Git.** O `.gitignore` desta pasta bloqueia `*.xlsx`/`*.xlsm`.

## Estrutura

```
budget-dashboard/
  app.py              servidor local (Flask), cache e deteção de alterações
  budget_parser.py    leitura das folhas de Project Review
  excel_export.py     exportação para .xlsx
  static/             dashboard (HTML/CSS/JS, sem dependências externas)
  test_budget_parser.py
  config.example.json
  run.bat
```

Testes: `python -m unittest` (usa um Excel sintético, sem dados reais).
