-- PocketPlot schema: one org (real-estate company) owns projects, plots and a team.
-- Plot changes go through security-definer functions so every change is
-- checked against the caller's role, logged, and fanned out as notifications.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create type public.user_role as enum ('owner', 'sales', 'broker');
create type public.plot_status as enum ('available', 'booked', 'sold');

-- ---------------------------------------------------------------- tables

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  reg_days int not null default 2 check (reg_days between 0 and 30),
  pay_days int not null default 3 check (pay_days between 0 and 30),
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  org_id uuid references public.orgs on delete set null,
  email text,
  full_name text not null default '',
  phone text,
  role public.user_role not null default 'owner',
  commission_rate numeric(5,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.profiles (org_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  email text not null,
  full_name text not null,
  phone text,
  role public.user_role not null check (role <> 'owner'),
  commission_rate numeric(5,2) not null default 0,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  location text not null default '',
  lat double precision,
  lng double precision,
  approval text,
  launched text,
  guideline_rate numeric(12,2) not null default 0,
  sale_rate numeric(12,2) not null default 0,
  rate_updated_by uuid references public.profiles,
  rate_updated_at timestamptz,
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.projects (org_id);

-- owner-only money tables live apart from projects so team members never see them
create table public.project_funding (
  project_id uuid primary key references public.projects on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  bank numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  cash numeric(14,2) not null default 0
);

create table public.plots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  label text not null,
  geom jsonb not null,
  front_ft numeric(8,2) not null,
  depth_ft numeric(8,2) not null,
  sqft numeric(12,2) not null,
  facing text[] not null default '{}',
  status public.plot_status not null default 'available',
  rate_override numeric(12,2),
  buyer_name text,
  buyer_phone text,
  paid numeric(14,2) not null default 0,
  due_date date,
  reg_date date,
  registered boolean not null default false,
  sold_by uuid references public.profiles,
  commission_rate numeric(5,2),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles,
  unique (project_id, label)
);
create index on public.plots (org_id);

create table public.plot_events (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null references public.plots on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  actor uuid references public.profiles,
  text text not null,
  created_at timestamptz not null default now()
);
create index on public.plot_events (plot_id, created_at desc);

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null references public.plots on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  received_on date not null default current_date,
  recorded_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

create table public.cost_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  category text not null,
  party text not null,
  committed numeric(14,2) not null default 0 check (committed >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  created_at timestamptz not null default now()
);

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  member_id uuid not null references public.profiles on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  recipient uuid not null references public.profiles on delete cascade,
  actor uuid references public.profiles on delete set null,
  kind text not null,
  text text not null,
  plot_id uuid references public.plots on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (recipient, created_at desc);

create table public.device_tokens (
  token text primary key,
  user_id uuid not null references public.profiles on delete cascade,
  platform text not null,
  updated_at timestamptz not null default now()
);

create table public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  plot_id uuid references public.plots on delete set null,
  to_name text not null,
  to_phone text not null,
  kind text not null,
  body text not null,
  template text not null,
  params jsonb not null default '[]'::jsonb,
  whatsapp_status text not null default 'queued',
  sms_status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.customer_messages (org_id, created_at desc);

-- one row per reminder already sent, so the daily job never repeats itself
create table public.reminder_log (
  key text primary key,
  org_id uuid not null references public.orgs on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid() and active
$$;

create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public._assert_role(p_roles public.user_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if my_org() is null or not (my_role() = any (p_roles)) then
    raise exception 'You do not have permission to do this';
  end if;
end $$;

create or replace function public._assert_member(p_user uuid, p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_user and org_id = p_org and active) then
    raise exception 'That person is not on your team';
  end if;
end $$;

create or replace function public._inr(n numeric) returns text
language sql immutable as $$
  select '₹' || to_char(round(coalesce(n, 0)), 'FM9,99,99,99,99,999')
$$;

create or replace function public._d(d date) returns text
language sql immutable as $$
  select to_char(d, 'FMDD Mon YYYY')
$$;

create or replace function public._actor_name() returns text
language sql stable security definer set search_path = public as $$
  select case when role = 'owner' then 'Owner' else full_name end from profiles where id = auth.uid()
$$;

create or replace function public._value(pl public.plots) returns numeric
language sql stable security definer set search_path = public as $$
  select pl.sqft * coalesce(pl.rate_override, p.sale_rate) from projects p where p.id = pl.project_id
$$;

create or replace function public._event(pl public.plots, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into plot_events (plot_id, org_id, actor, text) values (pl.id, pl.org_id, auth.uid(), p_text)
$$;

-- notify every active team member except the person who made the change
create or replace function public._notify_org(pl public.plots, p_kind text, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (org_id, recipient, actor, kind, text, plot_id)
  select pl.org_id, id, auth.uid(), p_kind, p_text, pl.id
  from profiles where org_id = pl.org_id and active and id is distinct from auth.uid()
$$;

create or replace function public._queue_message(pl public.plots, p_kind text, p_body text, p_template text, p_params jsonb) returns void
language sql security definer set search_path = public as $$
  insert into customer_messages (org_id, plot_id, to_name, to_phone, kind, body, template, params)
  select pl.org_id, pl.id, pl.buyer_name, pl.buyer_phone, p_kind, p_body, p_template, p_params
  where pl.buyer_phone is not null
$$;

-- new auth user -> bare profile; claim_invite() or create_org() attaches it to a company
create or replace function public._handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, lower(new.email)) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public._handle_new_user();

-- ---------------------------------------------------------------- account RPCs

create or replace function public.create_org(p_company text, p_full_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from profiles where id = auth.uid() and org_id is not null) then
    raise exception 'You already belong to a company';
  end if;
  insert into orgs (name) values (trim(p_company)) returning id into v_org;
  update profiles set org_id = v_org, role = 'owner', full_name = trim(p_full_name), commission_rate = 0
  where id = auth.uid();
  return v_org;
end $$;

create or replace function public.claim_invite() returns boolean
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  select * into inv from invites
  where lower(email) = lower(auth.jwt() ->> 'email') and accepted_at is null
  order by created_at desc limit 1;
  if not found then return false; end if;
  update profiles set org_id = inv.org_id, role = inv.role, full_name = inv.full_name,
    phone = inv.phone, commission_rate = inv.commission_rate, active = true
  where id = auth.uid() and org_id is null;
  update invites set accepted_at = now() where id = inv.id;
  return true;
end $$;

create or replace function public.update_member(p_member uuid, p_rate numeric, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner']::user_role[]);
  if p_member = auth.uid() then raise exception 'You cannot change your own account here'; end if;
  update profiles set commission_rate = p_rate, active = p_active where id = p_member and org_id = my_org();
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where recipient = auth.uid() and read_at is null
$$;

-- ---------------------------------------------------------------- project RPCs

create or replace function public.create_project(p jsonb, p_plots jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org();
begin
  perform _assert_role(array['owner']::user_role[]);
  insert into projects (org_id, name, location, lat, lng, approval, launched, guideline_rate, sale_rate, layout, rate_updated_by, rate_updated_at)
  values (v_org, trim(p ->> 'name'), coalesce(p ->> 'location', ''), (p ->> 'lat')::float8, (p ->> 'lng')::float8,
    nullif(p ->> 'approval', ''), nullif(p ->> 'launched', ''),
    coalesce((p ->> 'guideline_rate')::numeric, 0), coalesce((p ->> 'sale_rate')::numeric, 0),
    coalesce(p -> 'layout', '{}'::jsonb), auth.uid(), now())
  returning id into v_id;
  insert into project_funding (project_id, org_id) values (v_id, v_org);
  insert into plots (project_id, org_id, label, geom, front_ft, depth_ft, sqft, facing)
  select v_id, v_org, x.label, x.geom, x.front_ft, x.depth_ft, x.sqft, x.facing
  from jsonb_to_recordset(p_plots) as x(label text, geom jsonb, front_ft numeric, depth_ft numeric, sqft numeric, facing text[]);
  return v_id;
end $$;

create or replace function public.set_project_rates(p_project uuid, p_guideline numeric, p_sale numeric) returns public.projects
language plpgsql security definer set search_path = public as $$
declare pr projects;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  update projects set guideline_rate = p_guideline, sale_rate = p_sale, rate_updated_by = auth.uid(), rate_updated_at = now()
  where id = p_project and org_id = my_org() returning * into pr;
  if not found then raise exception 'Project not found'; end if;
  insert into notifications (org_id, recipient, actor, kind, text)
  select pr.org_id, id, auth.uid(), 'rate',
    format('%s updated %s rates: guideline %s/sq ft, sale %s/sq ft', _actor_name(), pr.name, _inr(p_guideline), _inr(p_sale))
  from profiles where org_id = pr.org_id and active and id is distinct from auth.uid();
  return pr;
end $$;

-- ---------------------------------------------------------------- plot RPCs

create or replace function public.book_plot(p_plot uuid, p_buyer text, p_phone text, p_advance numeric, p_due date,
  p_reg date default null, p_sold_by uuid default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_by uuid; v_org_name text;
begin
  perform _assert_role(array['owner', 'sales', 'broker']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status <> 'available' then raise exception 'Plot % is already %', pl.label, pl.status; end if;
  if coalesce(trim(p_buyer), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Customer name and mobile number are required';
  end if;
  v_by := case when my_role() = 'broker' or p_sold_by is null then auth.uid() else p_sold_by end;
  perform _assert_member(v_by, pl.org_id);
  select * into pr from projects where id = pl.project_id;
  select name into v_org_name from orgs where id = pl.org_id;

  update plots set status = 'booked', buyer_name = trim(p_buyer), buyer_phone = trim(p_phone),
    paid = least(greatest(coalesce(p_advance, 0), 0), _value(pl)), due_date = p_due, reg_date = p_reg,
    registered = false, sold_by = v_by, updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;

  if pl.paid > 0 then
    insert into customer_payments (plot_id, org_id, amount, recorded_by) values (pl.id, pl.org_id, pl.paid, auth.uid());
  end if;
  perform _event(pl, format('Booked for %s, advance %s', pl.buyer_name, _inr(pl.paid)));
  perform _notify_org(pl, 'booked', format('%s booked %s · %s for %s (advance %s)', _actor_name(), pl.label, pr.name, pl.buyer_name, _inr(pl.paid)));
  perform _queue_message(pl, 'booking',
    format('Dear %s, thank you for booking plot %s at %s. Advance received: %s. Balance %s is due by %s. – %s',
      pl.buyer_name, pl.label, pr.name, _inr(pl.paid), _inr(_value(pl) - pl.paid), coalesce(_d(pl.due_date), 'the agreed date'), v_org_name),
    'booking_confirmation',
    jsonb_build_array(pl.buyer_name, pl.label, pr.name, _inr(pl.paid), _inr(_value(pl) - pl.paid), coalesce(_d(pl.due_date), '-')));
  return pl;
end $$;

create or replace function public.sell_plot(p_plot uuid, p_amount numeric, p_reg date,
  p_buyer text default null, p_phone text default null, p_sold_by uuid default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_by uuid; v_rate numeric; v_was plot_status;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status = 'sold' then raise exception 'Plot % is already sold', pl.label; end if;
  v_was := pl.status;
  if v_was = 'available' then
    if coalesce(trim(p_buyer), '') = '' or coalesce(trim(p_phone), '') = '' then
      raise exception 'Customer name and mobile number are required';
    end if;
    v_by := coalesce(p_sold_by, auth.uid());
    perform _assert_member(v_by, pl.org_id);
  else
    v_by := pl.sold_by;
  end if;
  select case when role = 'owner' then 0 else commission_rate end into v_rate from profiles where id = v_by;
  select * into pr from projects where id = pl.project_id;

  update plots set status = 'sold',
    buyer_name = case when v_was = 'available' then trim(p_buyer) else buyer_name end,
    buyer_phone = case when v_was = 'available' then trim(p_phone) else buyer_phone end,
    sold_by = v_by, commission_rate = coalesce(v_rate, 0),
    paid = least(paid + greatest(coalesce(p_amount, 0), 0), _value(pl)),
    reg_date = p_reg, registered = false, updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;

  if coalesce(p_amount, 0) > 0 then
    insert into customer_payments (plot_id, org_id, amount, recorded_by) values (pl.id, pl.org_id, p_amount, auth.uid());
  end if;
  perform _event(pl, format('Marked sold, registration %s', coalesce(_d(pl.reg_date), 'not set')));
  perform _notify_org(pl, 'sold', format('%s marked %s · %s as Sold to %s. Registration on %s', _actor_name(), pl.label, pr.name, pl.buyer_name, coalesce(_d(pl.reg_date), 'not set')));
  return pl;
end $$;

create or replace function public.record_payment(p_plot uuid, p_amount numeric, p_next_due date default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status = 'available' then raise exception 'This plot has no customer yet'; end if;
  select * into pr from projects where id = pl.project_id;
  update plots set paid = least(paid + p_amount, _value(pl)), due_date = coalesce(p_next_due, due_date),
    updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  insert into customer_payments (plot_id, org_id, amount, recorded_by) values (pl.id, pl.org_id, p_amount, auth.uid());
  perform _event(pl, format('Payment received %s', _inr(p_amount)));
  perform _notify_org(pl, 'money', format('%s recorded a payment of %s for %s · %s (balance %s)', _actor_name(), _inr(p_amount), pl.label, pr.name, _inr(_value(pl) - pl.paid)));
  return pl;
end $$;

create or replace function public.set_registration(p_plot uuid, p_date date) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status = 'available' then raise exception 'This plot has no customer yet'; end if;
  select * into pr from projects where id = pl.project_id;
  update plots set reg_date = p_date, updated_at = now(), updated_by = auth.uid() where id = p_plot returning * into pl;
  perform _event(pl, format('Registration set for %s', _d(p_date)));
  perform _notify_org(pl, 'reg', format('%s set registration of %s · %s for %s', _actor_name(), pl.label, pr.name, _d(p_date)));
  return pl;
end $$;

create or replace function public.complete_registration(p_plot uuid) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status <> 'sold' then raise exception 'Only sold plots can be registered'; end if;
  select * into pr from projects where id = pl.project_id;
  update plots set registered = true, reg_date = coalesce(least(reg_date, current_date), current_date),
    updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  perform _event(pl, 'Registration completed');
  perform _notify_org(pl, 'sold', format('%s completed registration of %s · %s for %s', _actor_name(), pl.label, pr.name, pl.buyer_name));
  return pl;
end $$;

create or replace function public.cancel_booking(p_plot uuid) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_who text;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status <> 'booked' then raise exception 'Only booked plots can be cancelled'; end if;
  v_who := pl.buyer_name;
  select * into pr from projects where id = pl.project_id;
  update plots set status = 'available', buyer_name = null, buyer_phone = null, paid = 0, due_date = null,
    reg_date = null, registered = false, sold_by = null, commission_rate = null, updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  perform _event(pl, format('Booking by %s cancelled', v_who));
  perform _notify_org(pl, 'available', format('Owner cancelled the booking of %s · %s. Plot is available again.', pl.label, pr.name));
  return pl;
end $$;

create or replace function public.set_plot_rate(p_plot uuid, p_rate numeric) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status <> 'available' then raise exception 'Price can only change while the plot is available'; end if;
  select * into pr from projects where id = pl.project_id;
  update plots set rate_override = nullif(p_rate, 0), updated_at = now(), updated_by = auth.uid() where id = p_plot returning * into pl;
  perform _event(pl, case when pl.rate_override is null then 'Price reset to project rate' else format('Price set to %s/sq ft', _inr(pl.rate_override)) end);
  perform _notify_org(pl, 'rate', format('%s changed the price of %s · %s to %s/sq ft', _actor_name(), pl.label, pr.name, _inr(coalesce(pl.rate_override, pr.sale_rate))));
  return pl;
end $$;

create or replace function public.pay_commission(p_member uuid, p_project uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org(); v_name text;
begin
  perform _assert_role(array['owner']::user_role[]);
  perform _assert_member(p_member, v_org);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  insert into commission_payments (org_id, member_id, project_id, amount) values (v_org, p_member, p_project, p_amount);
  select name into v_name from projects where id = p_project and org_id = v_org;
  insert into notifications (org_id, recipient, actor, kind, text)
  values (v_org, p_member, auth.uid(), 'money', format('Owner paid you %s commission for %s', _inr(p_amount), v_name));
end $$;

-- ---------------------------------------------------------------- reminders

create or replace function public._reminder_texts(pl public.plots, p_kind text, p_days int,
  out team text, out cust text, out template text, out params jsonb)
language plpgsql stable security definer set search_path = public as $$
declare pr projects; v_bal numeric; v_org text; v_when text;
begin
  select * into pr from projects where id = pl.project_id;
  select name into v_org from orgs where id = pl.org_id;
  v_bal := greatest(_value(pl) - pl.paid, 0);
  v_when := case when p_days < 0 then format('overdue by %s day(s)', -p_days)
                 when p_days = 0 then 'today' when p_days = 1 then 'tomorrow' else format('in %s days', p_days) end;
  if p_kind = 'reg' then
    team := format('Registration %s: %s · %s for %s on %s. Prepare sale deed draft, stamp duty challan and ID copies.%s',
      v_when, pl.label, pr.name, pl.buyer_name, _d(pl.reg_date),
      case when v_bal > 0 then format(' Balance %s still to collect.', _inr(v_bal)) else '' end);
    cust := format('Dear %s, registration of plot %s at %s is scheduled on %s at the Sub-Registrar office. Please bring Aadhaar, PAN, 2 passport photos%s. – %s',
      pl.buyer_name, pl.label, pr.name, _d(pl.reg_date),
      case when v_bal > 0 then format(' and the balance of %s', _inr(v_bal)) else '' end, v_org);
    template := 'registration_reminder';
    params := jsonb_build_array(pl.buyer_name, pl.label, pr.name, _d(pl.reg_date), _inr(v_bal));
  else
    team := format('Payment %s: %s owes %s on %s · %s.', case when p_days < 0 then v_when else 'due ' || v_when end,
      pl.buyer_name, _inr(v_bal), pl.label, pr.name);
    cust := format('Dear %s, a reminder that the balance of %s for plot %s at %s %s %s. Please contact us to complete the payment. – %s',
      pl.buyer_name, _inr(v_bal), pl.label, pr.name, case when p_days < 0 then 'was due on' else 'is due on' end, _d(pl.due_date), v_org);
    template := 'payment_reminder';
    params := jsonb_build_array(pl.buyer_name, _inr(v_bal), pl.label, pr.name, _d(pl.due_date));
  end if;
end $$;

-- app notification to owner + sales + whoever handled the plot, WhatsApp/SMS to the customer
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

create or replace function public.send_reminder(p_plot uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  if p_kind not in ('reg', 'pay') then raise exception 'Unknown reminder type'; end if;
  if not exists (select 1 from plots where id = p_plot and org_id = my_org() and status <> 'available') then
    raise exception 'Plot not found';
  end if;
  perform _send_reminder(p_plot, p_kind);
end $$;

-- runs every morning from pg_cron; safe to run more than once a day
create or replace function public.run_daily_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_today date; v_days int; v_n int := 0; v_rows int;
begin
  for r in
    select pl.id, pl.org_id, pl.reg_date, pl.registered, pl.due_date, o.reg_days, o.pay_days, o.timezone,
      pl.sqft * coalesce(pl.rate_override, pr.sale_rate) - pl.paid as balance
    from plots pl join projects pr on pr.id = pl.project_id join orgs o on o.id = pl.org_id
    where pl.status <> 'available'
  loop
    v_today := (now() at time zone r.timezone)::date;
    if r.reg_date is not null and not r.registered then
      v_days := r.reg_date - v_today;
      if v_days between 0 and r.reg_days then
        insert into reminder_log (key, org_id) values ('reg:' || r.id || ':' || r.reg_date, r.org_id) on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then perform _send_reminder(r.id, 'reg'); v_n := v_n + 1; end if;
      end if;
    end if;
    if r.balance > 0 and r.due_date is not null then
      v_days := r.due_date - v_today;
      -- from pay_days before the due date, then daily while overdue (up to 30 days)
      if v_days <= r.pay_days and v_days >= -30 then
        insert into reminder_log (key, org_id) values ('pay:' || r.id || ':' || r.due_date || ':' || v_today, r.org_id) on conflict do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then perform _send_reminder(r.id, 'pay'); v_n := v_n + 1; end if;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- 08:00 India time every day
select cron.schedule('pocketplot-daily-reminders', '30 2 * * *', $$select public.run_daily_reminders()$$);

-- ---------------------------------------------------------------- delivery webhook
-- New notifications (push) and customer messages (WhatsApp + SMS) are handed to the
-- `deliver` edge function. URL and shared secret come from Vault (see README).

create or replace function public._call_deliver() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'deliver_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'deliver_secret';
  if v_url is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-deliver-secret', coalesce(v_secret, ''))
  );
  return new;
end $$;

create trigger notifications_deliver after insert on public.notifications
  for each row execute function public._call_deliver();
create trigger customer_messages_deliver after insert on public.customer_messages
  for each row execute function public._call_deliver();

-- ---------------------------------------------------------------- row level security

alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.projects enable row level security;
alter table public.project_funding enable row level security;
alter table public.plots enable row level security;
alter table public.plot_events enable row level security;
alter table public.customer_payments enable row level security;
alter table public.cost_lines enable row level security;
alter table public.commission_payments enable row level security;
alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
alter table public.customer_messages enable row level security;
alter table public.reminder_log enable row level security;

create policy "members read org" on public.orgs for select using (id = my_org());
create policy "owner edits org" on public.orgs for update using (id = my_org() and my_role() = 'owner');

create policy "read self and team" on public.profiles for select using (id = auth.uid() or org_id = my_org());
create policy "edit own name and phone" on public.profiles for update using (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "owner manages invites" on public.invites for all
  using (org_id = my_org() and my_role() = 'owner') with check (org_id = my_org() and my_role() = 'owner');

create policy "members read projects" on public.projects for select using (org_id = my_org());
create policy "owner edits projects" on public.projects for update using (org_id = my_org() and my_role() = 'owner');
create policy "owner deletes projects" on public.projects for delete using (org_id = my_org() and my_role() = 'owner');

create policy "members read plots" on public.plots for select using (org_id = my_org());
create policy "members read plot history" on public.plot_events for select using (org_id = my_org());
create policy "owner and sales read payments" on public.customer_payments for select
  using (org_id = my_org() and my_role() in ('owner', 'sales'));

create policy "owner manages funding" on public.project_funding for all
  using (org_id = my_org() and my_role() = 'owner') with check (org_id = my_org() and my_role() = 'owner');
create policy "owner manages costs" on public.cost_lines for all
  using (org_id = my_org() and my_role() = 'owner') with check (org_id = my_org() and my_role() = 'owner');
create policy "owner reads commissions" on public.commission_payments for select
  using (org_id = my_org() and (my_role() = 'owner' or member_id = auth.uid()));

create policy "read own notifications" on public.notifications for select using (recipient = auth.uid());
create policy "mark own notifications read" on public.notifications for update using (recipient = auth.uid());
revoke update on public.notifications from authenticated, anon;
grant update (read_at) on public.notifications to authenticated;

create policy "manage own devices" on public.device_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owner and sales read messages" on public.customer_messages for select
  using (org_id = my_org() and my_role() in ('owner', 'sales'));

-- internal helpers are not callable from the app
revoke execute on function public._assert_role, public._assert_member, public._event, public._notify_org,
  public._queue_message, public._reminder_texts, public._send_reminder, public.run_daily_reminders,
  public._call_deliver, public._handle_new_user from public, anon, authenticated;

-- ---------------------------------------------------------------- live sync
alter publication supabase_realtime add table public.plots, public.projects, public.notifications, public.profiles, public.orgs;
