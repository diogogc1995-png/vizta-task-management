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
> - **API permissions:** Microsoft Graph → *Delegated* → `Files.Read.All` (e *Grant admin consent*, se a política da empresa o exigir)
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

## Financiamento por projeto

A página de cada projeto pode mostrar os termos do contrato de financiamento: banco, data, maturidade, montante, prazos, indexante + spread, fundos próprios exigidos e distribuições permitidas ao promotor. O bloco aparece também no PDF e no Excel exportados.

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
  static/             dashboard (HTML/CSS/JS, sem dependências externas)
  test_budget_parser.py, test_sharepoint.py
  config.example.json
  run.bat
```

Testes: `python -m unittest` (usa um Excel sintético e um SharePoint simulado, sem dados reais).
