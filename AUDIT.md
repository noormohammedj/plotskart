# Plotskart code audit

Audit of `src/` and `supabase/` (plus the sales site where it touches the backend) against the checklist in the
Part C brief and the rules in `CLAUDE.md`. Findings only; nothing here has been fixed yet.

**Severity:** **Critical** = data loss or cross-company exposure possible now · **High** = breaks a CLAUDE.md rule
in a way that can cost money or data · **Medium** = should be fixed before scale-up or the UAE launch ·
**Low** = hygiene.

## Summary

| # | Area | Verdict | Worst severity |
| --- | --- | --- | --- |
| 1 | Direct `*.supabase.co` access | App, storage links, edge functions and the sales site all talk to `yyrxjsqhmfoncunjurga.supabase.co` directly; the sales site hardcodes it | Medium |
| 2 | Double booking | `book_plot` / `sell_plot` lock the plot row (`for update`), so two people can't book the same plot at the same moment. `save_layout` had a check-then-delete race that could delete a just-booked plot (fix written, not yet deployed) | High |
| 3 | RLS | RLS is on for all 22 tables. Every policy calls `auth.uid()` / `my_org()` / `my_role()` per row without `(select …)`. 9 tables have no `org_id` index; `device_tokens` has no company column | Medium |
| 4 | Money | All money is `numeric(…,2)` rupees, not `bigint` minor units; no currency column. JS money maths is floating-point throughout | High |
| 5 | Realtime | Only `postgres_changes` (6 subscriptions); no broadcast | Medium |
| 6 | Edge functions | `read-layout`: JWT + owner check, but no limit for paying companies. `deliver`: shared secret, plain `!==`. `demo-start`: public, IP limit from a spoofable header. `demo-switch`: verifies the JWT itself. `lead`: public, no rate limit | High |
| 7 | PII | Buyer names and phones, staff emails, leads and ID documents are all stored as plain text (provider disk encryption only); buyer names also copied into history, notifications and message bodies; one error log can print a full lead row | High |
| 8 | Leads and demo | Same Supabase project, database and Auth as production | High |

---

## 1. Places that reach `*.supabase.co` directly

| Severity | Where | What |
| --- | --- | --- |
| Medium | `website/index.html:710-711` | Sales site hardcodes `supabaseUrl: 'https://yyrxjsqhmfoncunjurga.supabase.co'` and the publishable key (breaks CLAUDE.md rule 7). |
| Medium | `website/index.html:904` | Enquiry form posts to `${supabaseUrl}/functions/v1/lead`. |
| Medium | `website/index.html:906` | Fallback posts straight to `${supabaseUrl}/rest/v1/leads` (PostgREST), skipping the `lead` function. |
| Low | `src/lib/supabase.ts:4`, `.env:2` | App reads `VITE_SUPABASE_URL` (configured, not hardcoded), but the value is the `*.supabase.co` address, so every REST, Auth and Realtime (websocket) call from the app goes there. Vite bakes it into the built bundle (`dist/assets/index-*.js`). |
| Low | `src/lib/editPlots.ts:93`, `src/lib/demo.ts:36`, `src/lib/demo.ts:60` | `functions.invoke('read-layout' / 'demo-start' / 'demo-switch')` → `https://<ref>.supabase.co/functions/v1/…`. |
| Low | `src/lib/layoutImage.ts:51`, `:69`; `src/components/PlotExtras.tsx:140`, `:151`, `:157` | Storage uploads, deletes and `createSignedUrl` links: the signed links the browser opens are `*.supabase.co/storage/v1/…` URLs. |
| Low | `supabase/migrations/20261023000000_init.sql:612`, `20261026000000_commission_activity_demo.sql:181` | Database triggers call the `deliver` function at the URL stored in Vault (`deliver_url`), i.e. the functions URL on `supabase.co`. |
| Low | `supabase/functions/*/index.ts` (e.g. `deliver/index.ts:8`, `lead/index.ts:10`, `read-layout/index.ts:23`) | Edge functions use `Deno.env.get('SUPABASE_URL')` (injected by Supabase, server-side; fine). |

