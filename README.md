# Vizta - Task Management

App interna de gestão de tarefas (estilo Asana/Monday), construída para a Vizta.

## Estado atual da stack

- **Frontend**: `index.html` — um único ficheiro autónomo. React + Tailwind carregados via CDN, sem passo de build (o JSX já vem pré-compilado para JS simples). Isto foi uma escolha deliberada para permitir "drag & drop" no Netlify Drop sem CLI nem Node. **Não é a arquitetura ideal a prazo** — ver secção "Próximos passos" abaixo.
- **Backend**: 100% Supabase — Postgres (com Row Level Security), Auth (email/password), Storage (anexos), pg_cron (tarefas agendadas) e pg_net (chamadas HTTP para o Resend, para enviar emails diretamente da base de dados).
- **Emails**: Resend, chamado a partir de funções Postgres (`app_send_email`), sem nenhum backend/servidor à parte.
- **Deploy do frontend**: Netlify, atualmente por *drag & drop* manual do `index.html` (sem CI/CD).

## Credenciais e configuração

- **Supabase**: URL do projeto e a *anon key* (pública, segura para estar no frontend) estão hardcoded no topo do `index.html`. Projeto: `tatwnuyjthomlnlzjjuy` (organização "Vizta Org").
- **Resend**: a API key está guardada de forma encriptada no Supabase Vault (`resend_api_key`), nunca exposta no frontend. Domínio `vizta.pt` ainda **não está verificado** — por agora só envia emails para o Gmail pessoal usado para criar a conta Resend.
- **Netlify**: site em `https://dfintaskmgt.netlify.app`.

Todas estas contas (Supabase, Netlify, Resend) foram criadas com o email pessoal do Diogo — não são ainda contas da organização Vizta. Isto está identificado como algo a resolver antes de um lançamento mais alargado.

## Base de dados

As migrações em `supabase/migrations/` representam o histórico completo e exato de tudo o que foi aplicado à base de dados de produção, por ordem cronológica. Para replicar este esquema num novo projeto Supabase:

```bash
supabase link --project-ref <novo-project-ref>
supabase db push
```

**Nota de segurança importante**: várias políticas de Row Level Security nesta base de dados usam funções auxiliares (`can_access_project`, `is_project_owner`, `is_project_member`) em vez de subconsultas diretas às mesmas tabelas. Isto não é estético — resolve dois bugs reais que já aconteceram em produção:
1. Recursão infinita quando duas tabelas se referenciam mutuamente nas suas políticas.
2. Falhas silenciosas em `INSERT ... RETURNING` quando uma política de SELECT tenta reler a própria linha que acabou de ser inserida, dentro da mesma transação.

Se fores alterar políticas de RLS, mantém este padrão (função `SECURITY DEFINER` em vez de subconsulta direta) e testa sempre com `INSERT ... RETURNING`, não só com `INSERT` simples — foi assim que ambos os bugs escaparam aos primeiros testes.

## Funcionalidades já implementadas

- Contas reais (Supabase Auth), projetos, equipas por projeto (convites por email)
- Kanban com 4 colunas fixas (Por fazer / Em curso / Em revisão / Concluído), vista de Lista e vista de Calendário
- Múltiplos responsáveis por tarefa, etiquetas, subtarefas (checklist), anexos (tarefas e comentários), comentários com @menções por email
- Notificações dentro da app (sino) + notificações por email (atribuição de tarefa, resumo diário de prazos)
- Tarefas recorrentes (diária/semanal/mensal), geradas automaticamente por `pg_cron`
- Histórico de atividade por tarefa
- Pastas pessoais na barra lateral (por utilizador, não partilhadas) + menu de contexto (botão direito) para editar/eliminar projetos e organizá-los em pastas
- "O Meu Dashboard": vista agregada de todas as tarefas do utilizador, entre todos os projetos

## Limitações conhecidas / dívida técnica

- **Sem verificação de compliance**: contas de infraestrutura pessoais, sem DPA assinado com os fornecedores, sem revisão jurídica. Não recomendado para lançamento à empresa toda sem tratar isto primeiro.
- **Tailwind via CDN** (`cdn.tailwindcss.com`) — a própria Tailwind desaconselha isto em produção (mais lento, sem purge de CSS).
- **Sem testes automatizados.**
- **Emails limitados** ao Gmail pessoal do Diogo até o domínio `vizta.pt` ser verificado no Resend.
- **`assignee_id` e `assignee:profiles!tasks_assignee_id_fkey`**: a coluna `assignee_id` em `tasks` ficou por usar depois de migrarmos para múltiplos responsáveis (tabela `task_assignees`). Não faz mal deixá-la (é só uma coluna morta), mas pode ser removida com segurança se quiseres limpar o esquema.

## Próximos passos sugeridos (se continuares no Claude Code)

1. **Migrar para um projeto com build real** (Vite + React), separando componentes em ficheiros próprios, com Tailwind instalado como dependência (não via CDN). O `index.html` atual pode servir de referência direta para essa migração — a lógica não muda, só a forma como é empacotada.
2. **Ligar o repositório ao Netlify via Git** (em vez de *drag & drop* manual), para teres deploys automáticos a cada `git push`.
3. **Usar o Supabase CLI localmente** (`supabase migration new <nome>`) para novas alterações de esquema, em vez de aplicar diretamente em produção.
4. Verificar o domínio `vizta.pt` no Resend (registos DNS já gerados, só faltam ser aplicados).
5. Migrar as contas de infraestrutura (Supabase, Netlify, Resend) para a organização Vizta.
