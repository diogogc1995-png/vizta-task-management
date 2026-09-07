create table public.attachments (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  comment_id uuid references public.task_comments(id) on delete cascade,
  uploader_id uuid references public.profiles(id) on delete set null,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz default now()
);

alter table public.attachments enable row level security;

create policy "ver attachments" on public.attachments for select using (
  exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "criar attachments" on public.attachments for insert with check (
  exists(select 1 from public.tasks t where t.id=task_id and public.can_access_project(t.project_id))
);
create policy "apagar os meus attachments" on public.attachments for delete using (uploader_id = auth.uid());

grant select, insert, delete on public.attachments to authenticated;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "ver anexos dos meus projetos" on storage.objects;
create policy "ver anexos dos meus projetos" on storage.objects for select using (
  bucket_id = 'attachments' and exists (
    select 1 from public.tasks t where t.id = (storage.foldername(name))[1]::uuid and public.can_access_project(t.project_id)
  )
);

drop policy if exists "enviar anexos" on storage.objects;
create policy "enviar anexos" on storage.objects for insert with check (
  bucket_id = 'attachments' and exists (
    select 1 from public.tasks t where t.id = (storage.foldername(name))[1]::uuid and public.can_access_project(t.project_id)
  )
);

drop policy if exists "apagar os meus anexos" on storage.objects;
create policy "apagar os meus anexos" on storage.objects for delete using (
  bucket_id = 'attachments' and owner = auth.uid()
);
