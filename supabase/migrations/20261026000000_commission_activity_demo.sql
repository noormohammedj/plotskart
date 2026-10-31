-- 1. Commission can be a % of the sale value or a fixed ₹ per sq ft, chosen per person by the owner.
-- 2. Team activity: every plot event records its kind and who handled the plot, so the team feed
--    and leaderboard can show who is booking and selling what.
-- 3. The owner can give a booked/sold customer their own price; everyone is told.
-- 4. Demo companies: sample data for visitors, never sending real WhatsApp/SMS, removed after 3 days.

-- ---------------------------------------------------------------- commission type

alter table public.profiles add column commission_type text not null default 'percent'
  check (commission_type in ('percent', 'per_sqft'));
alter table public.invites add column commission_type text not null default 'percent'
  check (commission_type in ('percent', 'per_sqft'));
alter table public.plots add column commission_type text
  check (commission_type in ('percent', 'per_sqft'));
-- ₹ per sq ft can be larger than a percentage
alter table public.profiles alter column commission_rate type numeric(10,2);
alter table public.invites alter column commission_rate type numeric(10,2);
alter table public.plots alter column commission_rate type numeric(10,2);

drop function public.update_member(uuid, numeric, boolean);
create function public.update_member(p_member uuid, p_rate numeric, p_active boolean, p_type text default 'percent') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner']::user_role[]);
  if p_member = auth.uid() then raise exception 'You cannot change your own account here'; end if;
  if p_type not in ('percent', 'per_sqft') then raise exception 'Unknown commission type'; end if;
  if p_rate < 0 or (p_type = 'percent' and p_rate > 100) then raise exception 'Enter a valid commission'; end if;
  update profiles set commission_rate = p_rate, commission_type = p_type, active = p_active
  where id = p_member and org_id = my_org();
end $$;

create or replace function public.claim_invite() returns boolean
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  select * into inv from invites
  where lower(email) = lower(auth.jwt() ->> 'email') and accepted_at is null
  order by created_at desc limit 1;
  if not found then return false; end if;
  update profiles set org_id = inv.org_id, role = inv.role, full_name = inv.full_name, phone = inv.phone,
    commission_rate = inv.commission_rate, commission_type = inv.commission_type, active = true
  where id = auth.uid() and org_id is null;
  update invites set accepted_at = now() where id = inv.id;
  return true;
end $$;

