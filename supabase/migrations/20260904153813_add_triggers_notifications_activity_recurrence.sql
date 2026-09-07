-- Atualizar notificação de atribuição para também criar notificação dentro da app
create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_title text;
  v_due date;
  v_project text;
  v_name text;
  v_email text;
begin
  select t.title, t.due, p.name into v_title, v_due, v_project
  from public.tasks t join public.projects p on p.id = t.project_id
  where t.id = new.task_id;

  select name, email into v_name, v_email from public.profiles where id = new.assignee_id;

  insert into public.notifications (user_id, type, title, body, task_id)
  values (new.assignee_id, 'assignment', 'Nova tarefa atribuída', v_title || ' — ' || v_project, new.task_id);

  if v_email is not null then
    perform public.app_send_email(
      v_email,
      'Nova tarefa atribuída: ' || v_title,
      '<p>Olá ' || coalesce(v_name,'') || ',</p>' ||
      '<p>Foi-te atribuída a tarefa <strong>' || v_title || '</strong> no projeto <strong>' || v_project || '</strong>.</p>' ||
      case when v_due is not null then '<p>Prazo: ' || to_char(v_due, 'DD/MM/YYYY') || '</p>' else '' end ||
      '<p><a href="https://dfintaskmgt.netlify.app">Abrir a app</a></p>'
    );
  end if;

  update public.task_assignment_events set notified = true where id = new.id;
  return new;
end;
$$;

-- Menções por email nos comentários (@email@dominio.com)
create or replace function public.process_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
  matched_id uuid;
  matched_name text;
  v_task_title text;
  v_commenter_name text;
begin
  select title into v_task_title from public.tasks where id = new.task_id;
  select name into v_commenter_name from public.profiles where id = new.author_id;

  for token in select (regexp_matches(new.body, '@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g'))[1]
  loop
    select id, name into matched_id, matched_name from public.profiles where email = token;
    if matched_id is not null and matched_id <> new.author_id then
      insert into public.comment_mentions (comment_id, mentioned_user_id) values (new.id, matched_id);
      insert into public.notifications (user_id, type, title, body, task_id)
      values (matched_id, 'mention', coalesce(v_commenter_name,'Alguém') || ' mencionou-te', 'Na tarefa "' || v_task_title || '": ' || new.body, new.task_id);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists on_comment_mentions on public.task_comments;
create trigger on_comment_mentions
  after insert on public.task_comments
  for each row execute procedure public.process_comment_mentions();

-- Histórico de atividade
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, actor_id, action, detail)
    values (new.id, actor, 'criada', new.title);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.column_id is distinct from old.column_id then
      insert into public.task_activity (task_id, actor_id, action, detail)
      values (new.id, actor, 'coluna', old.column_id || ' → ' || new.column_id);
    end if;
    if new.priority is distinct from old.priority then
      insert into public.task_activity (task_id, actor_id, action, detail)
      values (new.id, actor, 'prioridade', old.priority || ' → ' || new.priority);
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into public.task_activity (task_id, actor_id, action, detail)
      values (new.id, actor, 'responsavel', coalesce((select name from public.profiles where id=new.assignee_id),'ninguém'));
    end if;
    if new.due is distinct from old.due then
      insert into public.task_activity (task_id, actor_id, action, detail)
      values (new.id, actor, 'prazo', coalesce(to_char(new.due,'DD/MM/YYYY'),'sem prazo'));
    end if;
    if new.title is distinct from old.title then
      insert into public.task_activity (task_id, actor_id, action, detail)
      values (new.id, actor, 'titulo', new.title);
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists on_task_activity on public.tasks;
create trigger on_task_activity
  after insert or update on public.tasks
  for each row execute procedure public.log_task_activity();

-- Geração de tarefas recorrentes
create or replace function public.generate_recurring_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  dow int := extract(dow from current_date);
  dom int := extract(day from current_date);
begin
  for r in
    select * from public.tasks
    where is_recurring_template = true
      and (last_generated_date is null or last_generated_date < current_date)
      and (
        recurrence = 'diaria'
        or (recurrence = 'semanal' and recurrence_weekday = dow)
        or (recurrence = 'mensal' and recurrence_day_of_month = dom)
      )
  loop
    insert into public.tasks (project_id, title, description, column_id, priority, assignee_id, due, created_by, origin_template_id)
    values (r.project_id, r.title, r.description, 'todo', r.priority, r.assignee_id, current_date, r.created_by, r.id);

    update public.tasks set last_generated_date = current_date where id = r.id;
  end loop;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'generate-recurring-tasks';
select cron.schedule('generate-recurring-tasks', '5 6 * * *', $$select public.generate_recurring_tasks();$$);
