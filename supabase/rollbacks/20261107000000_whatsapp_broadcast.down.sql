-- Undo 20261107000000_whatsapp_broadcast.sql: contacts and broadcasts go; messages already sent stay in
-- customer_messages without their broadcast link; STOP handling returns to buyers and team only.
create or replace function public.whatsapp_opt_out(p_wa_to text) returns int
language sql security definer set search_path = public as $$
  with p as (
    update plots set buyer_whatsapp = false, updated_at = now()
    where buyer_whatsapp and id in (select plot_id from customer_messages where wa_to = p_wa_to and plot_id is not null)
    returning id
  ), t as (
    update profiles set whatsapp_alerts = false, whatsapp_summary = false
    where (whatsapp_alerts or whatsapp_summary) and id in (select recipient from team_messages where wa_to = p_wa_to)
    returning id
  ) select ((select count(*) from p) + (select count(*) from t))::int
$$;
revoke execute on function public.whatsapp_opt_out(text) from public, anon, authenticated;
drop function if exists public.send_broadcast(uuid, uuid[]);
drop function if exists public.import_buyers();
drop function if exists public.delete_contact(uuid);
drop function if exists public.save_contact(uuid, jsonb);
alter table public.customer_messages drop column if exists contact_id;
alter table public.customer_messages drop column if exists broadcast_id;
drop table if exists public.broadcasts;
drop table if exists public.contacts;
drop function if exists public._wa_number(text);
