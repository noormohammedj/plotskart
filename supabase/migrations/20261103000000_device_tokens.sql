-- Phone push tokens follow the house rules (MOBILE-STATUS.md B5):
--   1. each token belongs to a company (org_id), indexed, readable only by its own person in that company;
--   2. the app no longer writes the table directly: register_device / unregister_device do it.
-- Existing tokens keep working; their company is filled in from the owner of the token.

alter table public.device_tokens add column if not exists org_id uuid references public.orgs on delete cascade;
update public.device_tokens d set org_id = p.org_id from public.profiles p where p.id = d.user_id and d.org_id is null;
create index if not exists device_tokens_org_id_idx on public.device_tokens (org_id);
create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

drop policy if exists "manage own devices" on public.device_tokens;
create policy "see own devices" on public.device_tokens for select
  using (user_id = (select auth.uid()) and org_id = (select public.my_org()));
revoke insert, update, delete on public.device_tokens from authenticated, anon;

-- This phone now gets this person's alerts. A phone that changes hands (one person signs out, another signs in)
-- moves to the new person, so alerts never reach the previous owner of the phone.
create or replace function public.register_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_org() is null then raise exception 'Sign in to get alerts on this phone'; end if;
  if p_platform not in ('android', 'ios') then raise exception 'Alerts are for the Android and iPhone apps'; end if;
  if p_token is null or length(p_token) not between 20 and 4096 then raise exception 'This phone''s alert code is not valid'; end if;
  insert into device_tokens (token, user_id, org_id, platform, updated_at)
  values (p_token, auth.uid(), my_org(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, org_id = excluded.org_id, platform = excluded.platform, updated_at = now();
end $$;

-- Signing out: this phone stops getting this person's alerts.
create or replace function public.unregister_device(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from device_tokens where token = p_token and user_id = auth.uid();
end $$;

revoke execute on function public.register_device(text, text) from public, anon;
revoke execute on function public.unregister_device(text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;
grant execute on function public.unregister_device(text) to authenticated;
