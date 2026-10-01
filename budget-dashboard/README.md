# Budget Dashboard

App local (corre só no teu PC) que junta os budgets de vários projetos num dashboard, com o formato do quadro de **Project Review**.

- Lê os ficheiros Excel **diretamente do SharePoint**, a partir dos links de partilha, e/ou das pastas do OneDrive sincronizadas no PC. Não há base de dados.
- **Não faz cálculos.** Mostra os valores tal como estão guardados no Excel, e a coluna **Δ** também vem da folha. Os valores estão em k€.
- **Atualiza sozinha.** Os ficheiros locais são verificados de 5 em 5 segundos e os do SharePoint de 60 em 60 segundos (configurável). Quando um ficheiro muda, é relido e o dashboard atualiza sem ser preciso recarregar a página.
- Exporta para **PDF** (o projeto atual ou todos, um por página) e para **Excel** (formatado como o quadro, um separador por projeto).
- O servidor só aceita ligações de `localhost`. As únicas ligações externas são ao Microsoft Graph, para ler os ficheiros do SharePoint com a tua conta, e ao Google Fonts, para a fonte Manrope do design Vizta (sem internet, usa a fonte do sistema).

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

## Ler diretamente do SharePoint

No `config.json`, cada entrada de `sources` pode ser um **link de partilha do SharePoint** ("Copy link"), de um ficheiro ou de uma pasta. Numa pasta são lidos todos os Excel, incluindo subpastas. A app usa a tua conta Microsoft e só vê o que tu já consegues abrir. A cada `poll_seconds` compara a versão de cada ficheiro e só descarrega os que mudaram.

### 1. Pedido ao IT (uma vez)

A Microsoft exige que a app esteja registada no Azure AD da empresa. Envia isto ao IT:

> Preciso de uma *App registration* no Entra ID (Azure AD) para uma ferramenta local que lê ficheiros Excel do SharePoint com a minha própria conta (permissões delegadas, só leitura):
> - **Supported account types:** Accounts in this organizational directory only
> - **Authentication → Add a platform → Mobile and desktop applications**, redirect URI `http://localhost`
> - **Authentication → Allow public client flows:** Yes
> - **API permissions:** Microsoft Graph → *Delegated* → `Files.Read.All`, e **Power BI Service** → *Delegated* → `Dataset.Read.All` (e *Grant admin consent*, se a política da empresa o exigir)
> - Não é preciso *client secret*.
>
> Preciso do **Application (client) ID** e do **Directory (tenant) ID**.

### 2. Configuração

```json
"sources": [
  "https://<empresa>.sharepoint.com/:x:/s/<Site>/<codigo-do-link>"
],
"sharepoint": {
  "client_id": "<Application (client) ID>",
  "tenant": "<Directory (tenant) ID>",
  "login_hint": "nome@empresa.pt",
  "auth_flow": "interactive",
  "poll_seconds": 60
}
```

- **Primeiro arranque:** abre o browser para fazeres login na Microsoft. O token fica guardado em `token_cache.json`, fora do Git, e nos arranques seguintes já não pede login. Voltas a fazer login só quando o token expira.
- **Se o login no browser for bloqueado**, usa `"auth_flow": "device_code"`. A consola mostra um código para introduzires em <https://microsoft.com/devicelogin>.
- **Parte `?email=...&e=...` do link:** podes deixá-la ou retirá-la, porque a app tenta das duas formas.
- **Cópias descarregadas:** ficam em `.cache/`, também fora do Git, e são reescritas quando o ficheiro muda.
- **Erros:** se um link falhar (sem acesso, link expirado, login necessário), aparece um aviso no dashboard e os últimos dados lidos continuam visíveis.

Se o IT não puder criar o registo, a alternativa é sincronizar a biblioteca do SharePoint com o OneDrive ("Sync" ou "Add shortcut to My files") e usar o caminho local.

## Páginas de cada projeto

No menu, cada projeto abre um dropdown com as suas páginas:

- **Project KPIs** — o quadro de Project Review, com as subrubricas e os KPIs da Orion.
- **Financing** — os termos do contrato de financiamento (`financing.json`). Só aparece nos projetos com contrato.
- **Sales** — o *Typology Report* do Power BI "vizta - sales dashboards": unidades e valores por tipologia e estado (PSPA, Reserved, Off-market, Available), com €/m².

### Vendas (Power BI)

Os dados de vendas vêm do CRM através do Power BI. A app usa a mesma conta Microsoft e a mesma *App registration* do SharePoint (secção `sharepoint` do `config.json`), com a permissão delegada **Power BI Service → `Dataset.Read.All`** (ver o pedido ao IT acima). Sem isso, a página Sales explica o que falta.

