# Instalar o dashboard num servidor interno (IIS + login Windows)

O dashboard corre numa máquina Windows da empresa e fica acessível na rede (ou por VPN) em, por exemplo,
`https://budgets.vizta.local`. O IIS pede o login Windows (sem acesso anónimo), por isso entra qualquer
pessoa da organização com conta no domínio. Os Excel, o ficheiro RM e os ficheiros de dados são lidos
diretamente do SharePoint pelo Microsoft Graph, com a identidade da própria aplicação. O servidor não
precisa de OneDrive, e um Excel aberto por alguém não bloqueia a leitura.

```
browser ──(login Windows)──► IIS ──► python app.py --server (waitress)
                                            │
                                            ├─► Microsoft Graph ──► SharePoint (Excel, RM, JSON, imagens)
                                            └─► Power BI REST API (vendas)
```

## 1. Pedido ao IT

> **Assunto:** Alojamento do dashboard de budgets (Python/Flask) num servidor interno
>
> Precisamos de:
>
> 1. **Servidor Windows** (Windows Server 2019+ ou uma VM) na rede da empresa, com:
>    - IIS com **Windows Authentication** e o módulo
>      [HttpPlatformHandler](https://www.iis.net/downloads/microsoft/httpplatformhandler);
>    - Python 3.12+ (64 bits);
>    - acesso de saída HTTPS a `login.microsoftonline.com`, `graph.microsoft.com` e `api.powerbi.com`;
>    - um nome DNS interno (ex. `budgets.vizta.local`) e um certificado HTTPS para esse nome.
> 2. **App registration no Entra ID** (ex. "Vizta Budget Dashboard"), com autenticação por certificado
>    (preferível) ou client secret, e com estas **permissões de aplicação** (Application, não Delegated)
>    e admin consent:
>    - Microsoft Graph → `Sites.Selected`, com acesso de leitura concedido só aos sites SharePoint dos
>      projetos e da documentação (P3 Leça, P4 Laranjeiras, P8 Areeiro, V5 Pícua, V11 Olivais,
>      NEXAE Vilamoura, Nexity Documentation e o site onde ficar a pasta "Dashboard - dados").
>      Se a leitura por links de partilha não funcionar com `Sites.Selected`, a alternativa é
>      `Files.Read.All` (Application).
>    - Power BI → nas definições do tenant, permitir que **service principals usem as APIs do Power BI**
>      (de preferência só para um grupo de segurança que inclua esta app) e adicionar a app como
>      **Viewer** (ou Member) do workspace "vizta - sales dashboards".
> 3. Enviar-nos o **Application (client) ID**, o **Directory (tenant) ID**, o **ID do workspace** do
>    Power BI e o certificado (ou o secret) **por um canal seguro**.
>
> Se a organização não tiver domínio Active Directory (contas só no Entra ID), o login Windows no IIS não
> funciona. Nesse caso a alternativa é o Azure App Service com autenticação Entra ID.

## 2. Ficheiros de dados no SharePoint

Os ficheiros que hoje só existem no PC passam para uma pasta do SharePoint (ex. "Dashboard - dados"),
onde se editam como qualquer outro ficheiro:

| Ficheiro | Para quê |
|---|---|
| `financing.json` | Contratos e negociações de financiamento |
| `project_info.json` | Dados físicos, estado e imagem de cada projeto |
| `sales_snapshot.json` | Vendas transcritas do Power BI (enquanto a leitura automática não estiver ativa) |
| pasta `imagens` | As imagens de `project_images/` |

Para cada ficheiro (e para a pasta das imagens), copiar o link de partilha (**Copy link** → "Pessoas da
Vizta") para o `config.json` do servidor, em `"data"`. Para os Excel de budget e o ficheiro RM, usar
também os links de partilha (`"sources"` e `"roadmap" → "file"`).

## 3. Instalação no servidor

1. Copiar a pasta `budget-dashboard` para o servidor (ex. `C:\Apps\budget-dashboard`).
2. Criar o ambiente Python e instalar as dependências:
   ```bash
   cd C:\Apps\budget-dashboard
   py -3 -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   ```
3. Criar o `config.json` a partir de `deploy/config.server.example.json`. Copiar do `config.json` do PC
   o `menu`, `roadmap → rows` e `orion`, e substituir os caminhos locais por links do SharePoint.
4. Credenciais da aplicação. **Nunca pôr o secret no config.json nem no Git.**
   - **Certificado** (preferível): guardar a chave privada (`.key`/PEM) numa pasta só legível pela
     identidade do IIS e indicar o `thumbprint` e o caminho em `sharepoint → certificate`.
   - **Client secret**: criar a variável de ambiente de sistema `BUDGET_DASHBOARD_CLIENT_SECRET` e
     reiniciar o IIS (`iisreset`).
5. Testar à mão:
   ```bash
   .venv\Scripts\python.exe app.py --server
   ```
   No arranque aparecem os projetos lidos e eventuais erros de acesso ao SharePoint ou ao Power BI.
   Abrir `http://localhost:8765` no próprio servidor e fechar com Ctrl+C.

## 4. IIS

1. Copiar `deploy/web.config` para a raiz da pasta da app e corrigir o `processPath` se a pasta não
   for `C:\Apps\budget-dashboard`.
2. Criar um site no IIS que aponta para a pasta da app, com o binding HTTPS do nome DNS e o certificado.
3. Desbloquear a configuração de autenticação no web.config (uma vez, como administrador):
   ```bash
   %windir%\system32\inetsrv\appcmd unlock config -section:system.webServer/security/authentication/windowsAuthentication
   ```
   ```bash
   %windir%\system32\inetsrv\appcmd unlock config -section:system.webServer/security/authentication/anonymousAuthentication
   ```
4. Dar à identidade do application pool (ex. `IIS AppPool\BudgetDashboard`) permissão de **escrita**
   nas pastas `.cache` e `logs` da app (cópias descarregadas do SharePoint e registos).
5. No application pool: **Start Mode = AlwaysRunning** e **Idle Time-out = 0**, para os dados
   continuarem a ser atualizados mesmo sem ninguém a usar o dashboard.

Os registos ficam em `logs\app.log`.

## 5. Notas

- **Atualizações**: o servidor verifica o SharePoint a cada `sharepoint.poll_seconds` (60 s por omissão)
  e o Power BI a cada `powerbi.poll_seconds` (15 min).
- **Atualizar a app**: copiar os ficheiros novos (ou `git pull`) e reciclar o application pool.
- **Acesso**: com o login Windows entra qualquer pessoa do domínio. Para limitar a um grupo, ativar
  "URL Authorization" no IIS e permitir só esse grupo.
- **No PC** continua a funcionar como antes (`python app.py`, login com a tua conta e caminhos do OneDrive).
