-- Plans: Free, Team and Business (plotskart.in pricing, 30 Oct 2026).
--
--   plan       owners  team logins  projects  AI layout reads          WhatsApp/SMS a month
--   free         1         0            2      1 per project (2 total)  none (app and push alerts only)
--   team         1         5            5      5 a month                1,000
--   business     2        15           10      10 a month               2,500
--
-- Everything is enforced in the database, so the website, the web app and the phone apps all follow the
-- same limits without an app update. In-app and push notifications are never limited.
-- Once a month's allowance is used, top-up credits (extra_ai_reads, extra_messages; sold at ₹99 and ₹1)
-- are spent; when those run out, AI reads are refused and messages are logged as 'monthly limit reached'.
-- Demo companies keep their own rules (3 AI reads, nothing ever sent) and skip plan limits.

-- 1. Plan and top-up credits on each company. Companies that already exist get Business, so nobody who
--    signed up before today loses anything; new companies start on Free.
alter table public.orgs add column plan text not null default 'business' check (plan in ('free', 'team', 'business'));
alter table public.orgs alter column plan set default 'free';
alter table public.orgs add column extra_ai_reads int not null default 0 check (extra_ai_reads >= 0);
alter table public.orgs add column extra_messages int not null default 0 check (extra_messages >= 0);
-- owners still update only name, reminder days and timezone (column grant from 20261026000000), never their plan

-- 2. What each plan allows
create or replace function public._plan_limits(p_plan text,
  out projects int, out owners int, out team int, out ai_reads int, out messages int)
language sql immutable set search_path = public as $$
  select v.projects, v.owners, v.team, v.ai_reads, v.messages
  from (values ('free', 2, 1, 0, 0, 0),
               ('team', 5, 1, 5, 5, 1000),
               ('business', 10, 2, 15, 10, 2500)) as v(plan, projects, owners, team, ai_reads, messages)
  where v.plan = p_plan
$$;