create or replace function public.sell_plot(p_plot uuid, p_amount numeric, p_reg date,
  p_buyer text default null, p_phone text default null, p_sold_by uuid default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_by uuid; v_rate numeric; v_type text; v_was plot_status;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status = 'sold' then raise exception 'Plot % is already sold', pl.label; end if;
  v_was := pl.status;
  if v_was = 'available' then
    if coalesce(trim(p_buyer), '') = '' or coalesce(trim(p_phone), '') = '' then
      raise exception 'Customer name and mobile number are required';
    end if;
    v_by := coalesce(p_sold_by, auth.uid());
    perform _assert_member(v_by, pl.org_id);
  else
    v_by := pl.sold_by;
  end if;
  -- the commission deal is frozen on the plot at the moment of sale
  select case when role = 'owner' then 0 else commission_rate end, commission_type into v_rate, v_type from profiles where id = v_by;
  select * into pr from projects where id = pl.project_id;

  update plots set status = 'sold',
    buyer_name = case when v_was = 'available' then trim(p_buyer) else buyer_name end,
    buyer_phone = case when v_was = 'available' then trim(p_phone) else buyer_phone end,
    sold_by = v_by, commission_rate = coalesce(v_rate, 0), commission_type = coalesce(v_type, 'percent'),
    paid = least(paid + greatest(coalesce(p_amount, 0), 0), _value(pl)),
    reg_date = p_reg, registered = false, updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;

  if coalesce(p_amount, 0) > 0 then
    insert into customer_payments (plot_id, org_id, amount, recorded_by) values (pl.id, pl.org_id, p_amount, auth.uid());
  end if;
  perform _event(pl, format('Marked sold, registration %s', coalesce(_d(pl.reg_date), 'not set')));
  perform _notify_org(pl, 'sold', format('%s marked %s · %s as Sold to %s. Registration on %s', _actor_name(), pl.label, pr.name, pl.buyer_name, coalesce(_d(pl.reg_date), 'not set')));
  return pl;
end $$;

-- ---------------------------------------------------------------- team activity

alter table public.plot_events add column kind text;
alter table public.plot_events add column member uuid references public.profiles on delete set null;
create index on public.plot_events (org_id, created_at desc);

-- every plot function logs through _event(); tag each entry with what happened and whose plot it is
create or replace function public._tag_plot_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.member is null then select sold_by into new.member from plots where id = new.plot_id; end if;
  if new.kind is null then
    new.kind := case
      when new.text like 'Booked%' then 'booked'
      when new.text like 'Marked sold%' then 'sold'
      when new.text like 'Payment received%' then 'payment'
      when new.text like 'Registration completed%' then 'registered'
      when new.text like 'Registration set%' then 'registration'
      when new.text like 'Booking by%' then 'cancelled'
      when new.text like 'Price%' or new.text like 'Customer price%' then 'price'
      else 'other' end;
  end if;
  return new;
end $$;
create trigger plot_events_tag before insert on public.plot_events
  for each row execute function public._tag_plot_event();

update public.plot_events e set member = p.sold_by from public.plots p where p.id = e.plot_id and e.member is null;
update public.plot_events set kind = case
  when text like 'Booked%' then 'booked' when text like 'Marked sold%' then 'sold'
  when text like 'Payment received%' then 'payment' when text like 'Registration completed%' then 'registered'
  when text like 'Registration set%' then 'registration' when text like 'Booking by%' then 'cancelled'
  when text like 'Price%' then 'price' else 'other' end
where kind is null;

-- ---------------------------------------------------------------- customer-specific price

-- Available plots: owner or sales set the asking price. Booked/sold plots: only the owner can give
-- that customer a different price; the whole team is told and balances follow.
create or replace function public.set_plot_rate(p_plot uuid, p_rate numeric) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_old numeric; v_new numeric;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found then raise exception 'Plot not found'; end if;
  if pl.status <> 'available' and my_role() <> 'owner' then
    raise exception 'Only the owner can change the price for a customer';
  end if;
  if p_rate is not null and p_rate < 0 then raise exception 'Enter a valid price'; end if;
  select * into pr from projects where id = pl.project_id;
  v_old := coalesce(pl.rate_override, pr.sale_rate);
  update plots set rate_override = nullif(p_rate, 0), updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  v_new := coalesce(pl.rate_override, pr.sale_rate);
  if pl.paid > _value(pl) then
    raise exception 'The customer has already paid more than the new total of %', _inr(_value(pl));
  end if;

  if pl.status = 'available' then
    perform _event(pl, case when pl.rate_override is null then 'Price reset to project rate'
      else format('Price set to %s/sq ft', _inr(v_new)) end);
    perform _notify_org(pl, 'rate', format('%s changed the price of %s · %s to %s/sq ft', _actor_name(), pl.label, pr.name, _inr(v_new)));
  else
    perform _event(pl, format('Customer price for %s changed from %s to %s/sq ft (total %s)',
      pl.buyer_name, _inr(v_old), _inr(v_new), _inr(_value(pl))));
    perform _notify_org(pl, 'rate', format('Owner changed the price of %s · %s for %s: %s → %s/sq ft. New total %s, balance %s',
      pl.label, pr.name, pl.buyer_name, _inr(v_old), _inr(v_new), _inr(_value(pl)), _inr(greatest(_value(pl) - pl.paid, 0))));
  end if;
  return pl;
end $$;

-- ---------------------------------------------------------------- demo companies

alter table public.orgs add column is_demo boolean not null default false;
alter table public.orgs add column ai_reads int not null default 0;
-- owners edit their company settings, never the demo flag or AI allowance
revoke update on public.orgs from authenticated, anon;
grant update (name, reg_days, pay_days, timezone) on public.orgs to authenticated;

-- no real messages or pushes ever leave a demo company (visitors may type anyone's number)
create or replace function public._queue_message(pl public.plots, p_kind text, p_body text, p_template text, p_params jsonb) returns void
language sql security definer set search_path = public as $$
  insert into customer_messages (org_id, plot_id, to_name, to_phone, kind, body, template, params, whatsapp_status, sms_status)
  select pl.org_id, pl.id, pl.buyer_name, pl.buyer_phone, p_kind, p_body, p_template, p_params,
    case when o.is_demo then 'demo, not sent' else 'queued' end,
    case when o.is_demo then 'demo, not sent' else 'queued' end
  from orgs o where o.id = pl.org_id and pl.buyer_phone is not null
$$;

create or replace function public._call_deliver() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_secret text;
begin
  if exists (select 1 from orgs where id = new.org_id and is_demo) then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'deliver_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'deliver_secret';
  if v_url is null then return new; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-deliver-secret', coalesce(v_secret, ''))
  );
  return new;
end $$;

-- Counts an automatic layout read against the company's allowance. Demo companies get 3.
create or replace function public.claim_ai_read() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  update orgs set ai_reads = ai_reads + 1
  where id = my_org() and (not is_demo or ai_reads < 3)
    -- across all demo companies, at most 30 reads a day
    and (not is_demo or (select count(*) from orgs d where d.is_demo and d.ai_reads > 0 and d.created_at > now() - interval '1 day') < 30)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Fills a demo project with believable sales history. Only works inside a demo company.
create or replace function public.demo_fill(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr projects; o orgs; pl plots; r float8; v numeric; v_by uuid; v_rev numeric; v_when timestamptz;
  buyers text[] := array['Arjun Deshmukh','Sneha Kulkarni','Imran Shaikh','Pooja Jadhav','Rahul Pawar','Kavita More','Vikram Patil','Ayesha Khan','Nitin Gaikwad','Meera Joshi','Sachin Bhosale','Farhan Siddiqui','Anjali Shinde','Prakash Wagh','Rekha Chavan','Deepak Kale'];
  sellers uuid[]; n int := 0;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into o from orgs where id = my_org();
  if not o.is_demo then raise exception 'Sample data can only be added to a demo company'; end if;
  select * into pr from projects where id = p_project and org_id = o.id;
  if not found then raise exception 'Project not found'; end if;
  select array_agg(id order by role desc, created_at) into sellers from profiles where org_id = o.id and active;

  for pl in select * from plots where project_id = pr.id and status = 'available' order by label loop
    r := random();
    n := n + 1;
    v := pl.sqft * coalesce(pl.rate_override, pr.sale_rate);
    v_by := sellers[1 + floor(random() * array_length(sellers, 1))::int];
    v_when := now() - (random() * interval '28 days');
    if r < 0.42 then
      update plots set status = 'sold', buyer_name = buyers[1 + floor(random() * 16)::int],
        buyer_phone = '+91 90000 ' || lpad((10000 + n)::text, 5, '0'), sold_by = v_by,
        paid = case when random() < 0.2 then round(v * 0.85, -4) else v end,
        reg_date = case when random() < 0.25 then current_date + (1 + floor(random() * 10))::int else current_date - (5 + floor(random() * 60))::int end,
        commission_rate = (select case when role = 'owner' then 0 else commission_rate end from profiles where id = v_by),
        commission_type = (select commission_type from profiles where id = v_by)
      where id = pl.id returning * into pl;
      update plots set registered = reg_date < current_date where id = pl.id;
      insert into plot_events (plot_id, org_id, actor, text, created_at, member)
      values (pl.id, o.id, v_by, 'Marked sold, registration ' || _d(pl.reg_date), v_when, v_by);
    elsif r < 0.58 then
      update plots set status = 'booked', buyer_name = buyers[1 + floor(random() * 16)::int],
        buyer_phone = '+91 90000 ' || lpad((10000 + n)::text, 5, '0'), sold_by = v_by,
        paid = round((v * (0.1 + random() * 0.2))::numeric, -4), due_date = current_date + (-3 + floor(random() * 25))::int
      where id = pl.id returning * into pl;
      insert into plot_events (plot_id, org_id, actor, text, created_at, member)
      values (pl.id, o.id, v_by, 'Booked for ' || pl.buyer_name || ', advance ' || _inr(pl.paid), v_when, v_by);
    end if;
  end loop;

  select sum(sqft * coalesce(rate_override, pr.sale_rate)) into v_rev from plots where project_id = pr.id;
  insert into project_funding (project_id, org_id, bank, credit, cash) values (pr.id, o.id, round(v_rev * 0.3, -4), round(v_rev * 0.07, -4), round(v_rev * 0.18, -4))
  on conflict (project_id) do update set bank = excluded.bank, credit = excluded.credit, cash = excluded.cash;
  insert into cost_lines (project_id, org_id, category, party, committed, paid)
  select pr.id, o.id, c.cat, c.party, round(v_rev * c.f, -4), round(v_rev * c.f * c.p, -4)
  from (values ('Land purchase', 'Landowners (sale deed)', 0.36, 1.0), ('Registration', 'Sub-Registrar office', 0.022, 1.0),
    ('Layout design', 'Desai Architects', 0.006, 0.8), ('Electricity', 'Shree Electricals / MSEDCL', 0.028, 0.6),
    ('Water connection', 'Gram Panchayat + borewell', 0.012, 1.0), ('Road', 'Sri Balaji Road Contractors', 0.055, 0.6),
    ('Marketing', 'PixelReach Media', 0.014, 0.75), ('Sales', 'Site office & staff', 0.008, 0.7)) as c(cat, party, f, p);
  insert into commission_payments (org_id, member_id, project_id, amount, paid_on)
  select o.id, pf.id, pr.id, round(sum(case when pl2.commission_type = 'per_sqft' then pl2.sqft * pl2.commission_rate
      else pl2.sqft * coalesce(pl2.rate_override, pr.sale_rate) * pl2.commission_rate / 100 end) * 0.6, -3), current_date - 10
  from plots pl2 join profiles pf on pf.id = pl2.sold_by
  where pl2.project_id = pr.id and pl2.status = 'sold' and pf.role <> 'owner'
  group by pf.id having sum(pl2.commission_rate) > 0;
end $$;

-- demo-start rate limit: 10 demos per visitor address per day, 300 in total per day
create table public.demo_starts (ip text not null, created_at timestamptz not null default now());
alter table public.demo_starts enable row level security; -- no policies: service role only
create or replace function public.demo_allow_start(p_ip text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from demo_starts where created_at < now() - interval '1 day';
  if (select count(*) from demo_starts where ip = p_ip) >= 10 or (select count(*) from demo_starts) >= 300 then
    return false;
  end if;
  insert into demo_starts (ip) values (p_ip);
  return true;
end $$;
revoke execute on function public.demo_allow_start from public, anon, authenticated;

-- demo companies (and their sign-ins) are removed 3 days after they were started
create or replace function public.cleanup_demo_orgs() returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_n int;
begin
  delete from auth.users where id in (
    select p.id from profiles p join orgs o on o.id = p.org_id where o.is_demo and o.created_at < now() - interval '3 days');
  delete from orgs where is_demo and created_at < now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
select cron.schedule('pocketplot-demo-cleanup', '15 21 * * *', $$select public.cleanup_demo_orgs()$$);

revoke execute on function public._tag_plot_event, public.cleanup_demo_orgs from public, anon, authenticated;

-- live team feed
alter publication supabase_realtime add table public.plot_events;
