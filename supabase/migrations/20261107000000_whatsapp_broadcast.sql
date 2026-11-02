-- WhatsApp broadcasts: announce a project to customers who agreed to hear about new projects.
--   contacts           the company's customer list; marketing_ok records the customer's consent (Meta requires it)
--   broadcasts         one row per send: which project, when, how many
--   customer_messages  gains broadcast_id / contact_id; each broadcast message rides the existing queue, so the
--                      deliver function, delivery ticks, plan limits and STOP replies all work as for buyer messages.
-- Broadcasts are WhatsApp only (promotional SMS needs separate DLT approval), owner only, at most 1,000 at a time,
-- and nobody gets the same project twice within 7 days.

-- the number as WhatsApp wants it; mirrors toWhatsAppNumber() in supabase/functions/_shared/whatsapp.ts
create or replace function public._wa_number(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d ~ '^[6-9]\d{9}$' then return '91' || d; end if;
  if d ~ '^0[6-9]\d{9}$' then return '91' || substr(d, 2); end if;
  if d ~ '^05\d{8}$' then return '971' || substr(d, 2); end if;
  if d ~ '^5\d{8}$' then return '971' || d; end if;
  if d ~ '^91[6-9]\d{9}$' or d ~ '^9715\d{8}$' then return d; end if;
  if d ~ '^\d{8,15}$' and d !~ '^0' then return d; end if;
  return null;
end $$;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text not null,
  wa_number text not null,
  source text not null default 'manual' check (source in ('manual', 'buyer', 'lead', 'import')),
  marketing_ok boolean not null default false,
  consent_at timestamptz,
  consent_by uuid references public.profiles on delete set null,
  opted_out_at timestamptz,
  interest_project uuid references public.projects on delete set null,
  note text check (length(note) <= 300),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, wa_number)
);
create index contacts_org_id_idx on public.contacts (org_id, created_at desc);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  project_id uuid references public.projects on delete set null,
  template text not null,
  body text not null,
  total int not null default 0,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index broadcasts_org_id_idx on public.broadcasts (org_id, created_at desc);

alter table public.customer_messages add column broadcast_id uuid references public.broadcasts on delete set null;
alter table public.customer_messages add column contact_id uuid references public.contacts on delete set null;
create index customer_messages_broadcast_idx on public.customer_messages (broadcast_id);
create index customer_messages_contact_idx on public.customer_messages (contact_id, created_at desc);

-- customer details stay with the people who sell: owner and sales (not brokers or the accountant)
alter table public.contacts enable row level security;
alter table public.broadcasts enable row level security;
create policy "sellers see contacts" on public.contacts for select
  using (org_id = (select public.my_org()) and (select public.my_role()) in ('owner', 'sales'));
create policy "sellers see broadcasts" on public.broadcasts for select
  using (org_id = (select public.my_org()) and (select public.my_role()) in ('owner', 'sales'));
revoke insert, update, delete on public.contacts, public.broadcasts from authenticated, anon;

-- Add or change a contact. Ticking marketing_ok records who confirmed the customer's consent and when.
create or replace function public.save_contact(p_id uuid, p jsonb) returns public.contacts
language plpgsql security definer set search_path = public as $$
declare c contacts; v_wa text := _wa_number(p->>'phone'); v_ok boolean := coalesce((p->>'marketing_ok')::boolean, false);
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the customer''s name'; end if;
  if v_wa is null then raise exception 'Enter a valid mobile number'; end if;
  if p_id is null then
    begin
      insert into contacts (org_id, name, phone, wa_number, source, marketing_ok, consent_at, consent_by, interest_project, note, created_by)
      values (my_org(), trim(p->>'name'), trim(p->>'phone'), v_wa, 'manual', v_ok, case when v_ok then now() end,
        case when v_ok then auth.uid() end, nullif(p->>'interest_project', '')::uuid, nullif(trim(p->>'note'), ''), auth.uid())
      returning * into c;
    exception when unique_violation then
      raise exception 'This number is already in your contacts';
    end;
  else
    select * into c from contacts where id = p_id and org_id = my_org();
    if not found then raise exception 'Contact not found'; end if;
    begin
      update contacts set name = trim(p->>'name'), phone = trim(p->>'phone'), wa_number = v_wa,
        marketing_ok = v_ok,
        consent_at = case when v_ok and not c.marketing_ok then now() when v_ok then c.consent_at end,
        consent_by = case when v_ok and not c.marketing_ok then auth.uid() when v_ok then c.consent_by end,
        opted_out_at = case when v_ok and not c.marketing_ok then null else c.opted_out_at end,
        interest_project = nullif(p->>'interest_project', '')::uuid, note = nullif(trim(p->>'note'), '')
      where id = p_id returning * into c;
    exception when unique_violation then
      raise exception 'This number is already in your contacts';
    end;
  end if;
  return c;
