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

No menu, clicar num projeto abre o **resumo do projeto** e um dropdown com as restantes páginas:

- **Resumo** — imagem, estado, localização, apartamentos, retalho, estacionamentos, GPA, GCA acima/abaixo do solo e pisos (de `project_info.json`), mais custos, receita, preço médio residencial (receita ÷ GPA), IRR e margem. Custos e receita são o TOTAL COST e o TOTAL REVENUE da última coluna do quadro. IRR e margem são o IRR e o Profit do KPI "Levered post tax" da última coluna.
- **Project KPIs** — o quadro de Project Review, com as subrubricas e os KPIs da Orion.
- **Financing** — os termos do contrato de financiamento (`financing.json`). Só aparece nos projetos com contrato.
- **Sales** — o *Typology Report* do Power BI "vizta - sales dashboards": unidades e valores por tipologia e estado (PSPA, Reserved, Off-market, Available), com €/m².

### Resumo do projeto (`project_info.json`)

- Dados físicos e de estado por projeto, num ficheiro local fora do Git. O formato está em `project_info.example.json`. A chave é o nome do projeto no quadro.
- `image` é um ficheiro na pasta `project_images/` (também fora do Git), p.ex. uma imagem do projeto descarregada do site.
- Campos vazios (`null`) aparecem como "—". A app relê o ficheiro quando muda.

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
- **Enquanto não houver acesso automático**, a página Sales usa o `sales_snapshot.json`, um ficheiro local fora do Git. Tem o Typology Report transcrito do Power BI tal como lá aparece (unidades, totais, %, €/m²) e a data/hora em `_as_of`, que a página mostra como "Position as of …". Quando o Power BI estiver ligado, os dados automáticos têm prioridade.

### Legal Information

Dados societários da sociedade de cada projeto, lidos da **certidão permanente** mais recente na pasta
"Sociedades" do Legal (`config.json` → `"legal"`).

- `folder`: pasta "Sociedades" sincronizada (ou o link do SharePoint, no servidor).
- `web_folder`: o endereço dessa pasta no SharePoint, usado para os links dos documentos.
- `companies`: projeto (nome no quadro de Project Review) → nome da subpasta da sociedade.

Em cada sociedade, a app procura os PDFs com "CRC" ou "Certidão Permanente" no nome, fora das pastas
"old"/"Activos"/"Partilha". Usa a certidão mais recente que tenha os órgãos sociais e ignora as
certidões de outras entidades guardadas na pasta.

A página mostra:
- firma, NIPC, natureza jurídica, sede, capital, CAE, objeto, forma de obrigar, mandato e órgãos sociais;
- o código de acesso e a validade da certidão mais recente, com aviso nos últimos 60 dias;
- os factos pendentes de registo;
- links para a certidão, os estatutos, o RCBE e a pasta da sociedade.

As certidões são lidas em segundo plano (a primeira leitura demora uns segundos) e relidas a cada
`poll_seconds` (600 s); só os PDFs novos ou alterados voltam a ser lidos.

### Ponto de Situação

Os pontos **Pendente** e **Standby** das atas de ponto de situação dos projetos (folha `ATA`),
configuradas em `config.json` → `"ponto_situacao"`:

- `files`: um ou mais ficheiros Excel (caminhos sincronizados ou links do SharePoint, no servidor);
- `projects`: nome do projeto na ata → nome no quadro de Project Review.

As colunas são encontradas pelo cabeçalho (PROJETO, Área/GRUPO, TITULO/ASSUNTO, DESCRIÇÃO, ACÇÃO,
RESP, DEP, datas e ESTADO), por isso ficheiros com estruturas diferentes funcionam. Um ponto repetido
em mais de um ficheiro (mesmo projeto, título e descrição) conta uma só vez.

A página mostra:
- os pontos numa lista contínua ordenada pela data objetivo, com um filtro por coluna:
  - estado, área, responsável e departamento: listas com os valores existentes;
  - título, descrição, ação e datas: pesquisa de texto, sem distinguir acentos;
- os contadores de pontos abertos, pendentes, em standby e atrasados;
- a data a vermelho quando a data objetivo atual (ou a inicial, se não houver atual) já passou.

A app relê as atas quando os ficheiros mudam.

## Vizta Debt Summary

