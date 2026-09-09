-- ============================================================
-- Etiquetas passam a ser globais (partilhadas entre projetos)
-- Antes: public.tags tinha project_id (NOT NULL) e unique(project_id, name).
-- Agora: uma única lista de etiquetas para toda a app.
-- ============================================================

-- 1. Juntar etiquetas duplicadas por nome, repointando task_tags para o id a manter
do $$
declare
  r record;
begin
  for r in
    select name, (array_agg(id order by created_at, id))[1] as keep_id, array_agg(id) as ids
    from public.tags
    group by name
    having count(*) > 1
  loop
    update public.task_tags tt
      set tag_id = r.keep_id
      where tt.tag_id = any(r.ids)
        and tt.tag_id <> r.keep_id
        and not exists (
          select 1 from public.task_tags x
          where x.task_id = tt.task_id and x.tag_id = r.keep_id
        );
    delete from public.task_tags tt
      where tt.tag_id = any(r.ids) and tt.tag_id <> r.keep_id;
    delete from public.tags t
      where t.id = any(r.ids) and t.id <> r.keep_id;
  end loop;
end $$;

-- 2. Remover as políticas antigas (dependem de project_id)
drop policy if exists "ver tags" on public.tags;
drop policy if exists "criar tags" on public.tags;
drop policy if exists "apagar tags" on public.tags;

-- 3. Remover o scoping por projeto (leva com ele o FK e o unique(project_id, name))
alter table public.tags drop column if exists project_id cascade;

-- 4. Nome único (agora global)
alter table public.tags add constraint tags_name_key unique (name);

-- 5. RLS: vocabulário partilhado por todos os utilizadores autenticados
create policy "ver tags" on public.tags
  for select using (auth.role() = 'authenticated');
create policy "criar tags" on public.tags
  for insert with check (auth.role() = 'authenticated');
create policy "apagar tags" on public.tags
  for delete using (auth.role() = 'authenticated');
