drop policy if exists "Ver projetos onde sou membro ou dono" on public.projects;
create policy "Ver projetos onde sou membro ou dono"
  on public.projects for select using (owner_id = auth.uid() or public.is_project_member(id));