The planned `api.plotskart.in` proxy has to cover REST, Auth, Realtime websockets, Storage (including signed URLs)
and Functions for the app to stop depending on the `supabase.co` hostname.

## 2. Can two users book the same plot at the same instant?

**No for booking and selling.** Every plot RPC takes a row lock before reading the status, so concurrent calls queue
and the second one sees the first one's result:

| Function | Lock | Status check after the lock |
| --- | --- | --- |
| `book_plot` | `20261023000000_init.sql:352` `select … from plots where id = p_plot and org_id = my_org() for update` | `:354` raises `Plot % is already %` unless `available` |
| `sell_plot` (current version) | `20261026000000_commission_activity_demo.sql:53` `for update` | `:55` raises if already `sold` |
| `cancel_booking` | `20261023000000_init.sql:472` `for update` | |
| `set_plot_rate` | `20261026000000_commission_activity_demo.sql:130` `for update` | `:132` |
| `record_payment` (current) | `20261027000100_ledger_and_more.sql:125` `for update` | `:126` |
| `save_installments` | `20261027000100_ledger_and_more.sql:172` `for update` | `:173` |
| Receipt numbers | `20261027000100_ledger_and_more.sql:94` `perform 1 from orgs … for update` serialises numbering per company | |

There is no `unique` or exclusion constraint backing this up; correctness rests on every write path taking the
lock (today they all do).

**High: `save_layout` can delete a plot that was booked a moment earlier.** *Fixed in code by `supabase/migrations/20261030000000_save_layout_lock_plots.sql` (not yet applied to production): it locks the project's plots before the check, deletes only available plots, and refuses the save if a plot with a customer would be left out.*
`20261025000000_layout_editing.sql:24` locks only the **project** row. `:28-33` checks for plots with customers
using a plain read (no lock). `:35-36` then deletes every plot missing from the new list **without repeating the
`status` condition**. Scenario: the owner saves a layout that drops plot A7 while a salesperson books A7. The
booking commits between the check and the delete, so the delete removes the booked plot, and its payments,
instalments, history and documents go with it (they reference `plots` `on delete cascade`, e.g.
`20261023000000_init.sql:113`). Fix later by locking the plots (`for update`) before the check, or adding
`and status = 'available'` to the delete and failing if fewer rows were deleted than expected.

## 3. RLS

**Every table has RLS enabled** (22 of 22): `20261023000000_init.sql:630-643`, `20261024000000_leads.sql:20`,
`20261026000000_commission_activity_demo.sql:266`, `20261027000100_ledger_and_more.sql:391-395`,
`20261028000000_demo_resume.sql:9`. `demo_starts` and `demo_resume` have no policies on purpose (service role only).

**Medium: per-row function calls in policies.** No policy wraps its calls in `(select …)`, so Postgres may run
the lookup once per row instead of once per query:
- `auth.uid()` bare: `20261023000000_init.sql:648`, `:649`, `:670`, `:672`, `:673`, `:677-678`.
- `my_org()` / `my_role()` (each a query on `profiles`, `init.sql:189-197`) bare in every other policy:
  `init.sql:645-681`, `20261027000100_ledger_and_more.sql:397-422`; `_is_finance()` (`ledger_and_more.sql:6-8`)
  calls `my_role()` again.
- Storage policies the same: `20261025000000_layout_editing.sql:8-13`, `20261027000100_ledger_and_more.sql:382-387`.

**Medium: missing `org_id` indexes** (RLS filters on `org_id`, so these get a full scan per query as data grows):

