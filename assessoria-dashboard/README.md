# Assessoria DC & HC — Dashboard

Dashboard privado para acompanhar o novo negócio:

- **Funil de Vendas**: contactos, estado, próximos passos (kanban com arrastar, tabela editável, indicadores, gráfico e agenda).
- **Apresentação Institucional**: pré-visualização de um PDF ou Google Slides, com **link público só de visualização** para enviar a qualquer pessoa.
- **Financiamentos**: entidades contactadas, montantes, estado e próximos passos.
- **Business Plans**: leitura de ficheiros Excel (.xlsx) e lista de ficheiros da pasta.

Pode criar novas secções e widgets (indicador, funil/kanban, tabela, próximos passos, gráfico, ficheiro, lista de ficheiros, notas) a partir da própria app.

## Arquitetura (sem servidor, sem base de dados)

```
Browser (GitHub Pages)  ──login Google──►  Google Identity Services
        │
        ├── Google Sheets API  →  ler/escrever as folhas (Funil, Financiamentos…)
        └── Google Drive API   →  ler PDFs/Excel, guardar dashboard.json, partilhas
                                   (tudo dentro da pasta partilhada do Drive)
```

- **Alojamento**: GitHub Pages (gratuito, estático). Não há Netlify, Supabase nem backend.
- **Login**: conta Google de cada pessoa. A app só pede acesso ao Google Drive.
- **Dados**: ficam todos na pasta do Drive configurada em `js/config.js`. As folhas são a "fonte de verdade". Pode editá-las no Google Sheets ou no dashboard, e o dashboard relê-as a cada 30 segundos (e sempre que volta ao separador do browser).
- **Layout e permissões**: num ficheiro `dashboard.json` dentro da mesma pasta, criado automaticamente.
- **Excel (.xlsx)**: lido no browser (SheetJS). Edita-se no Drive; para editar no dashboard, converta para Google Sheets.
- **Link público**: `public.html` mostra só os ficheiros da secção, partilhados no Drive como "qualquer pessoa com o link → leitor" (sem download/cópia quando o Drive o permite). Desativar o link retira essa partilha.

### Permissões

| Papel | Pode |
|---|---|
| Dono (quem é dono da pasta no Drive) | Tudo, incluindo gerir pessoas e secções |
| Editar (por secção) | Editar dados (linhas das folhas), widgets e o link público dessa secção |
| Ver (por secção) | Só ver |

Ao adicionar uma pessoa em **Definições**, a app partilha a pasta do Drive com ela: como **editor** se puder editar alguma secção, senão como **leitor**.
Limitação a ter presente: a segurança real é a do Google Drive. Quem é editor da pasta consegue, no próprio Drive, abrir qualquer ficheiro dela. As permissões por secção controlam o que cada pessoa vê e faz **no dashboard**. Para duas pessoas de confiança isto chega. Para restringir ficheiros a sério, use subpastas com partilhas diferentes no Drive.

## Instalação (uma vez, ~15 minutos)