-- 3. Monthly usage per company (calendar month in the company's timezone)
create table public.plan_usage (
  org_id uuid not null references public.orgs on delete cascade,
  month date not null,
  messages int not null default 0,
  ai_reads int not null default 0,
  primary key (org_id, month)
);
alter table public.plan_usage enable row level security;
create policy "owner reads usage" on public.plan_usage for select
  using (org_id = (select public.my_org()) and (select public.my_role()) = 'owner');
revoke insert, update, delete on public.plan_usage from authenticated, anon;

-- Takes one unit of this month's allowance, or one top-up credit once the allowance is used.
-- p_kind is 'messages' or 'ai_reads'. Free companies never get WhatsApp/SMS, top-ups included.
create or replace function public._use_quota(p_org uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o orgs; lim record; v_month date; v_used int;
begin
  select * into o from orgs where id = p_org for update;  -- one at a time per company
  if not found then return false; end if;
  if o.is_demo then return true; end if;
  if p_kind = 'messages' and o.plan = 'free' then return false; end if;
  select * into lim from _plan_limits(o.plan);
  v_month := date_trunc('month', now() at time zone o.timezone)::date;
  insert into plan_usage (org_id, month) values (p_org, v_month) on conflict do nothing;
  select case when p_kind = 'messages' then messages else ai_reads end into v_used
  from plan_usage where org_id = p_org and month = v_month;
  if v_used >= (case when p_kind = 'messages' then lim.messages else lim.ai_reads end) then
    if p_kind = 'messages' and o.extra_messages > 0 then
      update orgs set extra_messages = extra_messages - 1 where id = p_org;
    elsif p_kind = 'ai_reads' and o.extra_ai_reads > 0 then
      update orgs set extra_ai_reads = extra_ai_reads - 1 where id = p_org;
    else
      return false;
    end if;
  end if;
  update plan_usage set messages = messages + (p_kind = 'messages')::int, ai_reads = ai_reads + (p_kind = 'ai_reads')::int
  where org_id = p_org and month = v_month;
  return true;
end $$;

-- 4. Projects running at once
create or replace function public._check_project_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orgs; v_max int; v_n int;
begin
  select * into o from orgs where id = new.org_id for update;
  if o.is_demo then return new; end if;
  select projects into v_max from _plan_limits(o.plan);
  select count(*) into v_n from projects where org_id = new.org_id;
  if v_n >= v_max then
    raise exception 'The % plan runs % projects at a time. %', initcap(o.plan), v_max,
      case when o.plan = 'business' then 'Talk to us to run more.' else 'Upgrade to add another project.' end;
  end if;
  return new;
end $$;
create trigger projects_plan_limit before insert on public.projects
  for each row execute function public._check_project_limit();

-- 5. Team and owner logins. Business allows a second owner, so invites may now carry the owner role.
alter table public.invites drop constraint invites_role_check;

-- counts active people plus open invites for the role group (owners, or everyone else)
create or replace function public._seats_used(p_org uuid, p_owner boolean, p_skip_invite uuid default null) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from profiles where org_id = p_org and active and (role = 'owner') = p_owner)::int
       + (select count(*) from invites where org_id = p_org and accepted_at is null and (role = 'owner') = p_owner
            and id is distinct from p_skip_invite)::int
$$;

create or replace function public._check_seat(p_org uuid, p_owner boolean, p_skip_invite uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare o orgs; lim record;
begin
  select * into o from orgs where id = p_org for update;
  if o.is_demo then return; end if;
  select * into lim from _plan_limits(o.plan);
  if p_owner and _seats_used(p_org, true, p_skip_invite) >= lim.owners then
    if lim.owners = 1 then
      raise exception 'The % plan has 1 owner login. A second owner comes with Business.', initcap(o.plan);
    end if;
    raise exception 'The % plan has % owner logins and both are in use.', initcap(o.plan), lim.owners;
  elsif not p_owner and _seats_used(p_org, false, p_skip_invite) >= lim.team then
    if lim.team = 0 then
      raise exception 'The Free plan is for the owner only. Upgrade to Team to add your sales team.';
    end if;
    raise exception 'The % plan has % team logins and they are all in use. %', initcap(o.plan), lim.team,
      case when o.plan = 'business' then 'Switch off someone who has left, or talk to us for more.'
           else 'Upgrade, or switch off someone who has left.' end;
  end if;
end $$;

-- new invites, and invites changed to another role
create or replace function public._check_invite_seat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.accepted_at is not null then return new; end if;            -- claiming an invite uses the seat it already held
  if tg_op = 'UPDATE' and new.role = old.role and old.accepted_at is null then return new; end if;
  perform _check_seat(new.org_id, new.role = 'owner', case when tg_op = 'UPDATE' then new.id end);
  return new;
end $$;
create trigger invites_plan_limit before insert or update on public.invites
  for each row execute function public._check_invite_seat();

-- switching someone back on who had been switched off
create or replace function public._check_reactivation_seat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is not null and new.active and not old.active and old.org_id is not distinct from new.org_id then
    perform _check_seat(new.org_id, new.role = 'owner');
  end if;
  return new;
end $$;
create trigger profiles_plan_limit before update of active on public.profiles
  for each row execute function public._check_reactivation_seat();

-- 6. AI layout reads. Free: one per project, so as many in total as Free has projects.
--    Team and Business: a monthly allowance. Demo companies: unchanged (3 each, 30 across all demos a day).
create or replace function public.claim_ai_read() returns boolean
language plpgsql security definer set search_path = public as $$
declare o orgs; v_ok boolean;
begin
  select * into o from orgs where id = my_org() for update;
  if not found then return false; end if;
  if o.is_demo then
    update orgs set ai_reads = ai_reads + 1
    where id = o.id and ai_reads < 3
      and (select count(*) from orgs d where d.is_demo and d.ai_reads > 0 and d.created_at > now() - interval '1 day') < 30
    returning true into v_ok;
    return coalesce(v_ok, false);
  end if;
  if o.plan = 'free' then
    if o.ai_reads < (select projects from _plan_limits('free')) then
      update orgs set ai_reads = ai_reads + 1 where id = o.id;
      return true;
    elsif o.extra_ai_reads > 0 then
      update orgs set ai_reads = ai_reads + 1, extra_ai_reads = extra_ai_reads - 1 where id = o.id;
      return true;
    end if;
    return false;
  end if;
  if _use_quota(o.id, 'ai_reads') then
    update orgs set ai_reads = ai_reads + 1 where id = o.id;
    return true;
  end if;
  return false;
end $$;

-- 7. WhatsApp and SMS. Every message is still logged (the app shows it under Reminders); only the ones the
--    plan covers stay 'queued', and the deliver function sends nothing else.
create or replace function public._limit_customer_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if new.whatsapp_status is distinct from 'queued' and new.sms_status is distinct from 'queued' then return new; end if;
  if _use_quota(new.org_id, 'messages') then return new; end if;
  v_reason := case when (select plan from orgs where id = new.org_id) = 'free' then 'not in plan' else 'monthly limit reached' end;
  if new.whatsapp_status = 'queued' then new.whatsapp_status := v_reason; end if;
  if new.sms_status = 'queued' then new.sms_status := v_reason; end if;
  return new;
end $$;
create trigger customer_messages_plan_limit before insert on public.customer_messages
  for each row execute function public._limit_customer_message();

create or replace function public._limit_team_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_status is distinct from 'queued' then return new; end if;
  if _use_quota(new.org_id, 'messages') then return new; end if;
  new.whatsapp_status := case when (select plan from orgs where id = new.org_id) = 'free' then 'not in plan' else 'monthly limit reached' end;
  return new;
end $$;
create trigger team_messages_plan_limit before insert on public.team_messages
  for each row execute function public._limit_team_message();

-- 8. Changing a company's plan and adding top-ups (₹99 per AI read, ₹1 per message) after payment.
--    Service role only: run from the Supabase SQL editor or a future billing function, never from the app.
create or replace function public.admin_set_plan(p_org uuid, p_plan text) returns public.orgs
language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if p_plan not in ('free', 'team', 'business') then raise exception 'Unknown plan %', p_plan; end if;
  update orgs set plan = p_plan where id = p_org returning * into o;
  if not found then raise exception 'Company not found'; end if;
  return o;
end $$;

create or replace function public.admin_add_credits(p_org uuid, p_ai_reads int default 0, p_messages int default 0) returns public.orgs
language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if p_ai_reads < 0 or p_messages < 0 then raise exception 'Credits must be zero or more'; end if;
  update orgs set extra_ai_reads = extra_ai_reads + p_ai_reads, extra_messages = extra_messages + p_messages
  where id = p_org returning * into o;
  if not found then raise exception 'Company not found'; end if;
  return o;
end $$;

-- the owner's view of their plan and this month's usage
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan', o.plan,
    'limits', to_jsonb(l),
    'used', jsonb_build_object(
      'projects', (select count(*) from projects where org_id = o.id),
      'owners', public._seats_used(o.id, true),
      'team', public._seats_used(o.id, false),
      'ai_reads', case when o.plan = 'free' then o.ai_reads else coalesce(u.ai_reads, 0) end,
      'messages', coalesce(u.messages, 0)),
    'extra_ai_reads', o.extra_ai_reads,
    'extra_messages', o.extra_messages)
  from orgs o
  cross join lateral public._plan_limits(o.plan) l
  left join plan_usage u on u.org_id = o.id and u.month = date_trunc('month', now() at time zone o.timezone)::date
  where o.id = my_org() and my_role() = 'owner'
$$;

revoke execute on function public._plan_limits(text), public._use_quota(uuid, text), public._check_project_limit(),
  public._seats_used(uuid, boolean, uuid), public._check_seat(uuid, boolean, uuid), public._check_invite_seat(),
  public._check_reactivation_seat(), public._limit_customer_message(), public._limit_team_message(),
  public.admin_set_plan(uuid, text), public.admin_add_credits(uuid, int, int)
  from public, anon, authenticated;
revoke execute on function public.my_plan() from public, anon;