| Table | Defined at | Indexes today |
| --- | --- | --- |
| `customer_payments` | `init.sql:111` | none (not even `plot_id`) |
| `cost_lines` | `init.sql:121` | none |
| `commission_payments` | `init.sql:132` | none |
| `project_funding` | `init.sql:67` | primary key `project_id` only |
| `notifications` | `init.sql:142` | `(recipient, created_at)` only |
| `reminder_log` | `init.sql:181` | primary key `key` only |
| `plot_installments` | `ledger_and_more.sql:143` | `(plot_id, due_date)` only (`:152`) |
| `plot_documents` | `ledger_and_more.sql:365` | `(plot_id)` only (`:376`) |
| `assets` | `ledger_and_more.sql:333` | none |

Have an `org_id` index (leading): `profiles` (`init.sql:33`), `invites` (`unique (org_id, email)`, `init.sql:45`),
`projects` (`:64`), `plots` (`:99`), `plot_events` (`commission_activity_demo.sql:90`), `customer_messages`
(`init.sql:178`), `accounts` (`ledger_and_more.sql:24`), `ledger` (`:45`).

**Medium: tables without a company column.** `device_tokens` (`init.sql:155-160`) is scoped by `user_id` only and
has no index on it. `leads`, `demo_starts` and `demo_resume` are global by design. The schema calls the company
`org_id`, not `company_id` (CLAUDE.md rule 3).

**Related (CLAUDE.md rule 1, "all writes through database functions"):** several policies let the app write
tables directly: `invites` (`init.sql:653`), `projects` update and delete (`:657-658`), `project_funding`
(`:665`, `ledger_and_more.sql:411`), `cost_lines` (`init.sql:667`), `accounts` insert and update
(`ledger_and_more.sql:398-399`), `assets` update (`:403`), `plot_documents` insert and delete (`:405-407`), plus
column-limited updates on `profiles` (`init.sql:651`), `notifications.read_at` (`:675`) and `orgs` settings
(`commission_activity_demo.sql:164`).

## 4. Money columns and money maths

**High: money is `numeric` rupees, not `bigint` paise/fils** (CLAUDE.md rule 2). It isn't float, so there's no
rounding drift in the database, but there is no minor-unit integer and no currency column, which the UAE (AED/fils)
needs:

| Column | Type | At |
| --- | --- | --- |
| `projects.guideline_rate`, `sale_rate` (₹/sq ft) | `numeric(12,2)` | `init.sql:57-58` |
| `plots.rate_override` | `numeric(12,2)` | `init.sql:86` |
| `plots.paid` | `numeric(14,2)` | `init.sql:89` |
| `project_funding.bank`, `credit`, `cash` | `numeric(14,2)` | `init.sql:70-72` |
| `customer_payments.amount` | `numeric(14,2)` | `init.sql:115` |
| `cost_lines.committed`, `paid` | `numeric(14,2)` | `init.sql:127-128` |
| `commission_payments.amount` | `numeric(14,2)` | `init.sql:137` |
| `profiles` / `invites` / `plots.commission_rate` (a ₹/sq ft amount when `commission_type = 'per_sqft'`) | `numeric(10,2)` | `commission_activity_demo.sql:16-18` |
| `accounts.opening_balance` | `numeric(14,2)` | `ledger_and_more.sql:20` |
| `ledger.amount` | `numeric(14,2)` | `ledger_and_more.sql:34` |
| `plot_installments.amount` | `numeric(14,2)` | `ledger_and_more.sql:148` |
| `assets.cost` | `numeric(14,2)` | `ledger_and_more.sql:339` |
| `profiles.monthly_salary` | `numeric(12,2)` | `ledger_and_more.sql:256` |

Plot value is computed unrounded, `sqft * rate` (`init.sql:230-233`), and every money RPC takes `numeric`
parameters (e.g. `init.sql:346`, `ledger_and_more.sql:118`). The only real floats are demo sample data
(`float8` in `demo_fill`, `commission_activity_demo.sql:209`) and project `lat`/`lng` (`init.sql:53-54`, not money).

