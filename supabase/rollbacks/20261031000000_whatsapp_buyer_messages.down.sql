-- Undo 20261031000000_whatsapp_buyer_messages.sql.
-- Dropping the columns loses each buyer's WhatsApp consent and the delivery receipts; only roll back if you must.
drop function if exists public.whatsapp_opt_out(text);
drop function if exists public.set_buyer_whatsapp(uuid, boolean);
drop function if exists public.book_plot(uuid, text, text, numeric, date, date, uuid, boolean);
drop function if exists public.sell_plot(uuid, numeric, date, text, text, uuid, boolean);
drop trigger if exists plots_reset_buyer_whatsapp on public.plots;
drop function if exists public._reset_buyer_whatsapp();

-- restore the previous definitions (20261026000000_commission_activity_demo.sql and 20261023000000_init.sql)
create or replace function public._queue_message(pl public.plots, p_kind text, p_body text, p_template text, p_params jsonb) returns void
language sql security definer set search_path = public as $$
  insert into customer_messages (org_id, plot_id, to_name, to_phone, kind, body, template, params, whatsapp_status, sms_status)
  select pl.org_id, pl.id, pl.buyer_name, pl.buyer_phone, p_kind, p_body, p_template, p_params,
    case when o.is_demo then 'demo, not sent' else 'queued' end,
    case when o.is_demo then 'demo, not sent' else 'queued' end
  from orgs o where o.id = pl.org_id and pl.buyer_phone is not null
$$;

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
    jsonb_build_array(pl.buyer_name, pl.label, pr.name, _inr(pl.paid), _inr(_value(pl) - pl.paid), coalesce(_d(pl.due_date), '-')));
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
    params := jsonb_build_array(pl.buyer_name, pl.label, pr.name, _d(pl.reg_date), _inr(v_bal));
  else
    team := format('Payment %s: %s owes %s on %s · %s.', case when p_days < 0 then v_when else 'due ' || v_when end,
      pl.buyer_name, _inr(v_bal), pl.label, pr.name);
    cust := format('Dear %s, a reminder that the balance of %s for plot %s at %s %s %s. Please contact us to complete the payment. – %s',
      pl.buyer_name, _inr(v_bal), pl.label, pr.name, case when p_days < 0 then 'was due on' else 'is due on' end, _d(pl.due_date), v_org);
    template := 'payment_reminder';
    params := jsonb_build_array(pl.buyer_name, _inr(v_bal), pl.label, pr.name, _d(pl.due_date));
  end if;
end $$;

drop index if exists public.customer_messages_wa_message_id_idx;
drop index if exists public.customer_messages_wa_to_idx;
alter table public.customer_messages drop column if exists wa_status_at;
alter table public.customer_messages drop column if exists wa_message_id;
alter table public.customer_messages drop column if exists wa_to;
alter table public.plots drop column if exists buyer_whatsapp;
