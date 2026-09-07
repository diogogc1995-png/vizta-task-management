-- ============================================================
-- Esquema da base de dados "Rumo" para Supabase
-- Corre isto em: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- Perfis de utilizador (ligados à autenticação do Supabase)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null,
  created_at timestamptz default now()
);

-- Quando alguém se regista, cria-se automaticamente um perfil
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Projetos
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  color text not null default '#1F6F5C',
  owner_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now()
);

-- Membros de um projeto (quem pode ver/editar as suas tarefas)
create table if not exists public.project_members (
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  primary key (project_id, user_id)
);

-- Tarefas
create table if not exists public.tasks (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null,
  description text default '',
  column_id text not null default 'todo',
  priority text not null default 'media',
  assignee_id uuid references public.profiles(id) on delete set null,
  due date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Regista quando uma tarefa passa a ter um novo responsável (para disparar o email)
create table if not exists public.task_assignment_events (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  assignee_id uuid references public.profiles(id) on delete cascade not null,
  notified boolean default false,
  created_at timestamptz default now()
);

create or replace function public.log_assignment_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.assignee_id is not null)
     or (tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null) then
    insert into public.task_assignment_events (task_id, assignee_id)
    values (new.id, new.assignee_id);
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_task_assignment_change on public.tasks;
create trigger on_task_assignment_change
  before insert or update on public.tasks
  for each row execute procedure public.log_assignment_change();

-- ============================================================
-- Segurança: só quem pertence a um projeto vê/edita as suas tarefas
-- ============================================================
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignment_events enable row level security;

create policy "Perfis visíveis para todos os autenticados"
  on public.profiles for select using (auth.role() = 'authenticated');

create policy "Ver projetos onde sou membro ou dono"
  on public.projects for select using (
    owner_id = auth.uid() or
    exists (select 1 from public.project_members m where m.project_id = id and m.user_id = auth.uid())
  );

create policy "Criar projetos"
  on public.projects for insert with check (owner_id = auth.uid());

create policy "Atualizar projetos próprios"
  on public.projects for update using (owner_id = auth.uid());

create policy "Ver membros dos meus projetos"
  on public.project_members for select using (
    exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or user_id = auth.uid()))
  );

create policy "Adicionar membros aos meus projetos"
  on public.project_members for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

create policy "Ver tarefas dos meus projetos"
  on public.tasks for select using (
    exists (
      select 1 from public.projects p
      left join public.project_members m on m.project_id = p.id
      where p.id = project_id and (p.owner_id = auth.uid() or m.user_id = auth.uid())
    )
  );

create policy "Criar tarefas nos meus projetos"
  on public.tasks for insert with check (
    exists (
      select 1 from public.projects p
      left join public.project_members m on m.project_id = p.id
      where p.id = project_id and (p.owner_id = auth.uid() or m.user_id = auth.uid())
    )
  );

create policy "Editar tarefas dos meus projetos"
  on public.tasks for update using (
    exists (
      select 1 from public.projects p
      left join public.project_members m on m.project_id = p.id
      where p.id = project_id and (p.owner_id = auth.uid() or m.user_id = auth.uid())
    )
  );

create policy "Eliminar tarefas dos meus projetos"
  on public.tasks for delete using (
    exists (
      select 1 from public.projects p
      left join public.project_members m on m.project_id = p.id
      where p.id = project_id and (p.owner_id = auth.uid() or m.user_id = auth.uid())
    )
  );
