-- Apartment projects: towers, floors, unit types (with floor plans) and units, in the same app as plots.
-- A unit is a row in `plots` with a tower, a floor and a unit type, so booking, sale, payments, instalments,
-- receipts, reminders, WhatsApp, commissions and finance all work for flats unchanged.
-- New money amounts are bigint paise (CLAUDE.md rule 2); the older rupee columns are untouched.
-- Additive only. Rollback: supabase/rollbacks/20261102000000_apartments.down.sql

-- 1. Project type and apartment pricing
alter table public.projects add column kind text not null default 'plots' check (kind in ('plots', 'apartments'));
alter table public.projects add column rera_no text;
alter table public.projects add column floor_rise_paise bigint not null default 0 check (floor_rise_paise >= 0);  -- per sq ft, per floor
alter table public.projects add column floor_rise_from int not null default 1;                                     -- floors above this one pay it
alter table public.projects add column parking_paise bigint not null default 0 check (parking_paise >= 0);        -- per car park
alter table public.projects add column gst_bp int not null default 500 check (gst_bp between 0 and 2800);         -- shown to buyers, 500 = 5%

-- 2. Towers and unit types
create table public.towers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 20),
  floors int not null check (floors between 1 and 120),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create index on public.towers (org_id);
create index on public.towers (project_id);

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),   -- e.g. "2 BHK East"
  bedrooms int check (bedrooms between 0 and 10),
  carpet_sqft numeric(10,2) not null default 0,
  builtup_sqft numeric(10,2) not null default 0,
  saleable_sqft numeric(10,2) not null check (saleable_sqft > 0),        -- price is on this area
  plan_path text,                                                       -- floor plan picture in the layouts bucket
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
create index on public.unit_types (org_id);
create index on public.unit_types (project_id);

alter table public.towers enable row level security;
alter table public.unit_types enable row level security;
create policy "members read towers" on public.towers for select using (org_id = (select public.my_org()));
create policy "members read unit types" on public.unit_types for select using (org_id = (select public.my_org()));

-- 3. Units are plots with a tower, floor and type
alter table public.plots add column tower_id uuid references public.towers on delete cascade;
alter table public.plots add column floor int;
alter table public.plots add column unit_type_id uuid references public.unit_types on delete set null;
alter table public.plots add column plc_paise bigint not null default 0 check (plc_paise >= 0);     -- preferred location charge
alter table public.plots add column parking_slots int not null default 0 check (parking_slots between 0 and 5);
create index on public.plots (tower_id);

-- 4. Price of a unit = saleable area × rate + floor rise + preferred location charge + car parking (GST on top, shown apart)
create or replace function public._value(pl public.plots) returns numeric
language sql stable security definer set search_path = public as $$
  select pl.sqft * coalesce(pl.rate_override, p.sale_rate)
    + case when p.kind = 'apartments' then
        (greatest(coalesce(pl.floor, 0) - p.floor_rise_from, 0) * p.floor_rise_paise * pl.sqft
         + pl.plc_paise + pl.parking_slots * p.parking_paise) / 100.0
      else 0 end
  from projects p where p.id = pl.project_id
$$;

