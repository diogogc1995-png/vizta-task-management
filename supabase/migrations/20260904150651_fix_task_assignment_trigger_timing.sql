drop trigger if exists on_task_assignment_change on public.tasks;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_task_updated_at on public.tasks;
create trigger on_task_updated_at
  before insert or update on public.tasks
  for each row execute procedure public.set_updated_at();

create or replace function public.log_assignment_change()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.assignee_id is not null)
     or (tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null) then
    insert into public.task_assignment_events (task_id, assignee_id)
    values (new.id, new.assignee_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_task_assignment_change
  after insert or update on public.tasks
  for each row execute procedure public.log_assignment_change();
