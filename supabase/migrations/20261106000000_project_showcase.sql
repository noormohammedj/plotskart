-- Customer showcase for each project: what sales staff and brokers show a buyer.
--   project_showcase      one row per project: a one-line pitch, amenities, and an optional growth rate override
--   project_price_points  land rate per sq ft in past years (paise), for the "price then, now, next" chart
--   project_developments  what is coming nearby (metro, IT park, highway...), with distance and expected year
-- The whole company can read them; only the owner changes them, through save_showcase().

create table public.project_showcase (
  project_id uuid primary key references public.projects on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  tagline text not null default '' check (length(tagline) <= 160),
  amenities text[] not null default '{}',
  -- yearly growth used for projections, in basis points (850 = 8.5%); null = work it out from the price history
  growth_bp int check (growth_bp between -2000 and 5000),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);
create index project_showcase_org_id_idx on public.project_showcase (org_id);

create table public.project_price_points (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  year int not null check (year between 1980 and 2100),
  rate_paise bigint not null check (rate_paise > 0),
  note text check (length(note) <= 120),
  unique (project_id, year)
);
create index project_price_points_org_id_idx on public.project_price_points (org_id);

create table public.project_developments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default 'other' check (kind in ('transport', 'it_park', 'industry', 'education', 'health', 'retail', 'road', 'government', 'other')),
  -- distance from the site in metres
  distance_m int check (distance_m between 0 and 200000),
  expected_year int check (expected_year between 1980 and 2100),
  note text check (length(note) <= 200),
  sort int not null default 0
);
create index project_developments_org_id_idx on public.project_developments (org_id);
create index project_developments_project_idx on public.project_developments (project_id, sort);

alter table public.project_showcase enable row level security;
alter table public.project_price_points enable row level security;
alter table public.project_developments enable row level security;
create policy "company sees showcase" on public.project_showcase for select using (org_id = (select public.my_org()));
create policy "company sees price points" on public.project_price_points for select using (org_id = (select public.my_org()));
create policy "company sees developments" on public.project_developments for select using (org_id = (select public.my_org()));
revoke insert, update, delete on public.project_showcase, public.project_price_points, public.project_developments from authenticated, anon;

-- Owner saves the whole showcase of a project in one go: p = { tagline, amenities[], growth_bp,
--   prices: [{ year, rate_paise, note }], developments: [{ name, kind, distance_m, expected_year, note }] }
create or replace function public.save_showcase(p_project uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pr projects; r record; v_i int := 0;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pr from projects where id = p_project and org_id = my_org();
  if not found then raise exception 'Project not found'; end if;
  if jsonb_array_length(coalesce(p->'prices', '[]')) > 40 or jsonb_array_length(coalesce(p->'developments', '[]')) > 40
    or jsonb_array_length(coalesce(p->'amenities', '[]')) > 60 then
    raise exception 'Too many entries for one project';
  end if;

  insert into project_showcase (project_id, org_id, tagline, amenities, growth_bp, updated_by, updated_at)
  values (pr.id, pr.org_id, coalesce(trim(p->>'tagline'), ''),
    coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(p->'amenities', '[]')) x where trim(x) <> ''), '{}'),
    nullif(p->>'growth_bp', '')::int, auth.uid(), now())
  on conflict (project_id) do update set tagline = excluded.tagline, amenities = excluded.amenities,
    growth_bp = excluded.growth_bp, updated_by = excluded.updated_by, updated_at = now();

  delete from project_price_points where project_id = pr.id;
  begin
    for r in select * from jsonb_to_recordset(coalesce(p->'prices', '[]')) as x(year int, rate_paise bigint, note text) loop
      insert into project_price_points (org_id, project_id, year, rate_paise, note)
      values (pr.org_id, pr.id, r.year, r.rate_paise, nullif(trim(r.note), ''));
    end loop;
  exception when unique_violation then
    raise exception 'Each year can have only one price';
  end;

  delete from project_developments where project_id = pr.id;
  for r in select * from jsonb_to_recordset(coalesce(p->'developments', '[]'))
    as x(name text, kind text, distance_m int, expected_year int, note text) loop
    insert into project_developments (org_id, project_id, name, kind, distance_m, expected_year, note, sort)
    values (pr.org_id, pr.id, trim(r.name), coalesce(nullif(r.kind, ''), 'other'), r.distance_m, r.expected_year, nullif(trim(r.note), ''), v_i);
    v_i := v_i + 1;
  end loop;
end $$;

revoke execute on function public.save_showcase(uuid, jsonb) from public, anon;
grant execute on function public.save_showcase(uuid, jsonb) to authenticated;
