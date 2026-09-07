-- Data de conclusão automática
alter table public.tasks add column if not exists completed_at timestamptz;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  if new.column_id = 'done' and (old is null or old.column_id is distinct from 'done') then
    new.completed_at = now();
  elsif new.column_id <> 'done' then
    new.completed_at = null;
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

-- Múltiplos responsáveis por tarefa
create table if not exists public.task_assignees (
  task_id uuid references public.tasks(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (task_id, user_id)
);

alter table public.task_assignees enable row level security;

create policy "ver task_assignees" on public.task_assignees for select using (
  exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "inserir task_assignees" on public.task_assignees for insert with check (
  exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "apagar task_assignees" on public.task_assignees for delete using (
  exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))
);

grant select, insert, delete on public.task_assignees to authenticated;

-- Migrar responsável único existente para a nova tabela
insert into public.task_assignees (task_id, user_id)
select id, assignee_id from public.tasks where assignee_id is not null
on conflict do nothing;

-- Ao adicionar um responsável: garantir acesso ao projeto + notificar (reaproveita o mecanismo já existente)
create or replace function public.on_task_assignee_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id)
  select t.project_id, new.user_id from public.tasks t where t.id = new.task_id
  on conflict (project_id, user_id) do nothing;

  insert into public.task_assignment_events (task_id, assignee_id) values (new.task_id, new.user_id);
  return new;
end;
$$;

drop trigger if exists on_task_assignee_insert on public.task_assignees;
create trigger on_task_assignee_insert
  after insert on public.task_assignees
  for each row execute procedure public.on_task_assignee_added();

-- Histórico: registar quando alguém é removido como responsável
create or replace function public.on_task_assignee_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select name into v_name from public.profiles where id = old.user_id;
  insert into public.task_activity (task_id, actor_id, action, detail)
  values (old.task_id, auth.uid(), 'responsavel_removido', coalesce(v_name, 'alguém'));
  return old;
end;
$$;

drop trigger if exists on_task_assignee_delete on public.task_assignees;
create trigger on_task_assignee_delete
  after delete on public.task_assignees
  for each row execute procedure public.on_task_assignee_removed();