-- 5. Create an apartment project from towers and a typical floor
--   p:        {name, location, lat, lng, approval, launched, guideline_rate, sale_rate, rera_no,
--              floor_rise_paise, floor_rise_from, parking_paise, gst_bp}
--   p_types:  [{key, name, bedrooms, carpet_sqft, builtup_sqft, saleable_sqft}]
--   p_towers: [{name, floors, first_floor, stack: [{suffix, type, facing, plc_paise, parking}]}]
--             one stack entry per flat on a typical floor; flat numbers are <tower>-<floor><suffix>, e.g. A-1203
create or replace function public.create_apartment_project(p jsonb, p_types jsonb, p_towers jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := my_org(); v_id uuid; v_tower uuid; t jsonb; s jsonb; ty jsonb; v_types jsonb := '{}'::jsonb;
  v_type uuid; v_sqft numeric; v_first int; v_floors int; f int; v_n int := 0; v_sort int := 0;
begin
  perform _assert_role(array['owner']::user_role[]);
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Give the project a name'; end if;
  if jsonb_typeof(p_types) <> 'array' or jsonb_array_length(p_types) = 0 then raise exception 'Add at least one unit type'; end if;
  if jsonb_typeof(p_towers) <> 'array' or jsonb_array_length(p_towers) = 0 then raise exception 'Add at least one tower'; end if;

  insert into projects (org_id, kind, name, location, lat, lng, approval, launched, guideline_rate, sale_rate, layout,
    rera_no, floor_rise_paise, floor_rise_from, parking_paise, gst_bp, rate_updated_by, rate_updated_at)
  values (v_org, 'apartments', trim(p ->> 'name'), coalesce(p ->> 'location', ''), (p ->> 'lat')::float8, (p ->> 'lng')::float8,
    nullif(p ->> 'approval', ''), nullif(p ->> 'launched', ''),
    coalesce((p ->> 'guideline_rate')::numeric, 0), coalesce((p ->> 'sale_rate')::numeric, 0), '{}'::jsonb,
    nullif(trim(p ->> 'rera_no'), ''), coalesce((p ->> 'floor_rise_paise')::bigint, 0), coalesce((p ->> 'floor_rise_from')::int, 1),
    coalesce((p ->> 'parking_paise')::bigint, 0), coalesce((p ->> 'gst_bp')::int, 500), auth.uid(), now())
  returning id into v_id;
  insert into project_funding (project_id, org_id) values (v_id, v_org);

  for ty in select * from jsonb_array_elements(p_types) loop
    if coalesce((ty ->> 'saleable_sqft')::numeric, 0) <= 0 then raise exception 'Unit type % needs a saleable area', ty ->> 'name'; end if;
    v_sort := v_sort + 1;
    insert into unit_types (org_id, project_id, name, bedrooms, carpet_sqft, builtup_sqft, saleable_sqft, sort)
    values (v_org, v_id, trim(ty ->> 'name'), (ty ->> 'bedrooms')::int, coalesce((ty ->> 'carpet_sqft')::numeric, 0),
      coalesce((ty ->> 'builtup_sqft')::numeric, 0), (ty ->> 'saleable_sqft')::numeric, v_sort)
    returning id into v_type;
    v_types := v_types || jsonb_build_object(coalesce(ty ->> 'key', ty ->> 'name'), v_type);
  end loop;

  v_sort := 0;
  for t in select * from jsonb_array_elements(p_towers) loop
    v_first := coalesce((t ->> 'first_floor')::int, 1);
    v_floors := (t ->> 'floors')::int;
    if v_floors is null or v_floors < 1 or v_floors > 120 then raise exception 'Tower % needs 1 to 120 floors', t ->> 'name'; end if;
    if jsonb_typeof(t -> 'stack') <> 'array' or jsonb_array_length(t -> 'stack') not between 1 and 30 then
      raise exception 'Tower % needs 1 to 30 flats per floor', t ->> 'name';
    end if;
    v_sort := v_sort + 1;
    insert into towers (org_id, project_id, name, floors, sort) values (v_org, v_id, upper(trim(t ->> 'name')), v_floors, v_sort)
    returning id into v_tower;
    for f in v_first .. v_first + v_floors - 1 loop
      for s in select * from jsonb_array_elements(t -> 'stack') loop
        v_type := (v_types ->> (s ->> 'type'))::uuid;
        if v_type is null then raise exception 'Unknown unit type % in tower %', s ->> 'type', t ->> 'name'; end if;
        select saleable_sqft into v_sqft from unit_types where id = v_type;
        insert into plots (project_id, org_id, label, geom, front_ft, depth_ft, sqft, facing,
          tower_id, floor, unit_type_id, plc_paise, parking_slots)
        values (v_id, v_org,
          upper(trim(t ->> 'name')) || '-' || case when f = 0 then 'G' else f::text end || coalesce(s ->> 'suffix', lpad(v_n::text, 2, '0')),
          '{}'::jsonb, 0, 0, v_sqft,
          coalesce(array(select jsonb_array_elements_text(s -> 'facing')), '{}'),
          v_tower, f, v_type, coalesce((s ->> 'plc_paise')::bigint, 0), coalesce((s ->> 'parking')::int, 0));
        v_n := v_n + 1;
        if v_n > 3000 then raise exception 'A project can have up to 3,000 flats'; end if;
      end loop;
    end loop;
  end loop;
  return v_id;
end $$;

-- 6. Change one flat's type, preferred location charge or car parks (owner); keeps the price above what was paid
create or replace function public.update_unit(p_plot uuid, p_type uuid, p_plc_paise bigint, p_parking int) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; v_sqft numeric;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() and tower_id is not null for update;
  if not found then raise exception 'Flat not found'; end if;
  if p_type is not null then
    select saleable_sqft into v_sqft from unit_types where id = p_type and project_id = pl.project_id;
    if v_sqft is null then raise exception 'That unit type is not part of this project'; end if;
  end if;
  update plots set unit_type_id = coalesce(p_type, unit_type_id), sqft = coalesce(v_sqft, sqft),
    plc_paise = greatest(coalesce(p_plc_paise, plc_paise), 0), parking_slots = least(greatest(coalesce(p_parking, parking_slots), 0), 5),
    updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  if pl.paid > _value(pl) then raise exception 'The customer has already paid more than the new total of %', _inr(_value(pl)); end if;
  perform _event(pl, format('Flat details updated, total %s', _inr(_value(pl))));
  return pl;
end $$;

-- 7. Floor plan picture for a unit type (uploaded by the owner to the layouts bucket first)
create or replace function public.set_unit_type_plan(p_type uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner']::user_role[]);
  if p_path is not null and not p_path like my_org()::text || '/%' then raise exception 'Floor plan file not found'; end if;
  update unit_types set plan_path = p_path where id = p_type and org_id = my_org();
  if not found then raise exception 'Unit type not found'; end if;
end $$;

-- 8. Plot layouts and apartment towers are edited differently: save_layout refuses apartment projects.
--    Same body as 20261030000000_save_layout_lock_plots.sql plus that check.
create or replace function public.save_layout(p_project uuid, p_layout jsonb, p_plots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pr projects; r record; v_blocked text; v_n int := 0; v_keep uuid[];
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pr from projects where id = p_project and org_id = my_org() for update;
  if not found then raise exception 'Project not found'; end if;
  if pr.kind = 'apartments' then raise exception 'Apartment projects are set up by towers and floors, not a layout drawing'; end if;
  if jsonb_typeof(p_plots) <> 'array' then raise exception 'Plot list is missing'; end if;

  perform 1 from plots where project_id = p_project order by id for update;

  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_keep
  from jsonb_array_elements(p_plots) x where x ->> 'id' is not null;

  select string_agg(label, ', ' order by label) into v_blocked from plots
  where project_id = p_project and status <> 'available' and id <> all (v_keep);
  if v_blocked is not null then
    raise exception 'Plots % have customers, so they cannot be removed from the layout', v_blocked;
  end if;

  delete from plots where project_id = p_project and status = 'available' and id <> all (v_keep);
  if exists (select 1 from plots where project_id = p_project and id <> all (v_keep)) then
    raise exception 'A plot was booked while the layout was being saved. Reload the layout and save again.';
  end if;

  update plots set label = '~' || id::text where project_id = p_project;

  begin
    for r in select * from jsonb_to_recordset(p_plots)
      as x(id uuid, label text, geom jsonb, front_ft numeric, depth_ft numeric, sqft numeric, facing text[])
    loop
      if coalesce(trim(r.label), '') = '' then raise exception 'Every plot needs a number'; end if;
      if r.id is not null then
        update plots set label = trim(r.label), geom = r.geom, front_ft = r.front_ft, depth_ft = r.depth_ft,
          sqft = r.sqft, facing = r.facing, updated_at = now(), updated_by = auth.uid()
        where id = r.id and project_id = p_project;
        if not found then raise exception 'Plot % is not part of this project', r.label; end if;
      else
        insert into plots (project_id, org_id, label, geom, front_ft, depth_ft, sqft, facing, updated_by)
        values (p_project, pr.org_id, trim(r.label), r.geom, r.front_ft, r.depth_ft, r.sqft, r.facing, auth.uid());
      end if;
      v_n := v_n + 1;
    end loop;
  exception when unique_violation then
    raise exception 'Two plots have the same number. Give each plot its own number and save again.';
  end;

  update projects set layout = p_layout where id = p_project;

  insert into notifications (org_id, recipient, actor, kind, text)
  select pr.org_id, id, auth.uid(), 'layout', format('Owner updated the layout of %s (%s plots)', pr.name, v_n)
  from profiles where org_id = pr.org_id and active and id is distinct from auth.uid();
  return v_n;
end $$;

-- 9. Reminders and the owner summary use the same price as everything else (flats include floor rise and parking).
--    Same bodies as 20261023000000_init.sql and 20261101000000_whatsapp_team_alerts.sql, with _value(pl).
create or replace function public.run_daily_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_today date; v_days int; v_n int := 0; v_rows int;
begin
  for r in
    select pl.id, pl.org_id, pl.reg_date, pl.registered, pl.due_date, o.reg_days, o.pay_days, o.timezone,
      _value(pl) - pl.paid as balance
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
                 greatest(_value(pl) - pl.paid, 0) as bal
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

revoke execute on function public.run_owner_summaries() from public, anon, authenticated;
