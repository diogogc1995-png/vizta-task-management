-- Etiquetas
create table public.tags (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  color text not null default '#F26641',
  created_at timestamptz default now(),
  unique(project_id, name)
);

create table public.task_tags (
  task_id uuid references public.tasks(id) on delete cascade not null,
  tag_id uuid references public.tags(id) on delete cascade not null,
  primary key (task_id, tag_id)
);

-- Subtarefas (checklist)
create table public.subtasks (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  title text not null,
  done boolean default false,
  position int default 0,
  created_at timestamptz default now()
);

-- Histórico de atividade
create table public.task_activity (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz default now()
);

alter table public.tags enable row level security;
alter table public.task_tags enable row level security;
alter table public.subtasks enable row level security;
alter table public.task_activity enable row level security;

create policy "ver tags" on public.tags for select using (public.can_access_project(project_id));
create policy "criar tags" on public.tags for insert with check (public.can_access_project(project_id));
create policy "apagar tags" on public.tags for delete using (public.can_access_project(project_id));

create policy "ver task_tags" on public.task_tags for select using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy "inserir task_tags" on public.task_tags for insert with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy "apagar task_tags" on public.task_tags for delete using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));

create policy "ver subtasks" on public.subtasks for select using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy "criar subtasks" on public.subtasks for insert with check (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy "editar subtasks" on public.subtasks for update using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));
create policy "apagar subtasks" on public.subtasks for delete using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));

create policy "ver activity" on public.task_activity for select using (exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id)));

grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, delete on public.task_tags to authenticated;
grant select, insert, update, delete on public.subtasks to authenticated;
grant select on public.task_activity to authenticated;
