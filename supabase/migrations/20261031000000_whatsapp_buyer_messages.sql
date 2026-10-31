-- WhatsApp buyer messages: consent, the developer's name in every message, and delivery receipts.
-- Additive only: new columns, a trigger, and new function versions next to the old ones (old app versions keep working).
-- Rollback: supabase/rollbacks/20261031000000_whatsapp_buyer_messages.down.sql

-- 1. Consent. Meta requires the buyer to agree before we message them on WhatsApp. SMS is unaffected.
alter table public.plots add column buyer_whatsapp boolean not null default false;

-- a plot that becomes available again (booking cancelled, layout reset) forgets the old buyer's consent
create or replace function public._reset_buyer_whatsapp() returns trigger
language plpgsql as $$
begin
  if new.status = 'available' and old.status <> 'available' then new.buyer_whatsapp := false; end if;
  return new;
end $$;
create trigger plots_reset_buyer_whatsapp before update of status on public.plots
  for each row execute function public._reset_buyer_whatsapp();

-- 2. Delivery tracking, filled in by the deliver and whatsapp-webhook edge functions.
alter table public.customer_messages add column wa_to text;          -- number as sent to Meta (digits, country code)
alter table public.customer_messages add column wa_message_id text;  -- Meta's message id (wamid)
alter table public.customer_messages add column wa_status_at timestamptz;
create index on public.customer_messages (wa_message_id);
create index on public.customer_messages (wa_to);

-- 3. Only buyers who agreed get WhatsApp; demo companies never send anything.
create or replace function public._queue_message(pl public.plots, p_kind text, p_body text, p_template text, p_params jsonb) returns void
language sql security definer set search_path = public as $$
  insert into customer_messages (org_id, plot_id, to_name, to_phone, kind, body, template, params, whatsapp_status, sms_status)
  select pl.org_id, pl.id, pl.buyer_name, pl.buyer_phone, p_kind, p_body, p_template, p_params,
    case when o.is_demo then 'demo, not sent' when not pl.buyer_whatsapp then 'no consent' else 'queued' end,
    case when o.is_demo then 'demo, not sent' else 'queued' end
  from orgs o where o.id = pl.org_id and pl.buyer_phone is not null
$$;

