-- Função genérica de envio de email via Resend
create or replace function public.app_send_email(to_email text, subject text, html_body text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  api_key text;
  request_id bigint;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Vizta Task Management <onboarding@resend.dev>',
      'to', jsonb_build_array(to_email),
      'subject', subject,
      'html', html_body
    )
  ) into request_id;
  return request_id;
end;
$$;

-- Email imediato quando uma tarefa é atribuída
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

drop trigger if exists on_task_assignment_notify on public.task_assignment_events;
create trigger on_task_assignment_notify
  after insert on public.task_assignment_events
  for each row execute procedure public.notify_task_assignment();

-- Resumo diário: tarefas de hoje + prazos a aproximar-se (próximos 3 dias)
create or replace function public.send_daily_digests()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  today_html text;
  upcoming_html text;
  body_html text;
begin
  for r in
    select distinct p.id, p.name, p.email
    from public.profiles p
    join public.tasks t on t.assignee_id = p.id
    where t.column_id <> 'done'
      and t.due is not null
      and t.due <= current_date + interval '3 days'
  loop
    select coalesce(string_agg('<li>' || t.title || ' — ' || pr.name || '</li>', ''), '') into today_html
    from public.tasks t join public.projects pr on pr.id = t.project_id
    where t.assignee_id = r.id and t.column_id <> 'done' and t.due = current_date;

    select coalesce(string_agg('<li>' || t.title || ' — ' || pr.name || ' (prazo ' || to_char(t.due,'DD/MM') || ')</li>', ''), '') into upcoming_html
    from public.tasks t join public.projects pr on pr.id = t.project_id
    where t.assignee_id = r.id and t.column_id <> 'done' and t.due > current_date and t.due <= current_date + interval '3 days';

    body_html := '<p>Bom dia ' || coalesce(r.name,'') || ',</p>';
    if today_html <> '' then
      body_html := body_html || '<p><strong>Tarefas com prazo hoje:</strong></p><ul>' || today_html || '</ul>';
    end if;
    if upcoming_html <> '' then
      body_html := body_html || '<p><strong>Prazos a aproximar-se:</strong></p><ul>' || upcoming_html || '</ul>';
    end if;
    body_html := body_html || '<p><a href="https://dfintaskmgt.netlify.app">Abrir a app</a></p>';

    perform public.app_send_email(r.email, 'O teu resumo de tarefas de hoje', body_html);
  end loop;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'daily-task-digest';
select cron.schedule('daily-task-digest', '0 7 * * *', $$select public.send_daily_digests();$$);
