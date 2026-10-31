-- Undo 20261101000000_whatsapp_team_alerts.sql.
-- Dropping team_messages and the opt-in columns loses team alert history and everyone's alert settings.
select cron.unschedule('plotskart-owner-summary') where exists (select 1 from cron.job where jobname = 'plotskart-owner-summary');
drop function if exists public.run_owner_summaries();
drop trigger if exists plot_events_team_alert on public.plot_events;
drop function if exists public._team_alert_on_event();
drop function if exists public.set_my_whatsapp(text, boolean, boolean);

-- restore _send_reminder (20261023000000_init.sql) and whatsapp_opt_out (20261031000000_whatsapp_buyer_messages.sql)
create or replace function public._send_reminder(p_plot uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare pl plots; v_tz text; v_days int; t record;
begin
  select * into pl from plots where id = p_plot;
  select timezone into v_tz from orgs where id = pl.org_id;
  v_days := case when p_kind = 'reg' then pl.reg_date else pl.due_date end - (now() at time zone v_tz)::date;
  select * into t from _reminder_texts(pl, p_kind, v_days);
  insert into notifications (org_id, recipient, actor, kind, text, plot_id)
  select pl.org_id, id, auth.uid(), p_kind, t.team, pl.id from profiles
  where org_id = pl.org_id and active and (role in ('owner', 'sales') or id = pl.sold_by) and id is distinct from auth.uid();
  perform _queue_message(pl, p_kind, t.cust, t.template, t.params);
end $$;

create or replace function public.whatsapp_opt_out(p_wa_to text) returns int
language sql security definer set search_path = public as $$
  with p as (
    update plots set buyer_whatsapp = false, updated_at = now()
    where buyer_whatsapp and id in (select plot_id from customer_messages where wa_to = p_wa_to and plot_id is not null)
    returning id
  ) select count(*)::int from p
$$;

revoke execute on function public.whatsapp_opt_out(text) from public, anon, authenticated;
drop function if exists public._queue_team_alert(public.plots, text, text, jsonb);
drop table if exists public.team_messages;
alter table public.profiles drop column if exists whatsapp_summary;
alter table public.profiles drop column if exists whatsapp_alerts;