Apresentação em slides (como o Project Review - Orion, com export para PDF) dos financiamentos bancários,
a partir do `Vizta Debt Summary.xlsx` do DFIN, configurado em `config.json` → `"debt_summary"`:

- `file`: o ficheiro Excel (caminho sincronizado ou link do SharePoint, no servidor);
- `projects`: "Project" da folha Financing → `project` (nome no quadro de Project Review, para a
  localização e o GDV) e `label` (nome nos slides).

Cada folha `Financing <projeto>` é um empréstimo: cabeçalho (empresa, banco, montante aprovado e
utilizável, custos, LTC/LTHC, estado) e a tabela de autos de obra e utilizações. A folha
`Interests <projeto>` dá os juros cobrados pelo banco por trimestre. Os rótulos e colunas são
encontrados pelo texto. Um estado "Repaid…" conta como reembolsado (em dívida e disponível a zero).

Fica no menu "Reports Diogo", como *Vizta Debt Summary - Presentation*. Slides: capa, resumo do portefólio,
tabela das facilities, e por empréstimo uma ficha (dados, % utilizado, gráfico das faturas de obra vs
utilizações acumuladas por mês) e o detalhe das utilizações e juros; no fim, o pipeline de negociação.

Da aba Financing de cada projeto (`financing.json`) vêm o prazo (meses e datas a partir da assinatura), a
taxa de juro (indexante + spread), o equity recap (distribuições permitidas) e os projetos sem empréstimo
no Excel: com `stage` "Contract …" entram como *Contract closing* (resumo e tabela); os restantes em
negociação vão para o pipeline, com custo total e GDV do Project Review.

Os textos dos slides estão em inglês: o equity recap e o security package vêm do bloco `"en"` de cada
contrato no `financing.json` (`distributions`, `security`); sem `security`, a caixa fica como texto
editável. `expected_signing` mostra a data prevista de assinatura no pipeline (contratos em fecho também
aparecem lá, como cartões *Contract closing*). "CGD" aparece como "Caixa Geral de Depósitos".

Key takeaways (e o Security package sem dados) são texto editável nos slides, guardado no servidor como os Key
Variations do Orion (`orion_notes.json`, chaves `debt.*`; vence o último a guardar, com o aviso
"X está a escrever…").

## Vizta Portfolio

No topo do menu, o item "Vizta Portfolio" tem as páginas *Summary of all projects*, *Roadmap* e *Projects financing overview*.

### Summary of all projects

Quadro com todos os projetos agrupados por fase. A fase vem do `status` no `project_info.json`: Delivered, In Construction, Pre-Sales, Pipeline e, para o resto, Other.

- **Dados físicos:** apartamentos, GCA acima do solo, GPA residencial e GPA de retalho, do `project_info.json`. Quando há um bloco `total` (NOLA), usa-se o TOTAL.
- **Valores financeiros:** Project Total Cost e Revenue são o TOTAL COST e o TOTAL REVENUE da coluna mais recente do Project Review. Margin e IRR são o Profit e o IRR do KPI "Levered post tax" da mesma coluna. `summary_kpis` (p.ex. `["cost", "revenue"]`) limita os KPIs mostrados.
- **Nome, ordem e entrega:** `summary_name` e `summary_order` definem o nome e a ordem. A data de entrega dos projetos entregues vem do roadmap (End of deliveries) ou do campo `delivered` ("AAAA-MM").
- **Projetos sem budget no dashboard** (p.ex. Turquesa) entram com `"summary_only": true` no `project_info.json`, só com os dados físicos.
- O subtítulo e os totais são somas das linhas (GDV = soma das receitas).

### Roadmap

Gráfico de Gantt com os projetos agrupados por zona, feito a partir do ficheiro "RM mensuelle Portugal Always Updated" (folha `RM Portugal AllUpdate`), lido da pasta sincronizada do SharePoint. A app relê o ficheiro quando muda.

| Barra / marca | Datas da folha |
|---|---|
| Cinzento: desenvolvimento e licenciamento | Acquisition Date (ou Projeto Base) → Commercial Launch |
| Pêssego claro: pré-vendas | Commercial Launch → início de Construction |
| Pêssego: construção | Construction start → end |
| Laranja: entregas | Construction end → End of deliveries |
| ◆ preto / ◆ verde | PSPA / Commercial Launch |
| Etiqueta (p.ex. "Q3 2028") | End of deliveries |

