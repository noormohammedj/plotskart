-- WhatsApp team alerts and the owner's daily summary, sent from the Plotskart number.
-- Each person opts in for themselves (Meta requires consent from staff too). Additive only.
-- Rollback: supabase/rollbacks/20261101000000_whatsapp_team_alerts.down.sql

-- 1. Opt-in on the person's own profile
alter table public.profiles add column whatsapp_alerts boolean not null default false;
alter table public.profiles add column whatsapp_summary boolean not null default false;

-- 2. Queue of WhatsApp messages to team members (buyers stay in customer_messages)
create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  recipient uuid not null references public.profiles on delete cascade,
  plot_id uuid references public.plots on delete set null,
  to_phone text not null,
  kind text not null,              -- booked | sold | payment | overdue | summary
  template text not null,
  params jsonb not null default '[]'::jsonb,
  whatsapp_status text not null default 'queued',
  wa_to text,
  wa_message_id text,
  wa_status_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.team_messages (org_id, created_at desc);
create index on public.team_messages (recipient, created_at desc);
create index on public.team_messages (wa_message_id);
create index on public.team_messages (wa_to);
alter table public.team_messages enable row level security;
-- each person sees their own alerts; the owner sees the company's
create policy "own alerts, owner sees all" on public.team_messages for select
  using (org_id = (select public.my_org()) and (recipient = (select auth.uid()) or (select public.my_role()) = 'owner'));
create trigger team_messages_deliver after insert on public.team_messages
  for each row execute function public._call_deliver();

-- 3. Turn WhatsApp alerts on or off for yourself
create or replace function public.set_my_whatsapp(p_phone text, p_alerts boolean, p_summary boolean) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  if my_org() is null then raise exception 'You do not have permission to do this'; end if;
  if (coalesce(p_alerts, false) or coalesce(p_summary, false)) and coalesce(trim(p_phone), '') = '' then
    raise exception 'Add your WhatsApp number first';
  end if;
  if coalesce(p_summary, false) and my_role() <> 'owner' then raise exception 'Only the owner gets the daily summary'; end if;
  update profiles set phone = nullif(trim(p_phone), ''), whatsapp_alerts = coalesce(p_alerts, false),
    whatsapp_summary = coalesce(p_summary, false)
  where id = auth.uid() returning * into me;
  return me;
end $$;

-- 4. Alerts go to the owner, sales and whoever handles the plot; never to the person who made the change
create or replace function public._queue_team_alert(pl public.plots, p_kind text, p_template text, p_params jsonb) returns void
language sql security definer set search_path = public as $$
  insert into team_messages (org_id, recipient, plot_id, to_phone, kind, template, params, whatsapp_status)
  select pl.org_id, m.id, pl.id, trim(m.phone), p_kind, p_template, p_params,
    case when o.is_demo then 'demo, not sent' else 'queued' end
  from profiles m join orgs o on o.id = m.org_id
  where m.org_id = pl.org_id and m.active and m.whatsapp_alerts and coalesce(trim(m.phone), '') <> ''
    and (m.role in ('owner', 'sales') or m.id = pl.sold_by)
    and m.id is distinct from auth.uid()
$$;

-- bookings, sales and payments are all logged in plot_events, so one trigger covers every way they happen
create or replace function public._team_alert_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_actor text; v_amount numeric;
begin
  if new.kind not in ('booked', 'sold', 'payment') then return new; end if;
  select * into pl from plots where id = new.plot_id;
  select * into pr from projects where id = pl.project_id;
  select coalesce(nullif(trim(full_name), ''), 'A team member') into v_actor from profiles where id = new.actor;
  v_actor := coalesce(v_actor, 'Plotskart');
  if new.kind = 'booked' then
    perform _queue_team_alert(pl, 'booked', 'team_plot_booked',
      jsonb_build_array(v_actor, pl.label, pr.name, pl.buyer_name, _inr(pl.paid)));
  elsif new.kind = 'sold' then
    perform _queue_team_alert(pl, 'sold', 'team_plot_sold',
      jsonb_build_array(v_actor, pl.label, pr.name, pl.buyer_name, coalesce(_d(pl.reg_date), 'not set')));
  else
    select amount into v_amount from customer_payments where plot_id = pl.id order by created_at desc, id desc limit 1;
    perform _queue_team_alert(pl, 'payment', 'team_payment_received',
      jsonb_build_array(v_actor, _inr(v_amount), pl.label, pr.name, _inr(greatest(_value(pl) - pl.paid, 0))));
  end if;
  return new;