-- 4. The developer's name is the last template variable ("– {{7}}" / "– {{6}}"), so one Plotskart number can
--    send for every company. Same body as 20261023000000_init.sql, params gain the company name.
create or replace function public.book_plot(p_plot uuid, p_buyer text, p_phone text, p_advance numeric, p_due date,
  p_reg date default null, p_sold_by uuid default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_by uuid; v_org_name text;
begin
  perform _assert_role(array['owner', 'sales', 'broker']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status <> 'available' then raise exception 'Plot % is already %', pl.label, pl.status; end if;
  if coalesce(trim(p_buyer), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Customer name and mobile number are required';
  end if;
  v_by := case when my_role() = 'broker' or p_sold_by is null then auth.uid() else p_sold_by end;
  perform _assert_member(v_by, pl.org_id);
  select * into pr from projects where id = pl.project_id;
  select name into v_org_name from orgs where id = pl.org_id;

  update plots set status = 'booked', buyer_name = trim(p_buyer), buyer_phone = trim(p_phone),
    paid = least(greatest(coalesce(p_advance, 0), 0), _value(pl)), due_date = p_due, reg_date = p_reg,
    registered = false, sold_by = v_by, updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;

  if pl.paid > 0 then
    insert into customer_payments (plot_id, org_id, amount, recorded_by) values (pl.id, pl.org_id, pl.paid, auth.uid());
  end if;
  perform _event(pl, format('Booked for %s, advance %s', pl.buyer_name, _inr(pl.paid)));
  perform _notify_org(pl, 'booked', format('%s booked %s · %s for %s (advance %s)', _actor_name(), pl.label, pr.name, pl.buyer_name, _inr(pl.paid)));
  perform _queue_message(pl, 'booking',
    format('Dear %s, thank you for booking plot %s at %s. Advance received: %s. Balance %s is due by %s. – %s',
      pl.buyer_name, pl.label, pr.name, _inr(pl.paid), _inr(_value(pl) - pl.paid), coalesce(_d(pl.due_date), 'the agreed date'), v_org_name),
    'booking_confirmation',
    jsonb_build_array(pl.buyer_name, pl.label, pr.name, _inr(pl.paid), _inr(_value(pl) - pl.paid), coalesce(_d(pl.due_date), '-'), v_org_name));
  return pl;
end $$;

create or replace function public._reminder_texts(pl public.plots, p_kind text, p_days int,
  out team text, out cust text, out template text, out params jsonb)
language plpgsql stable security definer set search_path = public as $$
declare pr projects; v_bal numeric; v_org text; v_when text;
begin
  select * into pr from projects where id = pl.project_id;
  select name into v_org from orgs where id = pl.org_id;
  v_bal := greatest(_value(pl) - pl.paid, 0);
  v_when := case when p_days < 0 then format('overdue by %s day(s)', -p_days)
                 when p_days = 0 then 'today' when p_days = 1 then 'tomorrow' else format('in %s days', p_days) end;
  if p_kind = 'reg' then
    team := format('Registration %s: %s · %s for %s on %s. Prepare sale deed draft, stamp duty challan and ID copies.%s',
      v_when, pl.label, pr.name, pl.buyer_name, _d(pl.reg_date),
      case when v_bal > 0 then format(' Balance %s still to collect.', _inr(v_bal)) else '' end);
    cust := format('Dear %s, registration of plot %s at %s is scheduled on %s at the Sub-Registrar office. Please bring Aadhaar, PAN, 2 passport photos%s. – %s',
      pl.buyer_name, pl.label, pr.name, _d(pl.reg_date),
      case when v_bal > 0 then format(' and the balance of %s', _inr(v_bal)) else '' end, v_org);
    template := 'registration_reminder';
    params := jsonb_build_array(pl.buyer_name, pl.label, pr.name, _d(pl.reg_date), _inr(v_bal), v_org);
  else
    team := format('Payment %s: %s owes %s on %s · %s.', case when p_days < 0 then v_when else 'due ' || v_when end,
      pl.buyer_name, _inr(v_bal), pl.label, pr.name);
    cust := format('Dear %s, a reminder that the balance of %s for plot %s at %s %s %s. Please contact us to complete the payment. – %s',
      pl.buyer_name, _inr(v_bal), pl.label, pr.name, case when p_days < 0 then 'was due on' else 'is due on' end, _d(pl.due_date), v_org);
    template := 'payment_reminder';
    params := jsonb_build_array(pl.buyer_name, _inr(v_bal), pl.label, pr.name, _d(pl.due_date), v_org);
  end if;
end $$;

-- 5. New versions that also take the buyer's WhatsApp consent. p_whatsapp has no default, so calls without it
--    still reach the original functions. Consent is set on the still-available plot first, inside the same
--    transaction, so the booking confirmation is queued with it; if the booking fails, nothing is kept.
create or replace function public.book_plot(p_plot uuid, p_buyer text, p_phone text, p_advance numeric, p_due date,
  p_reg date, p_sold_by uuid, p_whatsapp boolean) returns public.plots
language plpgsql security definer set search_path = public as $$
begin
  update plots set buyer_whatsapp = coalesce(p_whatsapp, false)
  where id = p_plot and org_id = my_org() and status = 'available';
  return public.book_plot(p_plot, p_buyer, p_phone, p_advance, p_due, p_reg, p_sold_by);
end $$;

create or replace function public.sell_plot(p_plot uuid, p_amount numeric, p_reg date,
  p_buyer text, p_phone text, p_sold_by uuid, p_whatsapp boolean) returns public.plots
language plpgsql security definer set search_path = public as $$
begin
  update plots set buyer_whatsapp = coalesce(p_whatsapp, false)
  where id = p_plot and org_id = my_org() and status = 'available';
  return public.sell_plot(p_plot, p_amount, p_reg, p_buyer, p_phone, p_sold_by);
end $$;

-- Change consent later (the buyer agrees on the phone, or asks to stop).
create or replace function public.set_buyer_whatsapp(p_plot uuid, p_ok boolean) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status = 'available' then raise exception 'This plot has no customer yet'; end if;
  update plots set buyer_whatsapp = coalesce(p_ok, false), updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  perform _event(pl, case when pl.buyer_whatsapp then 'Customer agreed to WhatsApp updates' else 'WhatsApp updates switched off for the customer' end);
  return pl;
end $$;

-- Called by the whatsapp-webhook function (service role) when a buyer replies STOP.
create or replace function public.whatsapp_opt_out(p_wa_to text) returns int
language sql security definer set search_path = public as $$
  with p as (
    update plots set buyer_whatsapp = false, updated_at = now()
    where buyer_whatsapp and id in (select plot_id from customer_messages where wa_to = p_wa_to and plot_id is not null)
    returning id
  ) select count(*)::int from p
$$;
revoke execute on function public.whatsapp_opt_out(text), public._reset_buyer_whatsapp() from public, anon, authenticated;
