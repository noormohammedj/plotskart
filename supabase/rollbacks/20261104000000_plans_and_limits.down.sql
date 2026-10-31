-- Undo 20261104000000_plans_and_limits.sql: no plans, no limits, claim_ai_read as in 20261026000000.
-- Plan assignments, top-up credits and this month's usage counts are lost; nothing else is touched.

drop trigger if exists customer_messages_plan_limit on public.customer_messages;
drop trigger if exists team_messages_plan_limit on public.team_messages;
drop trigger if exists projects_plan_limit on public.projects;
drop trigger if exists invites_plan_limit on public.invites;
drop trigger if exists profiles_plan_limit on public.profiles;

drop function if exists public.my_plan();
drop function if exists public.admin_add_credits(uuid, int, int);
drop function if exists public.admin_set_plan(uuid, text);
drop function if exists public._limit_team_message();
drop function if exists public._limit_customer_message();
drop function if exists public._check_reactivation_seat();
drop function if exists public._check_invite_seat();
drop function if exists public._check_seat(uuid, boolean, uuid);
drop function if exists public._seats_used(uuid, boolean, uuid);
drop function if exists public._check_project_limit();
drop function if exists public._use_quota(uuid, text);
drop table if exists public.plan_usage;
drop function if exists public._plan_limits(text);

-- invites go back to non-owner roles only; NOT VALID keeps any owner invite already sent
alter table public.invites add constraint invites_role_check check (role <> 'owner') not valid;

alter table public.orgs drop column if exists extra_messages;
alter table public.orgs drop column if exists extra_ai_reads;
alter table public.orgs drop column if exists plan;

create or replace function public.claim_ai_read() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  update orgs set ai_reads = ai_reads + 1
  where id = my_org() and (not is_demo or ai_reads < 3)
    -- across all demo companies, at most 30 reads a day
    and (not is_demo or (select count(*) from orgs d where d.is_demo and d.ai_reads > 0 and d.created_at > now() - interval '1 day') < 30)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
