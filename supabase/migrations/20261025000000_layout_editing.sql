-- Layout pictures (photo or PDF page of the layout drawing) and owner layout editing.

-- Private bucket; files live under <org_id>/... so each company only reaches its own.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('layouts', 'layouts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members read their layouts" on storage.objects for select to authenticated
  using (bucket_id = 'layouts' and (storage.foldername(name))[1] = public.my_org()::text);
create policy "owner uploads layouts" on storage.objects for insert to authenticated
  with check (bucket_id = 'layouts' and (storage.foldername(name))[1] = public.my_org()::text and public.my_role() = 'owner');
create policy "owner removes layouts" on storage.objects for delete to authenticated
  using (bucket_id = 'layouts' and (storage.foldername(name))[1] = public.my_org()::text and public.my_role() = 'owner');

-- Replaces a project's drawing and plot list in one step.
-- p_plots: [{id?, label, geom, front_ft, depth_ft, sqft, facing}]. Rows with an id update that plot
-- (customer, payments and status are kept); rows without one are new plots. Plots left out are
-- removed, which is refused for plots that already have a customer.
create or replace function public.save_layout(p_project uuid, p_layout jsonb, p_plots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pr projects; r record; v_blocked text; v_n int := 0;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pr from projects where id = p_project and org_id = my_org() for update;
  if not found then raise exception 'Project not found'; end if;
  if jsonb_typeof(p_plots) <> 'array' then raise exception 'Plot list is missing'; end if;

  select string_agg(label, ', ' order by label) into v_blocked from plots
  where project_id = p_project and status <> 'available'
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_plots) x where x ->> 'id' is not null);
  if v_blocked is not null then
    raise exception 'Plots % have customers, so they cannot be removed from the layout', v_blocked;
  end if;

  delete from plots where project_id = p_project
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_plots) x where x ->> 'id' is not null);

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