**High: JavaScript money maths uses floats.** PostgREST returns `numeric` as a JSON number, so every amount
becomes a JS double:
- Plot value: `src/lib/plots.ts:4` `p.sqft * (p.rate_override || pr.sale_rate)`.
- Commission: `src/lib/finance.ts:11` `(plotValue(pr, p) * rate) / 100`; totals `:39`, `:59`, `:64-65`, `:77`.
- Account balances and statements: `src/pages/Finance.tsx:49`, `:265`, `:271`, `:284-285`, `:405`, `:411`;
  `src/pages/Home.tsx:20`, `:54-58`.
- Team payroll and commission totals: `src/pages/Team.tsx:53`, `:60-61`.
- Instalments: `src/components/PlotExtras.tsx:36-37` compares with a `+ 0.5` tolerance, already working around
  float drift; `:46` splits with `Math.round`; `:49` sums.
- Depreciation: `src/lib/money.ts:75` `cost * Math.pow(1 - pct / 100, years)`.
- Display rounds with `Math.round` (`src/lib/format.ts:33`, `:38`), which hides the errors without fixing them.

## 5. Realtime

Only `postgres_changes`; no `broadcast` channels anywhere.
- `src/data/DataProvider.tsx:134-159`: one channel per company subscribing to `plots`, `projects`, `profiles`
  (filtered by `org_id`), `orgs` (by `id`) and `notifications` (by `recipient`).
- `src/pages/Activity.tsx:25-26`: `plot_events` inserts by `org_id`.
- Medium: with `postgres_changes`, Supabase checks RLS for every subscriber on every change. With 15 people per
  company that's 15 policy evaluations per write, each running `my_org()` (see §3). The comment at
  `DataProvider.tsx:144` notes delete events can't be filtered by company, so the code refetches plots after
  layout saves. Broadcast from the database functions would scale better.

## 6. How the edge functions are protected

| Function | JWT at gateway (`supabase/config.toml`) | In-code protection | Findings |
| --- | --- | --- | --- |
| `read-layout` | **on** (`config.toml:19`, no `verify_jwt = false`) | Forwards the caller's JWT (`read-layout/index.ts:21-25`); owner-only (`:26-27`); file path must start with the caller's company id (`:31`); downloads through the caller's own Storage permissions (`:39`); `claim_ai_read` quota (`:36-37`) | **High (cost):** `claim_ai_read` caps only demo companies (3 reads each, 30 a day across demos; `commission_activity_demo.sql:197-200`). A paying company has no limit, and each read costs ≈ $0.34 of Claude usage. |
| `deliver` | off (`config.toml:13-14`) | Shared secret header: `if (req.headers.get('x-deliver-secret') !== Deno.env.get('DELIVER_SECRET'))` (`deliver/index.ts:21-22`); the database sends it from Vault (`commission_activity_demo.sql:181-184`) | Medium: plain `!==` isn't constant-time. If the secret leaked, anyone could push notifications or send WhatsApp/SMS to any number using the company's credits; the payload is trusted as-is (`:26-27`). Demo companies are skipped in the trigger (`:180`), not in the function. |
| `demo-start` | off (`config.toml:21-22`) | Public. `demo_allow_start` RPC: 30 per IP and 1,000 in total per day (`20261028000000_demo_resume.sql:13-22`); resume key reuses an existing demo (`demo-start/index.ts:45-57`) | **High:** the IP is the first `x-forwarded-for` value (`demo-start/index.ts:59`), which a client can set, so the per-IP limit can be bypassed; only the global 1,000 a day remains. Each demo creates 5 production Auth users (`:67-79`) with the service role, so abuse fills production Auth. No CAPTCHA. |
| `demo-switch` | off (`config.toml:24-25`) | Checks the JWT itself with `admin.auth.getUser(jwt)` (`demo-switch/index.ts:22-24`); caller's company must be a demo (`:31-32`); target must be in the same company (`:33-34`) | Low: correct. It hands out magic-link tokens with the service role, so its correctness matters. |
| `lead` | off (`config.toml:16-17`) | Public. Validates and caps field lengths (`lead/index.ts:27`, `:77`); database column checks (`20261024000000_leads.sql:7-14`) | Medium: no rate limit or CAPTCHA; every call also sends an alert email (`lead/index.ts:91`), so a script can flood the leads table and the inbox. The sales site can also insert straight into `leads` with the public key (`website/index.html:906`; grant at `leads.sql:26`). |