end $$;

create or replace function public.delete_contact(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _assert_role(array['owner']::user_role[]);
  delete from contacts where id = p_id and org_id = my_org();
  if not found then raise exception 'Contact not found'; end if;
end $$;

-- Buyers of plots and flats join the list, without marketing consent (booking updates are not consent to offers).
create or replace function public.import_buyers() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform _assert_role(array['owner', 'sales']::user_role[]);
  insert into contacts (org_id, name, phone, wa_number, source, interest_project, created_by)
  select distinct on (_wa_number(pl.buyer_phone)) pl.org_id, trim(pl.buyer_name), trim(pl.buyer_phone), _wa_number(pl.buyer_phone),
    'buyer', pl.project_id, auth.uid()
  from plots pl
  where pl.org_id = my_org() and pl.status <> 'available' and coalesce(trim(pl.buyer_name), '') <> '' and _wa_number(pl.buyer_phone) is not null
  order by _wa_number(pl.buyer_phone), pl.updated_at desc
  on conflict (org_id, wa_number) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Owner announces a project to every consenting contact (or the ones picked). Returns how many were queued.
-- Template new_project_launch: {{1}} first name, {{2}} project, {{3}} location, {{4}} starting price,
-- {{5}} rate per sq ft, {{6}} company name.
create or replace function public.send_broadcast(p_project uuid, p_contacts uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare pr projects; o orgs; b broadcasts; v_from numeric; v_body text; v_n int;
begin
  perform _assert_role(array['owner']::user_role[]);
  select * into pr from projects where id = p_project and org_id = my_org();
  if not found then raise exception 'Project not found'; end if;
  select * into o from orgs where id = pr.org_id;
  select min(_value(pl)) into v_from from plots pl where pl.project_id = pr.id and pl.status = 'available';
  if v_from is null then raise exception 'This project has nothing open to announce'; end if;

  v_body := format('Hi {name}, %s at %s is now open. %s from %s (%s per sq ft). Reply to book a site visit. – %s',
    pr.name, pr.location, case when pr.kind = 'apartments' then 'Flats' else 'Plots' end, _inr(v_from), _inr(pr.sale_rate), o.name);
  insert into broadcasts (org_id, project_id, template, body, created_by)
  values (pr.org_id, pr.id, 'new_project_launch', v_body, auth.uid()) returning * into b;

  insert into customer_messages (org_id, to_name, to_phone, kind, body, template, params, whatsapp_status, sms_status, broadcast_id, contact_id)
  select pr.org_id, c.name, c.phone, 'broadcast', replace(v_body, '{name}', split_part(trim(c.name), ' ', 1)), 'new_project_launch',
    jsonb_build_array(split_part(trim(c.name), ' ', 1), pr.name, pr.location, _inr(v_from), _inr(pr.sale_rate), o.name),
    case when o.is_demo then 'demo, not sent' else 'queued' end, 'not used for broadcasts', b.id, c.id
  from contacts c
  where c.org_id = pr.org_id and c.marketing_ok and c.opted_out_at is null
    and (p_contacts is null or c.id = any (p_contacts))
    and not exists (
      select 1 from customer_messages m join broadcasts x on x.id = m.broadcast_id
      where m.contact_id = c.id and x.project_id = pr.id and m.created_at > now() - interval '7 days')
  order by c.created_at
  limit 1000;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from broadcasts where id = b.id;
    raise exception 'Nobody to send to: no contact has agreed to offers, or they all got this project in the last 7 days';
  end if;
  update broadcasts set total = v_n where id = b.id;
  return v_n;
end $$;

-- STOP from anyone: buyers and team as before, and contacts stop getting broadcasts
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
  ), c as (
    update contacts set marketing_ok = false, opted_out_at = now()
    where opted_out_at is null and wa_number = p_wa_to
    returning id
  ) select ((select count(*) from p) + (select count(*) from t) + (select count(*) from c))::int
$$;

revoke execute on function public.whatsapp_opt_out(text), public._wa_number(text) from public, anon, authenticated;
revoke execute on function public.save_contact(uuid, jsonb), public.delete_contact(uuid), public.import_buyers(),
  public.send_broadcast(uuid, uuid[]) from public, anon;
grant execute on function public.save_contact(uuid, jsonb), public.delete_contact(uuid), public.import_buyers(),
  public.send_broadcast(uuid, uuid[]) to authenticated;