### 1. Repositório e GitHub Pages
1. Coloque estes ficheiros num repositório do GitHub (ex.: `assessoria-dashboard`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
3. Após 1–2 minutos, o site fica em `https://<utilizador>.github.io/assessoria-dashboard/`.

> O GitHub Pages gratuito exige repositório **público**. Não há nada sensível no código: o Client ID OAuth é público por natureza e os dados estão no Drive, protegidos pelo login Google. Se preferir um repositório privado, precisa do GitHub Pro, ou de alojar noutro serviço estático.

### 2. Projeto no Google Cloud (login + APIs)
1. Abra <https://console.cloud.google.com/> com **diogogc1995@gmail.com** e crie um projeto (ex.: "Assessoria Dashboard").
2. **APIs e serviços → Biblioteca**: ative **Google Drive API** e **Google Sheets API**.
3. **Google Auth Platform (Ecrã de consentimento OAuth)**:
   - Tipo de utilizador: **Externo**. Nome: "Assessoria DC & HC". Email de suporte: o seu.
   - **Acesso a dados / Âmbitos**: adicione `https://www.googleapis.com/auth/drive`.
   - **Público → Utilizadores de teste**: adicione **o seu Gmail e o do Henrique** (e de quem mais tiver acesso no futuro).
   - Deixe o estado de publicação em **Teste**. Assim não é preciso verificação pela Google. O único efeito é um aviso "A Google não validou esta app" no primeiro login: clique em *Continuar*.
4. **Clientes (Credenciais) → Criar cliente → Aplicação Web**:
   - **Origens JavaScript autorizadas**: `https://<utilizador>.github.io` (e `http://localhost:8000` se quiser testar localmente).
   - Não precisa de URIs de redirecionamento.
5. Copie o **Client ID** (`…apps.googleusercontent.com`) para `GOOGLE_CLIENT_ID` em `js/config.js`, faça commit e push.

### 3. Primeiro arranque
1. Abra o site, clique em **Entrar com Google** e autorize o acesso ao Drive.
2. Como é o dono da pasta, aparece **Criar dashboard**: são criadas as folhas *Funil de Vendas* e *Financiamentos* (com listas pendentes para "Estado" e formatos de data/€) e o `dashboard.json`.
3. **Menu da conta → Definições e permissões** → adicione o email do Henrique e escolha, por secção, *Ver* ou *Editar*.
4. **Apresentação**: carregue o PDF/Slides para a pasta do Drive → secção *Apresentação Institucional* → **Editar** → ⚙ no widget → escolher ficheiro → **Concluir** → **Link público** → **Criar link público** → copiar.

## Utilização no dia a dia
- **Editar dados**: clique num cartão ou numa linha para abrir o formulário, ou arraste cartões entre colunas do funil. As alterações são gravadas diretamente na Google Sheet.
- **Editar layout**: botão **Editar** → mover (setas ou arrastar pela pega), mudar largura/altura, ⚙ configurar, 🗑 remover, **Adicionar widget**.
- **Telemóvel**: o layout adapta-se. Para ter um ícone no ecrã inicial, use "Adicionar ao ecrã principal" no browser.
- **Sessão**: o acesso Google dura cerca de 1 hora. Quando expira, aparece uma barra com **Renovar sessão** (um clique).
- **Pode alterar as folhas à vontade** (colunas novas, ordem diferente). Os widgets referem colunas pelo **nome do cabeçalho**; se mudar um nome, reconfigure o widget com ⚙.

## Experimentar sem Google
Abra `…/?demo` (ou `http://localhost:8000/?demo`): mostra o dashboard com dados fictícios em memória, sem gravar nada.

Para testar localmente: `python3 -m http.server 8000` nesta pasta.

## Estrutura

```
index.html          Página principal (carrega js/main.js)
public.html         Página pública do link de partilha (sem login)
css/style.css       Estilos (claro/escuro, grelha, telemóvel)
js/config.js        ← Client ID, ID da pasta, intervalo de atualização
js/google.js        Login Google + Drive + Sheets (chamadas diretas às APIs)
js/mock.js          Mesma API em memória, para ?demo
js/data.js          Cache das folhas, atualização periódica, escrita de linhas
js/store.js         dashboard.json (secções, widgets, permissões) e papéis
js/setup.js         Folhas modelo e dashboard inicial
js/app.js           Estrutura da app (login, topo, secções, grelha)
js/widgets.js       Widgets
js/editors.js       Configuração de widgets, link público, definições
js/rowEditor.js     Formulário de linha
```

Bibliotecas por CDN, com versões fixas: Preact + htm 3.1.1, Chart.js 4.4.1, SheetJS 0.20.3 (só carregado quando abre um Excel).

## Cores
Paleta categórica com ordem fixa e validada para daltonismo (azul, laranja, verde-água, amarelo, magenta, verde, violeta, vermelho). Cada estado/categoria mantém sempre a mesma cor. A partir do 9.º estado, a cor é cinzenta.
