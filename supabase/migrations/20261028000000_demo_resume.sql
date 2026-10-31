-- A returning visitor gets their existing demo company back instead of a new one, so opening the
-- demo from several role cards or tabs no longer uses up the daily limit. The browser keeps a random
-- key; only its hash is stored here.
create table public.demo_resume (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.demo_resume enable row level security; -- no policies: service role only

-- Visitors behind one mobile-carrier or office address share it, so the per-address limit is higher.
-- 30 new demo companies per address per day, 1,000 in total per day.
create or replace function public.demo_allow_start(p_ip text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from demo_starts where created_at < now() - interval '1 day';
  if (select count(*) from demo_starts where ip = p_ip) >= 30 or (select count(*) from demo_starts) >= 1000 then
    return false;
  end if;
  insert into demo_starts (ip) values (p_ip);
  return true;
end $$;
revoke execute on function public.demo_allow_start from public, anon, authenticated;