- As colunas são encontradas pelos cabeçalhos.
- As linhas a mostrar, a ordem, a zona e o nome configuram-se em `config.json` → `"roadmap"` → `"rows"` (ver `config.example.json`). Cada linha é encontrada pela zona (coluna B, `area_match`) e pelo nome (coluna C, `name_match`; o nome exato tem prioridade).
- `"project"` liga a linha ao projeto do dashboard: clicar no nome abre o resumo.
- Datas anteriores a `from_year` ficam encostadas ao início do gráfico. Passar o rato por uma barra mostra as datas.
- No slide do Project Review - Orion (não na página do Portfolio), à direita do gráfico:
  - **Residential Units**, da mesma folha: Nb. Apartments, % PSPA, % Final deeds, % Total sold, % Units reserved e Units in the market. Projetos sem vendas ficam tracejados. `"plus_match"` (p.ex. `"Donation"`) junta entre parênteses as unidades de outra linha da mesma zona.
  - **Orion's view**, levered post-tax da coluna mais recente do Project Review: IRR, EM e margem (€ e % sobre a receita total).

### Escolher as versões do budget (Project KPIs)

Por cima do quadro há duas listas:
- **Compare:** a coluna de comparação, por omissão a do quadro (p.ex. "Project Review 16/07/2026").
- **Reference:** a coluna de referência, por omissão a mais recente.

A 1.ª coluna (Investment Committee / Acquisition) fica fixa. O **Δ é sempre Reference − Compare**; nas margens em % é a diferença em pontos percentuais.

- As versões disponíveis são todas as colunas BUDGET da folha de budget do projeto, incluindo as escondidas no Excel (indicadas como "hidden in Excel", com a letra da coluna), mais o "Last budget validated" e o "Current (signed + forecasted)", que é o TOTAL.
- Os valores das versões escolhidas vêm da folha de budget. Cada linha do quadro só é ligada à folha se os valores coincidirem nas versões do quadro; tolera-se uma coluna diferente, p.ex. um erro numa célula. Linhas sem correspondência (p.ex. "12-Other Adjustments", quando a folha não a tem) aparecem vazias.
- Os KPIs da Orion também mudam com a versão escolhida, quando a folha tem o bloco de KPIs para essa versão. Caso contrário mostram "—". As notas (Margin w/out internal fees, …) só aparecem na versão do quadro.
- O browser lembra a escolha de cada projeto. "Reset to Project Review" volta ao padrão. O PDF e o Excel exportados saem com as versões escolhidas.

## Reports Diogo

Entrada própria no menu lateral, com dois relatórios.

**Sales Report**: um quadro com todos os projetos, pela ordem do menu, e o total. Valores em k€.

| Coluna | Origem |
|---|---|
| Business plan | TOTAL REVENUE, coluna mais recente do Project Review |
| Power BI | Typology Report: "TOTAL Project Amount" + "Extras" (quando o relatório tem extras, p.ex. CORE), coluna € Resi+Retail (leitura automática ou snapshot); 0 € aparece como "–" |
| Δ BP vs Power BI | Power BI − Business plan (verde quando é positivo) |
| Commissions: Budget | Rubrica 511 (External sales fees) da folha de budget, coluna do último Project Review |
| Commissions: Awarded | Rubrica 511, coluna "Signed commitments" |
| Commissions: Available | Budget − Awarded (com IVA incluído) |
| Commissions % of sales | Budget / Business plan |

Quando várias fases partilham um projeto no Power BI (p.ex. as fases do JCR), o valor do Power BI só
entra no total, para não ser contado várias vezes.

**Cashflow Vizta REM**: página criada, com o conteúdo ainda por definir.

## Project Review - Orion (apresentação)

Entrada própria no menu lateral. Mostra os slides como uma apresentação em carrossel:
todos com o mesmo tamanho (tela 16:9 de 1600×900, escalada para o ecrã; o conteúdo que
não cabe é reduzido, nunca cortado).

