-- Monthly sales targets for the team race: how many plots or flats each salesperson or broker should sell
-- this month, and for how much. Everyone in the company can see every target (the race is open); only the
-- owner sets them. Money in paise (bigint), per the house rules.

create table public.sales_targets (
  org_id uuid not null references public.orgs on delete cascade,
  member_id uuid not null references public.profiles on delete cascade,
  -- first day of the month
  month date not null check (extract(day from month) = 1),
  units int not null default 0 check (units >= 0),
  value_paise bigint not null default 0 check (value_paise >= 0),
  set_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, month)
);
create index sales_targets_org_id_idx on public.sales_targets (org_id, month);
alter table public.sales_targets enable row level security;
create policy "company sees targets" on public.sales_targets for select
  using (org_id = (select public.my_org()));
revoke insert, update, delete on public.sales_targets from authenticated, anon;

-- Owner sets (or clears, with 0 and 0) a member's target for a month.
create or replace function public.set_sales_target(p_member uuid, p_month date, p_units int, p_value_paise bigint)
returns public.sales_targets
language plpgsql security definer set search_path = public as $$
declare t sales_targets; v_month date := date_trunc('month', p_month)::date;
begin
  perform _assert_role(array['owner']::user_role[]);
  if not exists (select 1 from profiles where id = p_member and org_id = my_org() and role in ('sales', 'broker')) then
    raise exception 'Targets are for salespeople and brokers in your company';
  end if;
  if coalesce(p_units, 0) < 0 or coalesce(p_value_paise, 0) < 0 then raise exception 'A target cannot be negative'; end if;
  insert into sales_targets (org_id, member_id, month, units, value_paise, set_by, updated_at)
  values (my_org(), p_member, v_month, coalesce(p_units, 0), coalesce(p_value_paise, 0), auth.uid(), now())
  on conflict (member_id, month) do update
    set units = excluded.units, value_paise = excluded.value_paise, set_by = excluded.set_by, updated_at = now()
  returning * into t;
  return t;
end $$;

revoke execute on function public.set_sales_target(uuid, date, int, bigint) from public, anon;
grant execute on function public.set_sales_target(uuid, date, int, bigint) to authenticated;
