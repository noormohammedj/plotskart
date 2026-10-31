-- save_layout: lock every plot of the project before checking which ones have customers.
-- Before, the check was a plain read and the delete didn't repeat it, so a plot booked between the two
-- (by a salesperson at the same moment) was deleted together with its payments and history.
-- Now the plots are locked first (booking waits, or save_layout waits for the booking), the delete only
-- ever removes available plots, and the save is refused if a plot with a customer would be left out.
-- Rollback: supabase/rollbacks/20261030000000_save_layout_lock_plots.down.sql
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
