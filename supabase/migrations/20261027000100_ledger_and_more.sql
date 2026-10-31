-- Money ledger and the features around it:
--   bank & cash accounts with live balances, every rupee in or out as a dated ledger entry,
--   instalment schedules, numbered payment receipts, plot documents, staff salaries, company assets,
--   and the accountant role's permissions.

create or replace function public._is_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() in ('owner', 'accountant')
$$;

-- ---------------------------------------------------------------- accounts & ledger

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  kind text not null default 'bank' check (kind in ('bank', 'cash')),
  bank_name text,
  last4 text,
  opening_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.accounts (org_id);

create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  account_id uuid references public.accounts on delete set null,
  project_id uuid references public.projects on delete set null,
  plot_id uuid references public.plots on delete set null,
  member_id uuid references public.profiles on delete set null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  txn_date date not null default current_date,
  category text not null,
  party text,
  note text,
  -- customer_payment | expense | commission | salary | income | other_expense | transfer | asset
  source text not null,
  source_id uuid,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index on public.ledger (org_id, txn_date desc);
create index on public.ledger (account_id);

-- every company starts with a cash box and a bank account
create or replace function public._default_accounts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into accounts (org_id, name, kind) values (new.id, 'Main bank account', 'bank'), (new.id, 'Cash in hand', 'cash');
  return new;
end $$;
create trigger orgs_default_accounts after insert on public.orgs for each row execute function public._default_accounts();
insert into public.accounts (org_id, name, kind)
select id, n, k from public.orgs, (values ('Main bank account', 'bank'), ('Cash in hand', 'cash')) v(n, k);

