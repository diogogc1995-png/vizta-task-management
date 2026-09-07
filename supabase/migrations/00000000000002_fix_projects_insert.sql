-- ============================================================
-- Reforço: garantir que a criação de projetos funciona
-- Corre isto em: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.profiles enable row level security;

-- Recriar do zero as políticas de "projects" para garantir consistência
drop policy if exists "Ver projetos onde sou membro ou dono" on public.projects;
drop policy if exists "Criar projetos" on public.projects;
drop policy if exists "Atualizar projetos próprios" on public.projects;

create policy "Ver projetos onde sou membro ou dono"
  on public.projects for select using (public.can_access_project(id));

create policy "Criar projetos"
  on public.projects for insert with check (owner_id = auth.uid());

create policy "Atualizar projetos próprios"
  on public.projects for update using (owner_id = auth.uid());

-- Garantir que o papel "authenticated" tem permissão de base sobre as tabelas
-- (a RLS acima é que continua a decidir linha a linha, isto só destranca a tabela)
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert on public.task_assignment_events to authenticated;
grant select on public.profiles to authenticated;
