-- Pastas são uma organização pessoal (cada pessoa organiza a sua barra lateral à sua maneira)
create table public.sidebar_folders (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  position int default 0,
  created_at timestamptz default now()
);

create table public.project_folder_assignments (
  owner_id uuid references public.profiles(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  folder_id uuid references public.sidebar_folders(id) on delete cascade not null,
  primary key (owner_id, project_id)
);

alter table public.sidebar_folders enable row level security;
alter table public.project_folder_assignments enable row level security;

create policy "gerir as minhas pastas" on public.sidebar_folders for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "gerir as minhas atribuicoes de pasta" on public.project_folder_assignments for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.sidebar_folders to authenticated;
grant select, insert, update, delete on public.project_folder_assignments to authenticated;
