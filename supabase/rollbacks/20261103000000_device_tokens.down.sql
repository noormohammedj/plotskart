-- Undo 20261103000000_device_tokens.sql: the app writes its own tokens again, and the company column goes.
-- Tokens themselves are kept.
drop function if exists public.register_device(text, text);
drop function if exists public.unregister_device(text);
drop policy if exists "see own devices" on public.device_tokens;
grant insert, update, delete on public.device_tokens to authenticated;
create policy "manage own devices" on public.device_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop index if exists public.device_tokens_user_id_idx;
drop index if exists public.device_tokens_org_id_idx;
alter table public.device_tokens drop column if exists org_id;
