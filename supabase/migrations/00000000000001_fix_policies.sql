-- ============================================================
-- Correção: recursão infinita nas políticas de segurança (RLS)
-- Corre isto em: Supabase Dashboard > SQL Editor > New query > Run
-- (Não precisas de repetir o script anterior, este só corrige as políticas)
-- ============================================================

-- Funções auxiliares que verificam acesso sem disparar as políticas em ciclo
create or replace function public.is_project_owner(pid uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (select 1 from public.projects where id = pid and owner_id = auth.uid());
$$;

create or replace function public.is_project_member(pid uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid());
$$;

create or replace function public.can_access_project(pid uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select public.is_project_owner(pid) or public.is_project_member(pid);
$$;

-- Projetos: ver todos os que sou dono ou membro
drop policy if exists "Ver projetos onde sou membro ou dono" on public.projects;
create policy "Ver projetos onde sou membro ou dono"
  on public.projects for select using (public.can_access_project(id));

-- Membros: qualquer pessoa com acesso ao projeto vê a lista de membros
drop policy if exists "Ver membros dos meus projetos" on public.project_members;
create policy "Ver membros dos meus projetos"
  on public.project_members for select using (public.can_access_project(project_id));

-- Membros: qualquer pessoa com acesso ao projeto pode convidar mais gente (como no Asana)
drop policy if exists "Adicionar membros aos meus projetos" on public.project_members;
create policy "Adicionar membros aos meus projetos"
  on public.project_members for insert with check (public.can_access_project(project_id));

-- Membros: só o dono do projeto pode remover alguém
drop policy if exists "Remover membros (dono)" on public.project_members;
create policy "Remover membros (dono)"
  on public.project_members for delete using (public.is_project_owner(project_id));

-- Tarefas: ver, criar, editar e eliminar se tiveres acesso ao projeto
drop policy if exists "Ver tarefas dos meus projetos" on public.tasks;
create policy "Ver tarefas dos meus projetos"
  on public.tasks for select using (public.can_access_project(project_id));

drop policy if exists "Criar tarefas nos meus projetos" on public.tasks;
create policy "Criar tarefas nos meus projetos"
  on public.tasks for insert with check (public.can_access_project(project_id));

drop policy if exists "Editar tarefas dos meus projetos" on public.tasks;
create policy "Editar tarefas dos meus projetos"
  on public.tasks for update using (public.can_access_project(project_id));

drop policy if exists "Eliminar tarefas dos meus projetos" on public.tasks;
create policy "Eliminar tarefas dos meus projetos"
  on public.tasks for delete using (public.can_access_project(project_id));
