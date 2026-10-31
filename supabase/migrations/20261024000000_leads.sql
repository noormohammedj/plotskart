-- Enquiries from the public sales page (website/index.html).
-- Anyone may submit one; nobody can read them through the API. View them in the
-- Supabase dashboard: Table Editor > leads.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  company text check (char_length(company) <= 160),
  phone text not null check (char_length(phone) between 8 and 20),
  email text check (char_length(email) <= 200),
  city text check (char_length(city) <= 80),
  plan text not null default 'unsure' check (plan in ('solo', 'team', 'custom', 'unsure')),
  projects int check (projects between 0 and 1000),
  message text check (char_length(message) <= 2000),
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index on public.leads (created_at desc);

alter table public.leads enable row level security;

create policy "anyone can send an enquiry" on public.leads for insert to anon, authenticated
  with check (status = 'new');

revoke all on public.leads from anon, authenticated;
grant insert (name, company, phone, email, city, plan, projects, message) on public.leads to anon, authenticated;