create or replace function public._default_account(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from accounts where org_id = p_org and active order by (kind = 'bank') desc, created_at limit 1
$$;

create or replace function public._check_account(p_account uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_account is null then return _default_account(my_org()); end if;
  if not exists (select 1 from accounts where id = p_account and org_id = my_org()) then
    raise exception 'Choose one of your bank or cash accounts';
  end if;
  return p_account;
end $$;

-- ---------------------------------------------------------------- customer payments → ledger, receipts

alter table public.customer_payments add column account_id uuid references public.accounts on delete set null;
alter table public.customer_payments add column mode text check (mode in ('cash', 'upi', 'cheque', 'bank_transfer', 'card', 'other'));
alter table public.customer_payments add column reference text;
alter table public.customer_payments add column receipt_no int;
alter table public.customer_payments add column note text;
-- who paid: a plot can change hands after a cancelled booking, so payments carry the customer's name
alter table public.customer_payments add column buyer_name text;
update public.customer_payments cp set buyer_name = p.buyer_name from public.plots p where p.id = cp.plot_id;

create or replace function public._customer_payment_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl plots;
begin
  select * into pl from plots where id = new.plot_id;
  if new.buyer_name is null then new.buyer_name := pl.buyer_name; end if;
  if new.account_id is null then new.account_id := _default_account(new.org_id); end if;
  if new.receipt_no is null then
    -- lock the company row so two payments never get the same receipt number
    perform 1 from orgs where id = new.org_id for update;
    select coalesce(max(receipt_no), 0) + 1 into new.receipt_no from customer_payments where org_id = new.org_id;
  end if;
  if tg_op = 'INSERT' then
    insert into ledger (org_id, account_id, project_id, plot_id, member_id, direction, amount, txn_date, category, party, note, source, source_id, created_by)
    values (new.org_id, new.account_id, pl.project_id, pl.id, pl.sold_by, 'in', new.amount, new.received_on, 'Plot sale',
      pl.buyer_name, coalesce(new.note, format('Plot %s, receipt #%s', pl.label, new.receipt_no)), 'customer_payment', new.id, new.recorded_by);
  end if;
  return new;
end $$;
create trigger customer_payments_ledger before insert on public.customer_payments
  for each row execute function public._customer_payment_ledger();

-- backfill: receipt numbers, accounts and ledger rows for payments made before this migration
update public.customer_payments cp set account_id = public._default_account(cp.org_id) where account_id is null;
with n as (select id, row_number() over (partition by org_id order by created_at, id) rn from public.customer_payments)
update public.customer_payments cp set receipt_no = n.rn from n where n.id = cp.id;
insert into public.ledger (org_id, account_id, project_id, plot_id, member_id, direction, amount, txn_date, category, party, note, source, source_id, created_by, created_at)
select cp.org_id, cp.account_id, pl.project_id, pl.id, pl.sold_by, 'in', cp.amount, cp.received_on, 'Plot sale', pl.buyer_name,
  format('Plot %s, receipt #%s', pl.label, cp.receipt_no), 'customer_payment', cp.id, cp.recorded_by, cp.created_at
from public.customer_payments cp join public.plots pl on pl.id = cp.plot_id;

-- record_payment gains account, mode, reference and date
drop function public.record_payment(uuid, numeric, date);
create function public.record_payment(p_plot uuid, p_amount numeric, p_next_due date default null,
  p_account uuid default null, p_mode text default null, p_reference text default null, p_date date default null) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_acc uuid;
begin
  perform _assert_role(array['owner', 'sales', 'accountant']::user_role[]);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status = 'available' then raise exception 'This plot has no customer yet'; end if;
  v_acc := _check_account(p_account);
  select * into pr from projects where id = pl.project_id;
  update plots set paid = least(paid + p_amount, _value(pl)), due_date = coalesce(p_next_due, due_date),
    updated_at = now(), updated_by = auth.uid()
  where id = p_plot returning * into pl;
  insert into customer_payments (plot_id, org_id, amount, recorded_by, account_id, mode, reference, received_on)
  values (pl.id, pl.org_id, p_amount, auth.uid(), v_acc, p_mode, nullif(trim(p_reference), ''), coalesce(p_date, current_date));
  perform _sync_due_date(pl.id);
  perform _event(pl, format('Payment received %s', _inr(p_amount)));
  perform _notify_org(pl, 'money', format('%s recorded a payment of %s for %s · %s (balance %s)', _actor_name(), _inr(p_amount), pl.label, pr.name, _inr(_value(pl) - pl.paid)));
  select * into pl from plots where id = p_plot;
  return pl;
end $$;

-- ---------------------------------------------------------------- instalments

create table public.plot_installments (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null references public.plots on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);
create index on public.plot_installments (plot_id, due_date);

-- the plot's due date is the first instalment not yet covered by what the customer has paid
create or replace function public._sync_due_date(p_plot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_due date;
begin
  if not exists (select 1 from plot_installments where plot_id = p_plot) then return; end if;
  select paid into v_paid from plots where id = p_plot;
  select due_date into v_due from (
    select due_date, sum(amount) over (order by due_date, id) as cum from plot_installments where plot_id = p_plot
  ) s where cum > v_paid + 0.5 order by due_date limit 1;
  update plots set due_date = v_due where id = p_plot;
end $$;

create or replace function public.save_installments(p_plot uuid, p_items jsonb) returns public.plots
language plpgsql security definer set search_path = public as $$
declare pl plots; pr projects; v_total numeric; v_n int;
begin
  perform _assert_role(array['owner', 'sales', 'accountant']::user_role[]);
  select * into pl from plots where id = p_plot and org_id = my_org() for update;
  if not found or pl.status = 'available' then raise exception 'This plot has no customer yet'; end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0), count(*) into v_total, v_n from jsonb_array_elements(p_items) x;
  if v_total > _value(pl) + 1 then raise exception 'Instalments add up to more than the plot price of %', _inr(_value(pl)); end if;
  delete from plot_installments where plot_id = p_plot;
  insert into plot_installments (plot_id, org_id, due_date, amount, note)
  select p_plot, pl.org_id, (x ->> 'due_date')::date, (x ->> 'amount')::numeric, nullif(x ->> 'note', '')
  from jsonb_array_elements(p_items) x where (x ->> 'amount')::numeric > 0;
  perform _sync_due_date(p_plot);
  select * into pr from projects where id = pl.project_id;
  perform _event(pl, format('Payment plan set: %s instalments, %s', v_n, _inr(v_total)));
  select * into pl from plots where id = p_plot;
  return pl;
end $$;

-- ---------------------------------------------------------------- expenses with dated payments

create or replace function public.add_cost_line(p_project uuid, p_category text, p_party text, p_committed numeric,
  p_paid numeric default 0, p_account uuid default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org(); v_acc uuid;
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  if not exists (select 1 from projects where id = p_project and org_id = v_org) then raise exception 'Project not found'; end if;
  if coalesce(p_committed, 0) < 0 or coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > coalesce(p_committed, 0) then
    raise exception 'Paid now cannot be more than the total agreed';
  end if;
  insert into cost_lines (project_id, org_id, category, party, committed, paid)
  values (p_project, v_org, trim(p_category), trim(p_party), p_committed, coalesce(p_paid, 0)) returning id into v_id;
  if coalesce(p_paid, 0) > 0 then
    v_acc := _check_account(p_account);
    insert into ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, source, source_id, created_by)
    values (v_org, v_acc, p_project, 'out', p_paid, coalesce(p_date, current_date), trim(p_category), trim(p_party), 'expense', v_id, auth.uid());
  end if;
  return v_id;
end $$;

create or replace function public.pay_expense(p_cost uuid, p_amount numeric, p_account uuid default null,
  p_date date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c cost_lines; v_acc uuid;
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  select * into c from cost_lines where id = p_cost and org_id = my_org() for update;
  if not found then raise exception 'Expense not found'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if c.paid + p_amount > c.committed + 0.5 then raise exception 'That is more than the % still to pay', _inr(c.committed - c.paid); end if;
  v_acc := _check_account(p_account);
  update cost_lines set paid = paid + p_amount where id = c.id;
  insert into ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, note, source, source_id, created_by)
  values (c.org_id, v_acc, c.project_id, 'out', p_amount, coalesce(p_date, current_date), c.category, c.party, nullif(trim(p_note), ''), 'expense', c.id, auth.uid());
end $$;

-- existing expenses: one ledger row per head for what was already paid
insert into public.ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, source, source_id, created_at)
select org_id, public._default_account(org_id), project_id, 'out', paid, created_at::date, category, party, 'expense', id, created_at
from public.cost_lines where paid > 0;

-- ---------------------------------------------------------------- commission & salary payments

alter table public.commission_payments add column account_id uuid references public.accounts on delete set null;
insert into public.ledger (org_id, account_id, project_id, member_id, direction, amount, txn_date, category, party, source, source_id, created_at)
select cp.org_id, public._default_account(cp.org_id), cp.project_id, cp.member_id, 'out', cp.amount, cp.paid_on, 'Commission', p.full_name, 'commission', cp.id, cp.created_at
from public.commission_payments cp join public.profiles p on p.id = cp.member_id;

drop function public.pay_commission(uuid, uuid, numeric);
create function public.pay_commission(p_member uuid, p_project uuid, p_amount numeric, p_account uuid default null, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org(); v_name text; v_member text; v_id uuid; v_acc uuid;
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  perform _assert_member(p_member, v_org);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  v_acc := _check_account(p_account);
  insert into commission_payments (org_id, member_id, project_id, amount, paid_on, account_id)
  values (v_org, p_member, p_project, p_amount, coalesce(p_date, current_date), v_acc) returning id into v_id;
  select name into v_name from projects where id = p_project and org_id = v_org;
  select full_name into v_member from profiles where id = p_member;
  insert into ledger (org_id, account_id, project_id, member_id, direction, amount, txn_date, category, party, source, source_id, created_by)
  values (v_org, v_acc, p_project, p_member, 'out', p_amount, coalesce(p_date, current_date), 'Commission', v_member, 'commission', v_id, auth.uid());
  insert into notifications (org_id, recipient, actor, kind, text)
  values (v_org, p_member, auth.uid(), 'money', format('%s paid you %s commission for %s', _actor_name(), _inr(p_amount), v_name));
end $$;

alter table public.profiles add column monthly_salary numeric(12,2) not null default 0;

drop function public.update_member(uuid, numeric, boolean, text);
create function public.update_member(p_member uuid, p_rate numeric, p_active boolean, p_type text default 'percent', p_salary numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner']::user_role[]);
  if p_member = auth.uid() then raise exception 'You cannot change your own account here'; end if;
  if p_type not in ('percent', 'per_sqft') then raise exception 'Unknown commission type'; end if;
  if p_rate < 0 or (p_type = 'percent' and p_rate > 100) then raise exception 'Enter a valid commission'; end if;
  update profiles set commission_rate = p_rate, commission_type = p_type, active = p_active,
    monthly_salary = coalesce(p_salary, monthly_salary)
  where id = p_member and org_id = my_org();
end $$;

create or replace function public.pay_salary(p_member uuid, p_amount numeric, p_month date, p_account uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org(); v_name text; v_acc uuid;
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  perform _assert_member(p_member, v_org);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  v_acc := _check_account(p_account);
  select full_name into v_name from profiles where id = p_member;
  insert into ledger (org_id, account_id, member_id, direction, amount, txn_date, category, party, note, source, created_by)
  values (v_org, v_acc, p_member, 'out', p_amount, current_date, 'Salary', v_name, 'Salary for ' || to_char(coalesce(p_month, current_date), 'FMMonth YYYY'), 'salary', auth.uid());
end $$;

-- ---------------------------------------------------------------- other income/expense, transfers, deletions

create or replace function public.add_ledger_entry(p_direction text, p_amount numeric, p_account uuid, p_date date,
  p_category text, p_party text default null, p_note text default null, p_project uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org();
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Choose money in or money out'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  if coalesce(trim(p_category), '') = '' then raise exception 'Choose a category'; end if;
  if p_project is not null and not exists (select 1 from projects where id = p_project and org_id = v_org) then raise exception 'Project not found'; end if;
  insert into ledger (org_id, account_id, project_id, direction, amount, txn_date, category, party, note, source, created_by)
  values (v_org, _check_account(p_account), p_project, p_direction, p_amount, coalesce(p_date, current_date), trim(p_category),
    nullif(trim(p_party), ''), nullif(trim(p_note), ''), case when p_direction = 'in' then 'income' else 'other_expense' end, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.transfer_funds(p_from uuid, p_to uuid, p_amount numeric, p_date date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := my_org(); v_link uuid := gen_random_uuid();
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  if p_from = p_to then raise exception 'Choose two different accounts'; end if;
  perform _check_account(p_from); perform _check_account(p_to);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero'; end if;
  insert into ledger (org_id, account_id, direction, amount, txn_date, category, note, source, source_id, created_by) values
    (v_org, p_from, 'out', p_amount, coalesce(p_date, current_date), 'Transfer', nullif(trim(p_note), ''), 'transfer', v_link, auth.uid()),
    (v_org, p_to, 'in', p_amount, coalesce(p_date, current_date), 'Transfer', nullif(trim(p_note), ''), 'transfer', v_link, auth.uid());
end $$;

-- only entries typed in by hand can be deleted (sales, expenses and commissions are undone where they were made)
create or replace function public.delete_ledger_entry(p_entry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e ledger;
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  select * into e from ledger where id = p_entry and org_id = my_org();
  if not found then raise exception 'Entry not found'; end if;
  if e.source not in ('income', 'other_expense', 'transfer', 'salary', 'asset') then
    raise exception 'This entry comes from a plot payment, expense or commission. Change it there.';
  end if;
  if e.source = 'transfer' then delete from ledger where source = 'transfer' and source_id = e.source_id and org_id = e.org_id;
  else delete from ledger where id = e.id; end if;
end $$;

-- ---------------------------------------------------------------- company assets

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  category text not null default 'Other',
  purchase_date date not null default current_date,
  cost numeric(14,2) not null check (cost >= 0),
  -- yearly reducing-balance depreciation, e.g. 15 for vehicles
  depreciation_pct numeric(5,2) not null default 10 check (depreciation_pct between 0 and 100),
  note text,
  disposed_on date,
  created_at timestamptz not null default now()
);

create or replace function public.add_asset(p_name text, p_category text, p_date date, p_cost numeric, p_dep numeric,
  p_note text default null, p_account uuid default null, p_record_payment boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid := my_org();
begin
  if not _is_finance() then raise exception 'You do not have permission to do this'; end if;
  insert into assets (org_id, name, category, purchase_date, cost, depreciation_pct, note)
  values (v_org, trim(p_name), coalesce(nullif(trim(p_category), ''), 'Other'), coalesce(p_date, current_date), p_cost, coalesce(p_dep, 10), nullif(trim(p_note), ''))
  returning id into v_id;
  if p_record_payment and p_cost > 0 then
    insert into ledger (org_id, account_id, direction, amount, txn_date, category, party, note, source, source_id, created_by)
    values (v_org, _check_account(p_account), 'out', p_cost, coalesce(p_date, current_date), 'Asset purchase', trim(p_name), nullif(trim(p_note), ''), 'asset', v_id, auth.uid());
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- plot documents

create table public.plot_documents (
  id uuid primary key default gen_random_uuid(),
  plot_id uuid not null references public.plots on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  name text not null,
  kind text not null default 'Other',
  path text not null,
  size_bytes int,
  uploaded_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index on public.plot_documents (plot_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 15728640)
on conflict (id) do nothing;

create policy "team reads documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.my_org()::text and public.my_role() in ('owner', 'sales', 'accountant'));
create policy "team uploads documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = public.my_org()::text and public.my_role() in ('owner', 'sales', 'accountant'));
create policy "owner removes documents" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = public.my_org()::text and public.my_role() = 'owner');

-- ---------------------------------------------------------------- permissions

alter table public.accounts enable row level security;
alter table public.ledger enable row level security;
alter table public.plot_installments enable row level security;
alter table public.assets enable row level security;
alter table public.plot_documents enable row level security;

create policy "finance reads accounts" on public.accounts for select using (org_id = my_org() and _is_finance());
create policy "finance adds accounts" on public.accounts for insert with check (org_id = my_org() and _is_finance());
create policy "finance edits accounts" on public.accounts for update using (org_id = my_org() and _is_finance());
create policy "finance reads ledger" on public.ledger for select using (org_id = my_org() and _is_finance());
create policy "team reads instalments" on public.plot_installments for select using (org_id = my_org());
create policy "finance reads assets" on public.assets for select using (org_id = my_org() and _is_finance());
create policy "finance edits assets" on public.assets for update using (org_id = my_org() and _is_finance());
create policy "team reads documents" on public.plot_documents for select using (org_id = my_org() and my_role() in ('owner', 'sales', 'accountant'));
create policy "team adds documents" on public.plot_documents for insert
  with check (org_id = my_org() and my_role() in ('owner', 'sales', 'accountant') and uploaded_by = auth.uid());
create policy "owner deletes documents" on public.plot_documents for delete using (org_id = my_org() and my_role() = 'owner');

-- accountant joins the owner on money tables
drop policy "owner manages funding" on public.project_funding;
create policy "finance manages funding" on public.project_funding for all
  using (org_id = my_org() and _is_finance()) with check (org_id = my_org() and _is_finance());
drop policy "owner manages costs" on public.cost_lines;
create policy "finance reads costs" on public.cost_lines for select using (org_id = my_org() and _is_finance());
drop policy "owner reads commissions" on public.commission_payments;
create policy "finance reads commissions" on public.commission_payments for select
  using (org_id = my_org() and (_is_finance() or member_id = auth.uid()));
drop policy "owner and sales read payments" on public.customer_payments;
create policy "team reads payments" on public.customer_payments for select
  using (org_id = my_org() and my_role() in ('owner', 'sales', 'accountant'));
drop policy "owner and sales read messages" on public.customer_messages;
create policy "team reads messages" on public.customer_messages for select
  using (org_id = my_org() and my_role() in ('owner', 'sales', 'accountant'));

revoke execute on function public._default_accounts, public._customer_payment_ledger,
  public._sync_due_date, public._check_account, public._default_account from public, anon, authenticated;

alter publication supabase_realtime add table public.ledger, public.customer_payments;

-- ---------------------------------------------------------------- richer demo data

-- Same as before, plus dated customer payments (receipts and bank balances), instalment plans,
-- expense and commission payments through the ledger, salaries, other income and company assets.
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
      -- three monthly instalments for the balance, the first one soon
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
end $$;