```json
"powerbi": {
  "app_id": "<id da App do Power BI, do link: /apps/<app_id>/reports/...>",
  "report_id": "<id do relatório, do link: /reports/<report_id>/...>",
  "typology_query": "<consulta DAX>",
  "poll_seconds": 900
}
```

- A app descobre o dataset a partir do relatório e corre a consulta DAX (`executeQueries`). A consulta tem de devolver, por linha: projeto, estado, tipologia, unidades, valor e área. Os nomes das colunas configuram-se em `"columns"`.
- A consulta depende dos nomes das tabelas do modelo. Quando houver acesso, `python powerbi.py --probe` lista as tabelas, colunas e medidas.
- No menu, `"sales_project"` indica o nome do projeto no Power BI (p.ex. `"Core Leça"`). `null` significa que o projeto não tem página Sales. Sem esta chave, usa-se o nome do quadro.
- Os totais e as % do Typology Report são somas e divisões dos valores do Power BI, como no relatório.
- O Power BI é lido a cada `poll_seconds`, por omissão 15 minutos.

## Subrubricas e menu

No quadro do Project Review, as rubricas (p.ex. "1- Land costs") abrem um dropdown com as subrubricas, lidas da folha de budget do projeto (p.ex. `BUDGET FASE 1`). "Expand all" / "Collapse all" abre ou fecha todas.

- A app deteta as folhas de budget pela linha "1- Land costs" e pelo cabeçalho "BUDGET € + VAT".
- **Correspondência de colunas:** cada coluna do quadro é associada à coluna da folha de budget cujos valores das rubricas são iguais. Assim, "Project Review 21/10/2026" pode corresponder à coluna TOTAL, mesmo com nomes diferentes. Em caso de empate, ganha a coluna com a mesma data no cabeçalho, depois uma coluna visível. As colunas escondidas no Excel também contam.
- **Δ das subrubricas:** se o Δ do quadro for a última coluna menos a penúltima, as subrubricas seguem a mesma regra. Se não, usa-se a coluna do budget que corresponde ao Δ (p.ex. VARIATION).
- As subrubricas aparecem numa lista simples, como no Excel. Algumas contêm outras (p.ex. 321 e 321.1), por isso nem sempre somam exatamente o valor da rubrica.
- No PDF saem as rubricas que estiverem abertas. No Excel exportado, as subrubricas ficam agrupadas por baixo de cada rubrica (botões +/− do Excel).

O menu lateral e a folha de budget de cada projeto configuram-se em `config.json`, na secção `"menu"` (ver `config.example.json`):

```json
"menu": [
  {"group": "Pleno", "items": [
    {"project": "PLENO I", "label": "Pleno - Lote 9", "budget_sheet": "BUDGET FASE 1"}
  ]},
  {"project": "NOLA", "label": "NOLA", "budget_sheet": "BUDGET TOTAL_PReview"}
]
```

- `project` é o nome do projeto tal como está no quadro de Project Review. `label` é o nome a mostrar.
- `budget_sheet` é opcional. Sem ele, a app só usa a folha de budget se o ficheiro tiver apenas uma.
- Uma entrada com `group` e `items` aparece como dropdown. Os projetos que não estão no menu aparecem no fim.
- Depois de alterar o menu, reinicia a app.

## Financiamento por projeto

A página **Financing** de cada projeto mostra os termos do contrato de financiamento: banco, data, maturidade, montante, prazos, indexante + spread, fundos próprios exigidos e distribuições permitidas ao promotor. O bloco aparece também no PDF e no Excel exportados.

- Os dados ficam em `financing.json`, na pasta da app. Este ficheiro está **fora do Git** porque os contratos são confidenciais. O formato está em `financing.example.json`.
- A chave de cada entrada é o **nome do projeto tal como aparece no dashboard** (p.ex. `"PLENO I"`). Se um nome não corresponder a nenhum projeto, aparece um aviso.
- A maturidade e o fim do período de utilização são calculados a partir de `signed` + `term_months` / `availability_months`.
- A app relê o ficheiro quando muda, sem ser preciso reiniciar.

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
  sharepoint.py       login Microsoft (MSAL) e leitura via Microsoft Graph
  budget_parser.py    leitura das folhas de Project Review
  excel_export.py     exportação para .xlsx
  financing.py        leitura do financing.json (contratos de financiamento)
  powerbi.py          vendas do Power BI (Typology Report)
  static/             dashboard (HTML/CSS/JS, sem dependências externas)
  test_budget_parser.py, test_sharepoint.py
  config.example.json
  run.bat
```

Testes: `python -m unittest` (usa um Excel sintético e um SharePoint simulado, sem dados reais).
