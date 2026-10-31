-- Sample data: funding arrives as money in (bank loan, private finance, owner capital) so bank
-- balances look real, and the latest bookings and sales arrive as notifications.

create or replace function public.demo_fill(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr projects; o orgs; pl plots; r float8; v numeric; v_by uuid; v_rev numeric; v_when date; v_paid numeric;
  buyers text[] := array['Arjun Deshmukh','Sneha Kulkarni','Imran Shaikh','Pooja Jadhav','Rahul Pawar','Kavita More','Vikram Patil','Ayesha Khan','Nitin Gaikwad','Meera Joshi','Sachin Bhosale','Farhan Siddiqui','Anjali Shinde','Prakash Wagh','Rekha Chavan','Deepak Kale'];
  modes text[] := array['bank_transfer','upi','cheque','cash'];
  sellers uuid[]; v_bank uuid; v_cash uuid; n int := 0; c record; v_cid uuid; m record;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into o from orgs where id = my_org();
  if not o.is_demo then raise exception 'Sample data can only be added to a demo company'; end if;
  select * into pr from projects where id = p_project and org_id = o.id;
  if not found then raise exception 'Project not found'; end if;
  select array_agg(id order by role desc, created_at) into sellers from profiles where org_id = o.id and active and role in ('owner', 'sales', 'broker');
  v_bank := (select id from accounts where org_id = o.id and kind = 'bank' order by created_at limit 1);
  v_cash := (select id from accounts where org_id = o.id and kind = 'cash' order by created_at limit 1);

  for pl in select * from plots where project_id = pr.id and status = 'available' order by label loop
    r := random();
    n := n + 1;
    v := pl.sqft * coalesce(pl.rate_override, pr.sale_rate);
    v_by := sellers[1 + floor(random() * array_length(sellers, 1))::int];
    v_when := current_date - (1 + floor(random() * 150))::int;
    if r < 0.42 then
      v_paid := case when random() < 0.2 then round(v * 0.85, -4) else v end;
      update plots set status = 'sold', buyer_name = buyers[1 + floor(random() * 16)::int],
        buyer_phone = '+91 90000 ' || lpad((10000 + n)::text, 5, '0'), sold_by = v_by, paid = v_paid,
        reg_date = case when random() < 0.25 then current_date + (1 + floor(random() * 10))::int else v_when + 20 end,
        commission_rate = (select case when role = 'owner' then 0 else commission_rate end from profiles where id = v_by),
        commission_type = (select commission_type from profiles where id = v_by)
      where id = pl.id returning * into pl;
      update plots set registered = reg_date < current_date where id = pl.id;
      -- advance, then the balance a few weeks later
      insert into customer_payments (plot_id, org_id, amount, received_on, recorded_by, account_id, mode)
      values (pl.id, o.id, round(v_paid * 0.25, -3), v_when, v_by, v_bank, modes[1 + floor(random() * 4)::int]),
             (pl.id, o.id, v_paid - round(v_paid * 0.25, -3), least(current_date, v_when + 18), v_by, v_bank, 'bank_transfer');
      insert into plot_events (plot_id, org_id, actor, text, created_at, member)
      values (pl.id, o.id, v_by, 'Marked sold, registration ' || _d(pl.reg_date), v_when + interval '10 hours', v_by);
    elsif r < 0.58 then
      v_paid := round((v * (0.1 + random() * 0.2))::numeric, -4);
      update plots set status = 'booked', buyer_name = buyers[1 + floor(random() * 16)::int],
        buyer_phone = '+91 90000 ' || lpad((10000 + n)::text, 5, '0'), sold_by = v_by, paid = v_paid
      where id = pl.id returning * into pl;
      insert into customer_payments (plot_id, org_id, amount, received_on, recorded_by, account_id, mode)
      values (pl.id, o.id, v_paid, v_when, v_by, case when random() < 0.3 then v_cash else v_bank end, modes[1 + floor(random() * 4)::int]);
      -- payment plans cover the full price: the advance first, then three monthly instalments
      insert into plot_installments (plot_id, org_id, due_date, amount, note) values (pl.id, o.id, v_when, v_paid, 'Booking advance');
      insert into plot_installments (plot_id, org_id, due_date, amount, note)
      select pl.id, o.id, current_date + (-3 + floor(random() * 12))::int + (k * 30), round((v - v_paid) / 3, 0), 'Instalment ' || (k + 1)
      from generate_series(0, 2) k;
      perform _sync_due_date(pl.id);
      insert into plot_events (plot_id, org_id, actor, text, created_at, member)
      values (pl.id, o.id, v_by, 'Booked for ' || pl.buyer_name || ', advance ' || _inr(pl.paid), v_when + interval '11 hours', v_by);
    end if;
  end loop;

  select sum(sqft * coalesce(rate_override, pr.sale_rate)) into v_rev from plots where project_id = pr.id;
  insert into project_funding (project_id, org_id, bank, credit, cash) values (pr.id, o.id, round(v_rev * 0.3, -4), round(v_rev * 0.07, -4), round(v_rev * 0.18, -4))
  on conflict (project_id) do update set bank = excluded.bank, credit = excluded.credit, cash = excluded.cash;
  -- the money that paid for the land and roads: loan, private finance and the owner's own capital
  insert into ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, source)
  select o.id, v_bank, pr.id, 'in', f.amt, current_date - f.ago, f.cat, f.party, 'income'
  from (values ('Bank loan disbursed', 'HDFC Bank (project loan)', round(v_rev * 0.3, -4), 175),
               ('Private finance', 'Patil Finance', round(v_rev * 0.07, -4), 172),
               ('Owner capital', 'Owner', round(v_rev * 0.18, -4), 178)) f(cat, party, amt, ago);

  for c in select * from (values ('Land purchase', 'Landowners (sale deed)', 0.36, 1.0, 170), ('Registration', 'Sub-Registrar office', 0.022, 1.0, 160),
    ('Layout design', 'Desai Architects', 0.006, 0.8, 150), ('Electricity', 'Shree Electricals / MSEDCL', 0.028, 0.6, 90),
    ('Water connection', 'Gram Panchayat + borewell', 0.012, 1.0, 80), ('Road', 'Sri Balaji Road Contractors', 0.055, 0.6, 60),
    ('Marketing', 'PixelReach Media', 0.014, 0.75, 40), ('Sales', 'Site office & staff', 0.008, 0.7, 20)) as t(cat, party, f, p, ago) loop
    insert into cost_lines (project_id, org_id, category, party, committed, paid, created_at)
    values (pr.id, o.id, c.cat, c.party, round(v_rev * c.f, -4), round(v_rev * c.f * c.p, -4), now() - (c.ago || ' days')::interval)
    returning id into v_cid;
    insert into ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, source, source_id)
    values (o.id, v_bank, pr.id, 'out', round(v_rev * c.f * c.p, -4), current_date - c.ago, c.cat, c.party, 'expense', v_cid);
  end loop;

  for m in
    select pf.id, pf.full_name, round(sum(case when pl2.commission_type = 'per_sqft' then pl2.sqft * pl2.commission_rate
      else pl2.sqft * coalesce(pl2.rate_override, pr.sale_rate) * pl2.commission_rate / 100 end) * 0.6, -3) amt
    from plots pl2 join profiles pf on pf.id = pl2.sold_by
    where pl2.project_id = pr.id and pl2.status = 'sold' and pf.role <> 'owner'
    group by pf.id, pf.full_name having sum(pl2.commission_rate) > 0
  loop
    if m.amt > 0 then
      insert into commission_payments (org_id, member_id, project_id, amount, paid_on, account_id)
      values (o.id, m.id, pr.id, m.amt, current_date - 10, v_bank) returning id into v_cid;
      insert into ledger (org_id, account_id, project_id, member_id, direction, amount, txn_date, category, party, source, source_id)
      values (o.id, v_bank, pr.id, m.id, 'out', m.amt, current_date - 10, 'Commission', m.full_name, 'commission', v_cid);
    end if;
  end loop;

  -- company-wide entries only once (first sample project)
  if not exists (select 1 from assets where org_id = o.id) then
    insert into ledger (org_id, account_id, member_id, direction, amount, txn_date, category, party, note, source)
    select o.id, v_bank, pf.id, 'out', pf.monthly_salary, (date_trunc('month', current_date) - (k || ' month')::interval)::date + 1, 'Salary', pf.full_name,
      'Salary for ' || to_char(date_trunc('month', current_date) - ((k + 1) || ' month')::interval, 'FMMonth YYYY'), 'salary'
    from profiles pf, generate_series(0, 2) k where pf.org_id = o.id and pf.monthly_salary > 0;
    insert into ledger (org_id, account_id, direction, amount, txn_date, category, party, note, source) values
      (o.id, v_bank, 'in', 45000, current_date - 25, 'Rent received', 'Site office sub-let', 'Monthly rent', 'income'),
      (o.id, v_cash, 'out', 18500, current_date - 12, 'Office expenses', 'Stationery & tea', null, 'other_expense'),
      (o.id, v_bank, 'out', 32000, current_date - 6, 'Fuel & travel', 'Site visits', null, 'other_expense');
    insert into ledger (org_id, account_id, direction, amount, txn_date, category, note, source, source_id)
    select o.id, a, d, 200000, current_date - 4, 'Transfer', 'Cash for site expenses', 'transfer', l
    from (select gen_random_uuid() l) t, (values (v_bank, 'out'), (v_cash, 'in')) v(a, d);
    insert into assets (org_id, name, category, purchase_date, cost, depreciation_pct) values
      (o.id, 'Mahindra Bolero (site vehicle)', 'Vehicle', current_date - 420, 1050000, 15),
      (o.id, 'Site office furniture & laptops', 'Office', current_date - 300, 380000, 25),
      (o.id, 'JCB backhoe (part share)', 'Machinery', current_date - 700, 2400000, 15);
    update accounts set opening_balance = 2500000, bank_name = 'HDFC Bank', last4 = '4417' where id = v_bank;
    update accounts set opening_balance = 150000 where id = v_cash;
  end if;
  -- a few recent updates so the owner's notifications aren't empty on day one
  insert into notifications (org_id, recipient, actor, kind, text, plot_id, created_at)
  select o.id, rcpt.id, e.actor, e.kind, coalesce(pf.full_name, 'Owner') || ' ' ||
    case e.kind when 'sold' then 'marked ' || p.label || ' · ' || pr.name || ' as Sold to ' || p.buyer_name
                else 'booked ' || p.label || ' · ' || pr.name || ' for ' || p.buyer_name end,
    p.id, e.created_at
  from (select * from plot_events where org_id = o.id and kind in ('sold', 'booked') and plot_id in (select id from plots where project_id = pr.id)
        order by created_at desc limit 6) e
  join plots p on p.id = e.plot_id
  left join profiles pf on pf.id = e.actor and pf.role <> 'owner'
  join profiles rcpt on rcpt.org_id = o.id and rcpt.active and rcpt.id is distinct from e.actor;
end $$;
