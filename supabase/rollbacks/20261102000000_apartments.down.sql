-- Undo 20261102000000_apartments.sql.
-- Deletes every apartment project first (their flats, bookings and payments with them), then the new columns and tables.
-- Only roll back if no real apartment projects exist yet.
delete from projects where kind = 'apartments';
drop function if exists public.set_unit_type_plan(uuid, text);
drop function if exists public.update_unit(uuid, uuid, bigint, int);
drop function if exists public.create_apartment_project(jsonb, jsonb, jsonb);

-- restore the previous definitions
create or replace function public._value(pl public.plots) returns numeric
language sql stable security definer set search_path = public as $$
  select pl.sqft * coalesce(pl.rate_override, p.sale_rate) from projects p where p.id = pl.project_id
$$;

create or replace function public.save_layout(p_project uuid, p_layout jsonb, p_plots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pr projects; r record; v_blocked text; v_n int := 0; v_keep uuid[];
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pr from projects where id = p_project and org_id = my_org() for update;
  if not found then raise exception 'Project not found'; end if;
  if jsonb_typeof(p_plots) <> 'array' then raise exception 'Plot list is missing'; end if;

  -- lock the project's plots (in id order, so two saves never deadlock) before reading their status
  perform 1 from plots where project_id = p_project order by id for update;

  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_keep
  from jsonb_array_elements(p_plots) x where x ->> 'id' is not null;

  select string_agg(label, ', ' order by label) into v_blocked from plots
  where project_id = p_project and status <> 'available' and id <> all (v_keep);
  if v_blocked is not null then
    raise exception 'Plots % have customers, so they cannot be removed from the layout', v_blocked;
  end if;

  -- only available plots are ever deleted, whatever happens above
  delete from plots where project_id = p_project and status = 'available' and id <> all (v_keep);
  if exists (select 1 from plots where project_id = p_project and id <> all (v_keep)) then
    raise exception 'A plot was booked while the layout was being saved. Reload the layout and save again.';
  end if;

  -- park current labels so plots can swap numbers without tripping the unique constraint
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

revoke execute on function public.run_owner_summaries() from public, anon, authenticated;
alter table public.plots drop column if exists parking_slots;
alter table public.plots drop column if exists plc_paise;
alter table public.plots drop column if exists unit_type_id;
alter table public.plots drop column if exists floor;
alter table public.plots drop column if exists tower_id;
drop table if exists public.unit_types;
drop table if exists public.towers;
alter table public.projects drop column if exists gst_bp;
alter table public.projects drop column if exists parking_paise;
alter table public.projects drop column if exists floor_rise_from;
alter table public.projects drop column if exists floor_rise_paise;
alter table public.projects drop column if exists rera_no;
alter table public.projects drop column if exists kind;