All functions answer CORS with `Access-Control-Allow-Origin: *` (`demo-start/index.ts:13`,
`demo-switch/index.ts:11`, `read-layout/index.ts:10`, `lead/index.ts:13`).

## 7. Where PII is stored

Everything below is stored as **plain text** in the production database. The only protection is Supabase's disk
encryption at rest. There is no column-level encryption, hashing or masking. There are no Aadhaar or PAN number
columns; the IDs arrive as uploaded files.

| Data | Where | Who can read it |
| --- | --- | --- |
| Buyer name and mobile | `plots.buyer_name`, `buyer_phone` (`init.sql:87-88`) | Every member of the company, **including brokers** (`init.sql:660`) |
| Buyer name on receipts | `customer_payments.buyer_name` (`ledger_and_more.sql:82`) | Owner, sales, accountant (`:419`) |
| Buyer name and phone in outgoing messages | `customer_messages.to_name`, `to_phone`, `body`, `params` (`init.sql:166-171`) | Owner, sales, accountant (`ledger_and_more.sql:422`) |
| Buyer names inside free text | plot history (`init.sql:371`, `Booked for %s`), team notifications (`:372`), message bodies (`:374`) | Whole company / each recipient |
| Payer names | `ledger.party` (`ledger_and_more.sql:37`) | Finance roles |
| Staff email and phone | `profiles.email`, `phone` (`init.sql:25-27`); `invites.email`, `phone` (`:38-40`); `auth.users` | Whole company / owner |
| ID proofs, agreements, deeds | `documents` bucket, private (`ledger_and_more.sql:378-380`); upload type "ID proof (Aadhaar / PAN)" (`src/components/PlotExtras.tsx:117`) | Owner, sales, accountant of that company (`ledger_and_more.sql:382-387`); opened through 10-minute signed URLs (`PlotExtras.tsx:151`) |
| Sales enquiries: name, phone, email, company, city | `leads` (`20261024000000_leads.sql:5-16`) | Service role only (no select grant, `:25-26`) |
| Push tokens | `device_tokens` (`init.sql:155-160`) | The user |

**High: PII can reach logs.**
- `lead/index.ts:86` logs the full Postgres error on a failed insert. A check-constraint failure includes the
  failing row (name, phone, email) in the error detail.
- `deliver/index.ts:30` and `demo-start/index.ts:73` log raw error objects that can contain phone numbers or emails.
- `lead/index.ts:45-57`: the alert email itself carries the lead's phone; that one is intended.

## 8. Leads and demo data: same project as production?

**Yes, both live in the production project `yyrxjsqhmfoncunjurga`** (`supabase/.temp/linked-project.json`;
`website/index.html:710`).
- High: `leads` is a table in the production database (`20261024000000_leads.sql:5`), written by the public sales
  site.
- High: demo companies are ordinary `orgs` rows with `is_demo = true` (`20261026000000_commission_activity_demo.sql:160`).
  They share production tables, RLS, functions and **production Auth**. `demo-start` creates 5 real
  `auth.users` per visitor with the service role key (`demo-start/index.ts:67-79`), and they count towards
  Auth usage. Keeping demo data apart relies on `is_demo` checks scattered through the code (`_queue_message` `:171-172`,
  `_call_deliver` `:180`, `claim_ai_read` `:198-200`, `demo_fill` `:215`, `demo-switch/index.ts:31-32`).
  Missing one check would let demo activity send real messages or touch real data. Cleanup deletes Auth users in
  production (`commission_activity_demo.sql:280-288`).
- The planned separate demo project (`demo.plotskart.in`) removes this whole class of risk.
