-- Notificações dentro da app
create table public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null,
  title text not null,
  body text,
  task_id uuid references public.tasks(id) on delete cascade,
  read boolean default false,
  created_at timestamptz default now()
);

-- Menções em comentários
create table public.comment_mentions (
  id uuid default gen_random_uuid() primary key,
  comment_id uuid references public.task_comments(id) on delete cascade not null,
  mentioned_user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;
alter table public.comment_mentions enable row level security;

create policy "ver as minhas notificacoes" on public.notifications for select using (user_id = auth.uid());
create policy "marcar as minhas notificacoes" on public.notifications for update using (user_id = auth.uid());

create policy "ver mentions dos meus projetos" on public.comment_mentions for select using (
  exists (select 1 from public.task_comments c join public.tasks t on t.id=c.task_id where c.id=comment_id and public.can_access_project(t.project_id))
);

grant select, update on public.notifications to authenticated;
grant select on public.comment_mentions to authenticated;

-- Campos de recorrência nas tarefas
alter table public.tasks add column if not exists recurrence text;
alter table public.tasks add column if not exists recurrence_weekday int;
alter table public.tasks add column if not exists recurrence_day_of_month int;
alter table public.tasks add column if not exists is_recurring_template boolean default false;
alter table public.tasks add column if not exists last_generated_date date;
alter table public.tasks add column if not exists origin_template_id uuid references public.tasks(id) on delete set null;
