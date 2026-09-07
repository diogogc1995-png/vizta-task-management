create table if not exists public.task_comments (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz default now()
);

alter table public.task_comments enable row level security;

drop policy if exists "Ver comentários das minhas tarefas" on public.task_comments;
create policy "Ver comentários das minhas tarefas"
  on public.task_comments for select using (
    exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id))
  );

drop policy if exists "Comentar tarefas dos meus projetos" on public.task_comments;
create policy "Comentar tarefas dos meus projetos"
  on public.task_comments for insert with check (
    author_id = auth.uid() and
    exists (select 1 from public.tasks t where t.id = task_id and public.can_access_project(t.project_id))
  );

drop policy if exists "Apagar os meus próprios comentários" on public.task_comments;
create policy "Apagar os meus próprios comentários"
  on public.task_comments for delete using (author_id = auth.uid());

grant select, insert, delete on public.task_comments to authenticated;