- **Ordem dos slides**: a do PPT do Project Review — capa (trimestre fechado mais recente),
  agenda, Road Map, Summary (quadro + pesos por fase e regiões), Projects financing overview,
  Sales Launch, Market Information e, por projeto, os slides definidos em `config.json` → `orion`:
  `overview`, `commercial`, `timeline`, `variations` (quadro do Project Review com os €/sqm da
  mesma folha e o financiamento do `financing.json`), `cost_per_item`, `contract`, `fees`.
- O que o dashboard não tem (comentários, buyer profile, mercado, etc.) aparece
  como caixa **To be provided**.
- Projetos sem budget (p.ex. Turquesa) usam o `project_info.json`, incluindo `kpis_manual`
  (custos, receita, IRR, margem e preço médio, com a fonte).
- **Key Variations** (slides de Project Review): caixa de texto editável. Grava sozinha ao escrever
  e ao sair da caixa, no ficheiro `orion_notes.json` (fora do Git, por isso nunca é apagado por um
  push; no servidor muda-se o caminho com `"data"` → `"orion_notes"`).
  - Com várias pessoas a editar, fica sempre o último texto guardado; as outras páginas abertas
    atualizam-se em poucos segundos.
  - Enquanto alguém escreve numa caixa, a página dessa pessoa não é recarregada.
  - **"X está a escrever…"**: enquanto alguém tem a caixa aberta, os outros veem o aviso com o nome
    dessa pessoa, atualizado a cada 2 s.
    - O browser de quem escreve dá sinal ao servidor a cada 4 s. O aviso desaparece quando a pessoa
      sai da caixa ou fecha a página, ou ao fim de 12 s sem sinal (portátil fechado, rede em baixo).
    - Os sinais ficam só em memória, sem nada gravado.
    - O nome é pedido uma vez e fica guardado no browser.
- Navegação: setas ‹ ›, pontos por baixo do slide, lista de slides no menu lateral, agenda
  clicável, teclado (← → / PageUp PageDown / espaço, Home / End) e deslizar no ecrã tátil.
- **Present** (ou tecla F): ecrã inteiro, só o slide; Esc para sair.
- **Export PDF** com a apresentação aberta: todos os slides, um por página 16:9.

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
- **Financiamentos em negociação:**
  - `"status": "Under negotiation"`, com `"stage"` (fase atual) e `"source"` (documento de onde vêm os termos). Os contratos assinados não têm `status` e aparecem como "Signed".
  - Campos opcionais: `amount_note`, `term_note`, `tranches`, `ltv`, `fees` e `conditions`.
  - Para comparar propostas de vários bancos, usa `"offers"`: uma lista com `bank`, `structure`, `amount`, `amount_detail`, `tenor`, `pricing`, `fees`, `security`, `conditions`, `equity_recap` e `status`. Aparece como uma tabela, com uma coluna por banco.

## Servidor interno (acesso para a organização)

O dashboard pode correr num servidor Windows da empresa, com IIS e login Windows, para toda a organização
o usar sem depender do teu PC. Nesse modo:

- `python app.py --server` usa o waitress e nunca abre o browser nem pede login. Atrás do IIS, a porta
  vem de `HTTP_PLATFORM_PORT`.
- Os Excel, o ficheiro RM e os ficheiros de dados (`"data"`: `financing`, `project_info`,
  `sales_snapshot`, `images`) podem ser links do SharePoint, descarregados quando mudam.
- O Graph e o Power BI usam a identidade da aplicação: certificado em `sharepoint.certificate` ou a
  variável `BUDGET_DASHBOARD_CLIENT_SECRET`. No Power BI indica-se `powerbi.workspace_id`.

Passos, pedido ao IT e configuração do IIS: [deploy/DEPLOY.md](deploy/DEPLOY.md).

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

### Arrancar sozinho com o Windows

O atalho "Dashboard Budgets" na pasta de Arranque do Windows (`Win+R` → `shell:startup`) corre
`start_dashboard.ps1` quando entras no PC.

- O script arranca o dashboard em segundo plano, sem janela, se ainda não estiver a correr. Não abre o browser.
- Os registos ficam em `%TEMP%\budget_app.log`.
- Para parar o dashboard: Gestor de Tarefas → `python.exe`.
- Para deixar de arrancar com o Windows: apaga o atalho da pasta de Arranque.

O atalho aponta para:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<pasta>\start_dashboard.ps1"
```

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
