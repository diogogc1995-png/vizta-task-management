drop policy if exists "Adicionar membros aos meus projetos" on public.project_members;
create policy "Adicionar membros aos meus projetos"
  on public.project_members for insert with check (user_id = auth.uid() or public.can_access_project(project_id));