end $$;
create trigger plot_events_team_alert after insert on public.plot_events
  for each row execute function public._team_alert_on_event();

-- 5. Overdue: same body as 20261023000000_init.sql, plus a team alert when a payment reminder is past its due date
create or replace function public._send_reminder(p_plot uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_tz text; v_days int; t record;
begin
  select * into pl from plots where id = p_plot;
  select timezone into v_tz from orgs where id = pl.org_id;
  v_days := case when p_kind = 'reg' then pl.reg_date else pl.due_date end - (now() at time zone v_tz)::date;
  select * into t from _reminder_texts(pl, p_kind, v_days);
  insert into notifications (org_id, recipient, actor, kind, text, plot_id)
  select pl.org_id, id, auth.uid(), p_kind, t.team, pl.id from profiles
  where org_id = pl.org_id and active and (role in ('owner', 'sales') or id = pl.sold_by) and id is distinct from auth.uid();
  perform _queue_message(pl, p_kind, t.cust, t.template, t.params);
  if p_kind = 'pay' and v_days < 0 then
    select * into pr from projects where id = pl.project_id;
    perform _queue_team_alert(pl, 'overdue', 'team_payment_overdue',
      jsonb_build_array(pl.label, pr.name, pl.buyer_name, _inr(greatest(_value(pl) - pl.paid, 0)), _d(pl.due_date)));
  end if;
end $$;

-- 6. Owner's morning summary (runs after the reminders; skipped on days with nothing to report)
create or replace function public.run_owner_summaries() returns int
language plpgsql security definer set search_path = public as $$
declare o record; m record; s record; v_today date; v_rows int; v_n int := 0;
begin
  for o in select * from orgs where not is_demo loop
    v_today := (now() at time zone o.timezone)::date;
    select count(*) filter (where bal > 0 and due_date = v_today) as n_due,
           coalesce(sum(bal) filter (where bal > 0 and due_date = v_today), 0) as amt_due,
           count(*) filter (where reg_date = v_today and not registered) as n_reg,
           count(*) filter (where bal > 0 and due_date < v_today) as n_over,
           coalesce(sum(bal) filter (where bal > 0 and due_date < v_today), 0) as amt_over
    into s
    from (select pl.due_date, pl.reg_date, pl.registered,
                 greatest(pl.sqft * coalesce(pl.rate_override, pr.sale_rate) - pl.paid, 0) as bal
          from plots pl join projects pr on pr.id = pl.project_id
          where pl.org_id = o.id and pl.status <> 'available') x;
    if s.n_due + s.n_reg + s.n_over = 0 then continue; end if;
    for m in select * from profiles where org_id = o.id and active and role = 'owner' and whatsapp_summary
             and coalesce(trim(phone), '') <> '' loop
      insert into reminder_log (key, org_id) values ('summary:' || m.id || ':' || v_today, o.id) on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then continue; end if;
      insert into team_messages (org_id, recipient, to_phone, kind, template, params)
      values (o.id, m.id, trim(m.phone), 'summary', 'owner_daily_summary', jsonb_build_array(
        coalesce(nullif(split_part(trim(m.full_name), ' ', 1), ''), 'there'), o.name,
        s.n_due::text, _inr(s.amt_due), s.n_reg::text, s.n_over::text, _inr(s.amt_over)));
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;
select cron.schedule('plotskart-owner-summary', '35 2 * * *', $$select public.run_owner_summaries()$$);

-- 7. STOP from a team member switches their alerts off too (buyers as before)
create or replace function public.whatsapp_opt_out(p_wa_to text) returns int
language sql security definer set search_path = public as $$
  with p as (
    update plots set buyer_whatsapp = false, updated_at = now()
    where buyer_whatsapp and id in (select plot_id from customer_messages where wa_to = p_wa_to and plot_id is not null)
    returning id
  ), t as (
    update profiles set whatsapp_alerts = false, whatsapp_summary = false
    where (whatsapp_alerts or whatsapp_summary) and id in (select recipient from team_messages where wa_to = p_wa_to)
    returning id
  ) select ((select count(*) from p) + (select count(*) from t))::int
$$;

revoke execute on function public._queue_team_alert(public.plots, text, text, jsonb), public._team_alert_on_event(),
  public.run_owner_summaries(), public.whatsapp_opt_out(text) from public, anon, authenticated;
