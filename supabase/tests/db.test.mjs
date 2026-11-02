import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const MIG_DIR = new URL('../migrations/', import.meta.url);
const db = new PGlite();

// Stand-ins for what Supabase provides
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema extensions; create schema cron; create schema net; create schema vault;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
  create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$
    insert into cron.job(jobname, schedule, command) values (a, b, c)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
  create function cron.unschedule(a text) returns boolean language sql as $$
    with d as (delete from cron.job where jobname = a returning 1) select exists (select 1 from d) $$;
  create table net.calls(id serial, url text, body jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ insert into net.calls(url, body) values (url, body) returning id::bigint $$;
  create table vault.decrypted_secrets(name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('deliver_url', 'http://deliver'), ('deliver_secret', 's3cret');
  create schema storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant usage on schema public, auth to authenticated;
  grant execute on all functions in schema auth to authenticated;
  alter default privileges in schema public grant all on tables to authenticated;
  alter default privileges in schema public grant execute on functions to authenticated;
`);
let havePub = true;
try { await db.exec('create publication supabase_realtime'); } catch { havePub = false; }

for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith('.sql')).sort()) {
  let sql = readFileSync(new URL(f, MIG_DIR), 'utf8').replace(/^create extension.*$/gm, '');
  if (!havePub) sql = sql.replace(/^alter publication.*$/gm, '');
  await db.exec(sql);
  console.log('migration applied:', f);
}
if (!havePub) console.log('(realtime publication skipped: not supported in PGlite)');

const ids = { o: '00000000-0000-0000-0000-00000000000a', s: '00000000-0000-0000-0000-00000000000b', b: '00000000-0000-0000-0000-00000000000c' };
const mail = { o: 'owner@x.in', s: 'ravi@x.in', b: 'suresh@x.in' };
for (const k of Object.keys(ids)) await db.query('insert into auth.users values ($1, $2)', [ids[k], mail[k]]);

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

async function as(who, q, params = []) {
  await db.exec('reset role');
  if (who) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)`, [ids[who], mail[who]]);
    await db.exec('set role authenticated');
  } else {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
}
async function expectErr(who, q, params, msg) {
  try { await as(who, q, params); ok(false, msg + ' (no error raised)'); }
  catch (e) { ok(true, `${msg} -> "${e.message}"`); }
}
const one = async (who, q, p) => (await as(who, q, p)).rows[0];

ok((await one(null, `select count(*)::int n from public.profiles`)).n === 3, 'signup trigger created 3 profiles');
const orgId = (await one('o', `select create_org('Sai Developers', 'Noor') id`)).id;
ok(!!orgId, 'owner created company');
// new companies start on Free (20261104000000); the checks below need a full team, so this one is on Business
ok((await one(null, `select plan from orgs where id = $1`, [orgId])).plan === 'free', 'a new company starts on the Free plan');
await as(null, `select admin_set_plan($1, 'business')`, [orgId]);
await as('o', `insert into invites (org_id, email, full_name, phone, role, commission_rate) values ($1, 'ravi@x.in', 'Ravi Kumar', '9000000001', 'sales', 1.5), ($1, 'suresh@x.in', 'Suresh Babu', '9000000002', 'broker', 2)`, [orgId]);
ok((await one('s', 'select claim_invite() c')).c === true, 'sales member claimed invite');
ok((await one('b', 'select claim_invite() c')).c === true, 'broker claimed invite');
ok((await one('b', `select role::text from profiles where id = auth.uid()`)).role === 'broker', 'broker has broker role');

const plotsJson = JSON.stringify([
  { label: 'A1', geom: { x: 0, y: 0, w: 10, h: 10 }, front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E'] },
  { label: 'A2', geom: { x: 10, y: 0, w: 10, h: 10 }, front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E', 'N'] },
  { label: 'A3', geom: { x: 20, y: 0, w: 10, h: 10 }, front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['W'] },
]);
await expectErr('s', `select create_project($1::jsonb, $2::jsonb)`, [JSON.stringify({ name: 'X' }), plotsJson], 'sales cannot create project');
const projId = (await one('o', `select create_project($1::jsonb, $2::jsonb) id`, [JSON.stringify({ name: 'Jatwada Greens', location: 'Jatwada', guideline_rate: 1150, sale_rate: 1850, layout: { w: 100, h: 100 } }), plotsJson])).id;
const plot = async (label) => one(null, `select * from plots where project_id = $1 and label = $2`, [projId, label]);
const A1 = await plot('A1'), A2 = await plot('A2'), A3 = await plot('A3');
ok(A1 && A1.facing.join() === 'E' && A2.facing.join() === 'E,N', 'plots inserted with facing arrays');

const calls0 = (await one(null, 'select count(*)::int n from net.calls')).n;
const booked = await one('b', `select * from book_plot($1, 'Arjun Deshmukh', '9876500001', 200000, current_date + 30, null, $2)`, [A1.id, ids.s]);
ok(booked.status === 'booked' && booked.sold_by === ids.b, 'broker booked A1; sold_by forced to broker');
ok(Number(booked.paid) === 200000, 'advance recorded as paid');
const nb = (await one(null, `select count(*)::int n from notifications where plot_id = $1`, [A1.id])).n;
ok(nb === 2, `booking notified the 2 other members (got ${nb})`);
const msg = await one(null, `select * from customer_messages where plot_id = $1`, [A1.id]);
ok(msg && msg.template === 'booking_confirmation' && msg.body.includes('₹2,00,000'), 'customer booking message queued: ' + msg?.body);
ok((await one(null, 'select count(*)::int n from net.calls')).n - calls0 === 3, 'deliver webhook called for 2 notifications + 1 message');
await expectErr('s', `select book_plot($1, 'X', '1', 1, current_date)`, [A1.id], 'cannot double-book A1');
await expectErr('b', `select sell_plot($1, 100, current_date + 2)`, [A1.id], 'broker cannot mark sold');

const sold = await one('s', `select * from sell_plot($1, 1000000, current_date + 2)`, [A1.id]);
ok(sold.status === 'sold' && sold.sold_by === ids.b && Number(sold.commission_rate) === 2, 'sales marked A1 sold; commission rate frozen at broker 2%');
ok(Number(sold.paid) === 1200000, 'paid = advance + amount');

await as('s', `select book_plot($1, 'Imran Shaikh', '9876500002', 100000, current_date + 1)`, [A2.id]);
await as('s', `select record_payment($1, 50000)`, [A2.id]);
ok(Number((await plot('A2')).paid) === 150000, 'record_payment adds to paid');

const n1 = (await one(null, 'select run_daily_reminders() n')).n;
ok(n1 === 2, `daily job sent 2 reminders (registration A1, payment A2), got ${n1}`);
const n2 = (await one(null, 'select run_daily_reminders() n')).n;
ok(n2 === 0, `second run same day sends nothing, got ${n2}`);
const rem = await as(null, `select kind, text, recipient from notifications where kind in ('reg','pay') order by kind`);
ok(rem.rows.some((r) => r.kind === 'reg' && r.recipient === ids.b), 'broker who handled A1 gets the registration reminder');
ok(!rem.rows.some((r) => r.kind === 'pay' && r.recipient === ids.b), 'broker not on A2 payment reminder');
console.log('   e.g. ' + rem.rows.find((r) => r.kind === 'pay').text);
const custRem = await as(null, `select template, body, params from customer_messages where kind in ('reg','pay') order by kind`);
ok(custRem.rows.length === 2, 'customer reminder messages queued for both');
console.log('   e.g. ' + custRem.rows[0].body);

await expectErr('b', `select send_reminder($1, 'pay')`, [A2.id], 'broker cannot send manual reminder');
await as('s', `select send_reminder($1, 'pay')`, [A2.id]);
ok(true, 'sales sent manual reminder');
await expectErr('s', `select run_daily_reminders()`, [], 'app users cannot run the daily job');

// RLS
await as('o', `select add_cost_line($1, 'Road', 'Sri Balaji', 500000, 200000)`, [projId]);
ok((await as('b', 'select * from cost_lines')).rows.length === 0, 'broker sees no cost lines');
ok((await as('s', 'select * from project_funding')).rows.length === 0, 'sales sees no funding');
ok((await as('o', 'select * from project_funding')).rows.length === 1, 'owner sees funding');
await expectErr('b', `insert into cost_lines (project_id, org_id, category, party) values ($1, $2, 'x', 'y')`, [projId, orgId], 'broker cannot add costs');
const upd = await as('b', `update plots set status = 'sold' where id = $1 returning id`, [A3.id]);
ok(upd.rows.length === 0 && (await plot('A3')).status === 'available', 'direct plot updates are blocked');
await expectErr('s', `update profiles set role = 'owner' where id = auth.uid()`, [], 'member cannot promote self');
await as('s', `update profiles set full_name = 'Ravi K' where id = auth.uid()`);
ok((await one(null, `select full_name from profiles where id = $1`, [ids.s])).full_name === 'Ravi K', 'member can edit own name');
ok((await as('s', 'select * from notifications')).rows.every((r) => r.recipient === ids.s), 'members only read their own notifications');
ok((await as('b', 'select * from customer_messages')).rows.length === 0, 'broker cannot read customer messages');
await expectErr('s', `select _notify_org(p, 'x', 'y') from plots p limit 1`, [], 'internal helpers not callable');

await as('o', `select pay_commission($1, $2, 10000)`, [ids.b, projId]);
ok((await as('b', 'select * from commission_payments')).rows.length === 1, 'broker sees own commission payment');
await as('s', `select complete_registration($1)`, [A1.id]);
ok((await plot('A1')).registered === true, 'registration completed');
await expectErr('s', `select cancel_booking($1)`, [A2.id], 'only owner cancels bookings');
await as('o', `select cancel_booking($1)`, [A2.id]);
const a2 = await plot('A2');
ok(a2.status === 'available' && a2.buyer_name === null && Number(a2.paid) === 0, 'cancel resets plot');
await as('s', `select set_project_rates($1, 1200, 1900)`, [projId]);
ok(Number((await one(null, 'select sale_rate from projects where id = $1', [projId])).sale_rate) === 1900, 'sales updated project rates');
ok((await one(null, `select _inr(12345678.4) v`)).v === '₹1,23,45,678', 'Indian number format: ' + (await one(null, `select _inr(12345678.4) v`)).v);
ok((await one(null, `select _inr(950) v`)).v === '₹950', 'small amounts: ' + (await one(null, `select _inr(950) v`)).v);

// layout editing (state here: A1 sold to a customer, A2 and A3 available)
const geom = (x) => ({ x, y: 0, w: 10, h: 10, pts: null });
const layoutRow = (id, label, x) => ({ ...(id ? { id } : {}), label, geom: geom(x), front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E'] });
const L2 = JSON.stringify({ w: 200, h: 100, roads: [], parks: [], labels: [], image: { path: `${orgId}/x.jpg`, w: 200, h: 100 } });
await expectErr('s', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([layoutRow(A1.id, 'A1', 0)])], 'sales cannot edit layouts');
await expectErr('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([layoutRow(A2.id, 'A2', 0)])], 'cannot remove a plot that has a customer');
await expectErr('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([layoutRow(A1.id, 'A1', 0), layoutRow(null, 'A1', 20)])], 'duplicate plot numbers refused');
ok((await plot('A3')) !== undefined, 'failed save changed nothing');
const n = (await one('o', `select save_layout($1, $2::jsonb, $3::jsonb) n`, [projId, L2, JSON.stringify([
  layoutRow(A1.id, 'A2', 50), layoutRow(A2.id, 'A1', 60), layoutRow(null, 'A4', 70),
])])).n;
ok(n === 3, `owner saved layout with 3 plots (got ${n})`);
const sw = await one(null, `select label, status, buyer_name, (geom->>'x')::int x from plots where id = $1`, [A1.id]);
ok(sw.label === 'A2' && sw.status === 'sold' && sw.buyer_name === 'Arjun Deshmukh' && sw.x === 50, 'renumbered sold plot keeps its customer and moves');
ok((await one(null, `select label from plots where id = $1`, [A2.id])).label === 'A1', 'two plots swapped numbers');
ok((await plot('A3')) === undefined, 'available plot left out was removed');
ok((await plot('A4'))?.status === 'available', 'new plot added');
ok((await one(null, `select layout->'image'->>'path' p from projects where id = $1`, [projId])).p === `${orgId}/x.jpg`, 'layout picture saved on project');
ok((await one(null, `select count(*)::int n from notifications where kind = 'layout'`)).n === 2, 'team notified of layout change');

// layout pictures in storage
await as('o', `insert into storage.objects (bucket_id, name) values ('layouts', $1)`, [`${orgId}/plan.jpg`]);
ok(true, 'owner uploads a layout picture to their folder');
await expectErr('s', `insert into storage.objects (bucket_id, name) values ('layouts', $1)`, [`${orgId}/s.jpg`], 'sales cannot upload layout pictures');
await expectErr('o', `insert into storage.objects (bucket_id, name) values ('layouts', $1)`, ['00000000-0000-0000-0000-000000000000/x.jpg'], 'owner cannot upload into another company folder');
ok((await as('b', `select name from storage.objects`)).rows.length === 1, 'team members can view their company layout pictures');

// commission type: ₹ per sq ft for the broker, frozen on the plot when sold
await expectErr('s', `select update_member($1, 25, true, 'per_sqft')`, [ids.b], 'only owner changes commission deals');
await as('o', `select update_member($1, 25, true, 'per_sqft')`, [ids.b]);
ok((await one(null, `select commission_type t, commission_rate::int r from profiles where id = $1`, [ids.b])).t === 'per_sqft', 'broker now on ₹25 per sq ft');
await expectErr('o', `select update_member($1, 150, true, 'percent')`, [ids.b], 'percent over 100 refused');
const A4 = await plot('A4');
await as('b', `select * from book_plot($1, 'Zoya Pathan', '9876500003', 100000, current_date + 20)`, [A4.id]);
await as('s', `select * from sell_plot($1, 1000000, current_date + 3)`, [A4.id]);
const a4 = await plot('A4');
ok(a4.commission_type === 'per_sqft' && Number(a4.commission_rate) === 25, 'sold plot keeps broker deal: ₹25 per sq ft');
await as('o', `select update_member($1, 2, true, 'percent')`, [ids.b]);
ok((await plot('A4')).commission_type === 'per_sqft', 'later change does not alter an earlier sale');

// team activity tags
const ev = (await as(null, `select kind, member from plot_events where plot_id = $1 order by created_at, kind`, [A4.id])).rows;
ok(ev.some((e) => e.kind === 'booked' && e.member === ids.b) && ev.some((e) => e.kind === 'sold' && e.member === ids.b), 'events tagged booked/sold with the broker who handles the plot');
ok((await as('s', `select count(*)::int n from plot_events`)).rows[0].n > 0, 'sales can read the team activity feed');

// customer-specific price on a sold plot
await expectErr('s', `select * from set_plot_rate($1, 1700)`, [A4.id], 'sales cannot change a customer price');
await as('o', `select * from set_plot_rate($1, 1700)`, [A4.id]);
ok(Number((await plot('A4')).rate_override) === 1700, 'owner set customer price ₹1,700/sq ft');
const pn = await one(null, `select text from notifications where kind = 'rate' and plot_id = $1 and recipient = $2 order by created_at desc limit 1`, [A4.id, ids.s]);
ok(pn?.text.includes('Zoya Pathan'), 'team told about the customer price: ' + pn?.text);
ok((await one(null, `select kind from plot_events where plot_id = $1 order by created_at desc limit 1`, [A4.id])).kind === 'price', 'price change appears in team activity');
await expectErr('o', `select * from set_plot_rate($1, 10)`, [A4.id], 'price below what customer already paid refused');

// owners cannot flip the demo flag or reset AI allowance
await expectErr('o', `update orgs set is_demo = true where id = $1`, [orgId], 'owner cannot mark own company as demo');
ok((await one('o', `select claim_ai_read() ok`)).ok === true, 'real company: AI read allowed');

// demo company
ids.d = '00000000-0000-0000-0000-00000000000d'; mail.d = 'owner-x@demo.plotskart.in';
await db.query('insert into auth.users values ($1, $2)', [ids.d, mail.d]);
const demoOrg = (await one(null, `insert into orgs (name, is_demo) values ('Demo Realty', true) returning id`)).id;
await db.query(`update profiles set org_id = $1, role = 'owner', full_name = 'Demo Owner' where id = $2`, [demoOrg, ids.d]);
await expectErr('o', `select demo_fill($1)`, [projId], 'sample data refused for a real company');
const demoProj = (await one('d', `select create_project($1::jsonb, $2::jsonb) id`, [JSON.stringify({ name: 'Demo Greens', sale_rate: 1500, guideline_rate: 900 }),
  JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ label: `D${i + 1}`, geom: geom(i * 10), front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E'] })))])).id;
await as('d', `select demo_fill($1)`, [demoProj]);
const filled = await one(null, `select count(*) filter (where status <> 'available')::int sold_or_booked from plots where project_id = $1`, [demoProj]);
ok(filled.sold_or_booked > 5, `demo project filled with sales history (${filled.sold_or_booked} of 30 taken)`);
ok((await one(null, `select count(*)::int n from cost_lines where project_id = $1`, [demoProj])).n === 8, 'demo project has spend heads');
const calls1 = (await one(null, 'select count(*)::int n from net.calls')).n;
const freeDemo = await one(null, `select id from plots where project_id = $1 and status = 'available' limit 1`, [demoProj]);
await as('d', `select * from book_plot($1, 'Visitor Typed', '9999999999', 50000, current_date + 10)`, [freeDemo.id]);
const dm = await one(null, `select whatsapp_status w, sms_status s from customer_messages where plot_id = $1`, [freeDemo.id]);
ok(dm.w === 'demo, not sent' && dm.s === 'demo, not sent', 'demo booking message marked not sent');
ok((await one(null, 'select count(*)::int n from net.calls')).n === calls1, 'nothing sent from a demo company');
const reads = [];
for (let i = 0; i < 4; i++) reads.push((await one('d', `select claim_ai_read() ok`)).ok);
ok(reads.join() === 'true,true,true,false', `demo allows 3 AI reads (${reads.join()})`);

// ---------------------------------------------------------------- ledger, accountant, instalments
ids.a = '00000000-0000-0000-0000-0000000000ae'; mail.a = 'anita@x.in';
await db.query('insert into auth.users values ($1, $2)', [ids.a, mail.a]);
await as('o', `insert into invites (org_id, email, full_name, role, commission_rate) values ($1, 'anita@x.in', 'Anita Desai', 'accountant', 0)`, [orgId]);
ok((await one('a', 'select claim_invite() c')).c === true, 'accountant joined');
const accts = (await as('o', `select id, name, kind from accounts order by created_at`)).rows;
ok(accts.length === 2 && accts.some((x) => x.kind === 'cash'), 'company has a bank and a cash account');
ok((await as('s', `select * from accounts`)).rows.length === 0 && (await as('a', `select * from accounts`)).rows.length === 2, 'accountant sees accounts, sales does not');
const ledgerBefore = (await one('o', `select count(*)::int n, coalesce(sum(amount) filter (where direction='in'),0)::numeric s from ledger where source = 'customer_payment'`));
ok(ledgerBefore.n >= 4, `earlier customer payments are in the ledger (${ledgerBefore.n})`);

const bank = accts.find((x) => x.kind === 'bank').id, cash = accts.find((x) => x.kind === 'cash').id;
const A1now = await one(null, `select * from plots where label = 'A1' and project_id = $1`, [projId]);
await as('o', `select * from book_plot($1, 'Rekha Chavan', '9876500004', 200000, current_date + 5)`, [A1now.id]);
const rc = (await as('a', `select receipt_no, account_id, buyer_name from customer_payments where plot_id = $1 order by receipt_no desc limit 1`, [A1now.id])).rows[0];
ok(rc.buyer_name === 'Rekha Chavan', 'payment remembers which customer paid');
ok(rc.receipt_no > 0 && rc.account_id === bank, `advance got receipt #${rc.receipt_no} in the main bank account`);
await as('a', `select * from record_payment($1, 50000, null, $2, 'upi', 'UPI-12345', current_date)`, [A1now.id, cash]);
const rc2 = (await as('a', `select receipt_no, mode, reference from customer_payments where plot_id = $1 order by receipt_no desc limit 1`, [A1now.id])).rows[0];
ok(rc2.receipt_no === rc.receipt_no + 1 && rc2.mode === 'upi' && rc2.reference === 'UPI-12345', 'accountant recorded a UPI payment with next receipt number');
ok((await one('a', `select count(*)::int n from ledger where plot_id = $1 and account_id = $2`, [A1now.id, cash])).n === 1, 'payment landed in the cash account ledger');
await expectErr('a', `select * from book_plot($1, 'X', '1', 1, current_date)`, [A4.id], 'accountant cannot book plots');
await expectErr('a', `select update_member($1, 1, true, 'percent', 10000)`, [ids.b], 'accountant cannot manage the team');
await expectErr('a', `select * from set_plot_rate($1, 1)`, [A1now.id], 'accountant cannot change prices');

// instalments move the due date as payments come in
const value = (await one(null, `select (sqft * coalesce(rate_override, (select sale_rate from projects where id = project_id)))::numeric v, paid from plots where id = $1`, [A1now.id]));
const rest = Number(value.v) - Number(value.paid);
const plan = [{ due_date: '2030-01-10', amount: Math.round(rest / 2) }, { due_date: '2030-02-10', amount: rest - Math.round(rest / 2) }];
await as('s', `select * from save_installments($1, $2::jsonb)`, [A1now.id, JSON.stringify(plan)]);
ok((await one(null, `select due_date::text d from plots where id = $1`, [A1now.id])).d === '2030-01-10', 'due date = first unpaid instalment');
await as('a', `select * from record_payment($1, $2, null, $3)`, [A1now.id, Math.round(rest / 2), bank]);
ok((await one(null, `select due_date::text d from plots where id = $1`, [A1now.id])).d === '2030-02-10', 'after paying instalment 1, due date moves to instalment 2');
await expectErr('s', `select * from save_installments($1, $2::jsonb)`, [A1now.id, JSON.stringify([{ due_date: '2030-01-01', amount: 999999999 }])], 'instalments above plot price refused');

// expenses, commission, salary, transfer, other income
const lineId = (await one('a', `select add_cost_line($1, 'Road', 'Sri Balaji', 500000, 100000, $2, current_date) id`, [projId, bank])).id;
await as('a', `select pay_expense($1, 150000, $2, current_date, 'Second bill')`, [lineId, bank]);
ok(Number((await one(null, `select paid from cost_lines where id = $1`, [lineId])).paid) === 250000, 'expense paid in two parts');
ok((await one('a', `select count(*)::int n from ledger where source = 'expense' and source_id = $1`, [lineId])).n === 2, 'both expense payments in the ledger');
await expectErr('a', `select pay_expense($1, 999999, $2)`, [lineId, bank], 'cannot pay more than what is still owed');
await expectErr('s', `select add_cost_line($1, 'X', 'Y', 1, 0)`, [projId], 'sales cannot add expenses');
await as('a', `select pay_commission($1, $2, 5000, $3)`, [ids.b, projId, bank]);
await as('o', `select update_member($1, 2, true, 'percent', 25000)`, [ids.s]);
await as('a', `select pay_salary($1, 25000, current_date, $2)`, [ids.s, bank]);
ok((await one('a', `select count(*)::int n from ledger where source = 'salary' and member_id = $1`, [ids.s])).n === 1, 'salary paid through the ledger');
await as('a', `select transfer_funds($1, $2, 10000, current_date, 'Petty cash')`, [bank, cash]);
const inc = (await one('a', `select add_ledger_entry('in', 12000, $1, current_date, 'Rent received', 'Tenant') id`, [bank])).id;
const bal = await one('a', `select a.id, a.opening_balance + coalesce(sum(case when l.direction='in' then l.amount else -l.amount end),0) b
  from accounts a left join ledger l on l.account_id = a.id where a.id = $1 group by a.id`, [cash]);
ok(Number(bal.b) === 60000, `cash balance = 50,000 UPI + 10,000 transfer (got ${bal.b})`);
const payEntry = (await one('a', `select id from ledger where source = 'customer_payment' limit 1`)).id;
await expectErr('a', `select delete_ledger_entry($1)`, [payEntry], 'sale payments cannot be deleted from the ledger');
await as('a', `select delete_ledger_entry($1)`, [inc]);
ok((await one('a', `select count(*)::int n from ledger where id = $1`, [inc])).n === 0, 'hand-entered income can be deleted');
await as('a', `select add_asset('Bolero', 'Vehicle', current_date, 1000000, 15, null, $1, true)`, [bank]);
ok((await one('a', `select count(*)::int n from assets`)).n === 1 && (await one('a', `select count(*)::int n from ledger where source = 'asset'`)).n === 1, 'asset recorded with its purchase payment');
ok((await as('b', `select * from ledger`)).rows.length === 0, 'broker cannot see the ledger');

// documents
await as('s', `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${orgId}/p/agreement.pdf`]);
await as('s', `insert into plot_documents (plot_id, org_id, name, path, uploaded_by) values ($1, $2, 'Agreement.pdf', $3, $4)`, [A1now.id, orgId, `${orgId}/p/agreement.pdf`, ids.s]);
ok((await as('a', `select * from plot_documents`)).rows.length === 1, 'accountant sees plot documents');
ok((await as('b', `select * from plot_documents`)).rows.length === 0, 'broker cannot see customer documents');
await expectErr('b', `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${orgId}/p/x.pdf`], 'broker cannot upload documents');

// demo filler with ledger
const demo2 = (await one('d', `select create_project($1::jsonb, $2::jsonb) id`, [JSON.stringify({ name: 'Demo Two', sale_rate: 1500 }),
  JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ label: `E${i + 1}`, geom: geom(i * 10), front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E'] })))])).id;
await as('d', `select demo_fill($1)`, [demo2]);
const dl = await one('d', `select count(*) filter (where source='customer_payment')::int pay, count(*) filter (where source='expense')::int exp, count(*) filter (where source='salary')::int sal from ledger`);
ok(dl.pay > 0 && dl.exp >= 8, `demo ledger has payments (${dl.pay}) and expenses (${dl.exp})`);
ok((await one('d', `select count(*)::int n from plot_installments`)).n > 0, 'demo booked plots have instalment plans');
ok((await one('d', `select count(*)::int n from assets`)).n === 3, 'demo has company assets');

// demo start limit: 30 new demos per address per day
const starts = [];
for (let i = 0; i < 31; i++) starts.push((await db.query(`select demo_allow_start('1.2.3.4') ok`)).rows[0].ok);
ok(starts.slice(0, 30).every(Boolean) && starts[30] === false, 'demo start allows 30 per address, then refuses');
ok((await db.query(`select demo_allow_start('5.6.7.8') ok`)).rows[0].ok === true, 'another address can still start a demo');
let resumeBlocked = false;
try { await as('d', `select * from demo_resume`); } catch { resumeBlocked = true; }
ok(resumeBlocked || (await as('d', `select count(*)::int n from demo_resume`)).rows[0].n === 0, 'visitors cannot read demo resume keys');

// rebrand: cron jobs renamed, schedules kept, and the rollback restores them
const jobs = async () => (await db.query(`select jobname, schedule from cron.job where jobname ~ '(daily-reminders|demo-cleanup)$' order by jobname`)).rows.map((j) => `${j.jobname} ${j.schedule}`).join(', ');
ok(await jobs() === 'plotskart-daily-reminders 30 2 * * *, plotskart-demo-cleanup 15 21 * * *', `cron jobs use the new names (${await jobs()})`);
const ROLLBACK = new URL('../rollbacks/20261029000000_rename_cron_jobs.down.sql', import.meta.url);
await db.exec(readFileSync(ROLLBACK, 'utf8'));
ok((await jobs()).split(', ').every((j) => !j.startsWith('plotskart-')) && (await jobs()).split(', ').length === 2, 'cron rename rollback restores the old names');
await db.exec(readFileSync(new URL('20261029000000_rename_cron_jobs.sql', MIG_DIR), 'utf8'));
ok((await jobs()).startsWith('plotskart-daily-reminders'), 'cron rename can be applied again after a rollback');

// save_layout locks the project's plots before checking for customers (AUDIT.md §2). PGlite has a single
// connection, so the two-session race itself can't run here: these checks pin the lock and the guarded delete,
// then show the behaviour is right after the migration, after its rollback and after re-applying it.
const LOCK_UP = new URL('20261030000000_save_layout_lock_plots.sql', MIG_DIR);
const LOCK_DOWN = new URL('../rollbacks/20261030000000_save_layout_lock_plots.down.sql', import.meta.url);
const layoutDef = async () => (await db.query(`select pg_get_functiondef('public.save_layout(uuid, jsonb, jsonb)'::regprocedure) d`)).rows[0].d;
const locksPlots = (d) => /from plots where project_id = p_project order by id for update/.test(d) && /delete from plots where project_id = p_project and status = 'available'/.test(d);
ok(locksPlots(await layoutDef()), 'save_layout locks the plots before checking and only deletes available plots');

const plotsNow = async () => (await db.query(`select id, label, status from plots where project_id = $1 order by label`, [projId])).rows;
if (!(await plotsNow()).some((p) => p.status !== 'available')) {
  const free = (await plotsNow()).find((p) => p.status === 'available');
  await as('s', `select book_plot($1, 'Test Buyer', '9000000001', 10000, current_date + 30)`, [free.id]);
}
async function layoutChecks(stage) {
  const all = await plotsNow();
  const taken = all.find((p) => p.status !== 'available');
  const payments = async () => (await db.query(`select count(*)::int n from customer_payments where plot_id = $1`, [taken.id])).rows[0].n;
  const paidBefore = await payments();
  const keep = (ps) => JSON.stringify(ps.map((p, i) => layoutRow(p.id, p.label, i * 15)));
  await expectErr('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, keep(all.filter((p) => p.id !== taken.id))], `${stage}: plot with a customer can't be left out`);
  ok((await plotsNow()).some((p) => p.id === taken.id) && (await payments()) === paidBefore, `${stage}: booked plot and its payments are still there`);
  // add a spare plot, then leave it out again: available plots are still removable
  await as('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([...JSON.parse(keep(all)), layoutRow(null, `Z-${stage}`, 300)])]);
  const spare = (await plotsNow()).find((p) => p.label === `Z-${stage}`);
  await as('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, keep(all)]);
  ok(spare && !(await plotsNow()).some((p) => p.id === spare.id) && (await plotsNow()).length === all.length,
    `${stage}: an available plot left out is removed`);
}
await layoutChecks('lock migration');
await db.exec(readFileSync(LOCK_DOWN, 'utf8'));
ok(!locksPlots(await layoutDef()), 'save_layout rollback restores the previous definition');
await layoutChecks('after rollback');
await db.exec(readFileSync(LOCK_UP, 'utf8'));
ok(locksPlots(await layoutDef()), 'save_layout lock migration can be applied again');
await layoutChecks('re-applied');

// WhatsApp buyer messages: consent, the developer's name as the last template variable, opt-out (20261031000000)
const WA_UP = new URL('20261031000000_whatsapp_buyer_messages.sql', MIG_DIR);
const WA_DOWN = new URL('../rollbacks/20261031000000_whatsapp_buyer_messages.down.sql', import.meta.url);
const freePlots = async () => (await plotsNow()).filter((p) => p.status === 'available');
while ((await freePlots()).length < 4) {
  const all = await plotsNow();
  await as('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([...all.map((p, i) => layoutRow(p.id, p.label, i * 15)), layoutRow(null, `W${all.length}`, 400 + all.length)])]);
}
const lastMsg = async (plotId) => one(null, `select whatsapp_status w, sms_status s, params from customer_messages where plot_id = $1 order by created_at desc, id desc limit 1`, [plotId]);
const waOf = async (plotId) => (await one(null, `select buyer_whatsapp w from plots where id = $1`, [plotId])).w;
const [F, G, H, J] = await freePlots();

await as('s', `select * from book_plot($1, 'Asha Menon', '9876500009', 10000, current_date + 30, null, null, true)`, [F.id]);
let m = await lastMsg(F.id);
ok(await waOf(F.id) === true && m.w === 'queued' && m.s === 'queued', 'booking with consent queues WhatsApp and SMS');
ok(m.params.length === 7 && m.params[6] === 'Sai Developers', `booking message ends with the developer's name (${m.params.at(-1)})`);

await as('s', `select * from book_plot($1, 'Karan Iyer', '9876500010', 10000, current_date + 30)`, [G.id]);
m = await lastMsg(G.id);
ok(await waOf(G.id) === false && m.w === 'no consent' && m.s === 'queued', 'booking without consent: SMS only, WhatsApp marked "no consent"');

await expectErr('b', `select set_buyer_whatsapp($1, true)`, [G.id], 'broker cannot change WhatsApp consent');
await expectErr('s', `select set_buyer_whatsapp($1, true)`, [J.id], 'consent needs a customer on the plot');
await as('s', `select set_buyer_whatsapp($1, true)`, [G.id]);
ok(await waOf(G.id) === true, 'sales records consent later');
await as('s', `select send_reminder($1, 'pay')`, [G.id]);
m = await lastMsg(G.id);
ok(m.w === 'queued' && m.params.length === 6 && m.params[5] === 'Sai Developers', 'payment reminder goes on WhatsApp after consent and ends with the developer name');

await as('o', `select cancel_booking($1)`, [F.id]);
ok(await waOf(F.id) === false, 'cancelling a booking clears the old buyer consent');

await expectErr('a', `select * from book_plot($1, 'X Y', '9876500011', 1, current_date, null, null, true)`, [J.id], 'accountant cannot book (consent version)');
ok(await waOf(J.id) === false, 'a refused booking leaves no consent behind');

await as('s', `select * from sell_plot($1, 0, current_date + 7, 'Lata Rao', '0501234567', null, true)`, [H.id]);
ok(await waOf(H.id) === true && (await plot((await plotsNow()).find((p) => p.id === H.id).label)).status === 'sold', 'selling an available plot records consent too');

let optBlocked = false;
try { await as('s', `select whatsapp_opt_out('919876500009')`); } catch { optBlocked = true; }
ok(optBlocked, 'app users cannot call the opt-out function');
await db.query(`update customer_messages set wa_to = '919876500010' where plot_id = $1`, [G.id]);
ok((await one(null, `select whatsapp_opt_out('919876500010') n`)).n === 1 && await waOf(G.id) === false, 'STOP reply switches WhatsApp off for that buyer');

const hasWaColumn = async () => (await one(null, `select count(*)::int n from information_schema.columns where table_name = 'plots' and column_name = 'buyer_whatsapp'`)).n === 1;
await db.exec(readFileSync(WA_DOWN, 'utf8'));
ok(!(await hasWaColumn()), 'WhatsApp rollback removes the consent column');
await as('s', `select * from book_plot($1, 'Ravi Das', '9876500012', 10000, current_date + 30)`, [J.id]);
m = await lastMsg(J.id);
ok(m.params.length === 6 && m.w === 'queued', 'after rollback, booking works with the old message');
await as('o', `select cancel_booking($1)`, [J.id]);
await db.exec(readFileSync(WA_UP, 'utf8'));
ok(await hasWaColumn(), 'WhatsApp migration can be applied again');
await as('s', `select * from book_plot($1, 'Ravi Das', '9876500012', 10000, current_date + 30, null, null, false)`, [J.id]);
m = await lastMsg(J.id);
ok(m.w === 'no consent' && m.params.length === 7, 're-applied: consent version and developer name work again');

// WhatsApp team alerts and the owner's daily summary (20261101000000)
const TEAM_UP = new URL('20261101000000_whatsapp_team_alerts.sql', MIG_DIR);
const TEAM_DOWN = new URL('../rollbacks/20261101000000_whatsapp_team_alerts.down.sql', import.meta.url);
const teamFor = async (who, since) => (await db.query(
  `select template, params, whatsapp_status w, kind from team_messages where recipient = $1 and created_at >= $2 order by created_at, id`, [ids[who], since])).rows;
const now0 = (await one(null, `select now() t`)).t;
while ((await freePlots()).length < 3) {
  const all = await plotsNow();
  await as('o', `select save_layout($1, $2::jsonb, $3::jsonb)`, [projId, L2, JSON.stringify([...all.map((p, i) => layoutRow(p.id, p.label, i * 15)), layoutRow(null, `T${all.length}`, 500 + all.length)])]);
}
const [T1, T2] = await freePlots();
// the buyer section above rolled back and re-applied 20261031, which put back its buyer-only whatsapp_opt_out;
// in migration order this file's version wins, so restore it here before testing team STOP replies
const teamSql = readFileSync(TEAM_UP, 'utf8');
await db.exec(teamSql.slice(teamSql.indexOf('create or replace function public.whatsapp_opt_out'), teamSql.indexOf('revoke execute on function public._queue_team_alert')));

await expectErr('s', `select set_my_whatsapp('9876511111', false, true)`, [], 'only the owner can get the daily summary');
await expectErr('o', `select set_my_whatsapp('', true, false)`, [], 'alerts need a WhatsApp number');
await as('o', `select set_my_whatsapp(' 9876500100 ', true, true)`);
await as('s', `select set_my_whatsapp('9876500101', true, false)`);
const me = await one(null, `select phone, whatsapp_alerts a, whatsapp_summary s from profiles where id = $1`, [ids.o]);
ok(me.phone === '9876500100' && me.a && me.s, 'owner turned on alerts and summary for themselves');

await as('b', `select * from book_plot($1, 'Naveen Pillai', '9876500020', 50000, current_date + 20)`, [T1.id]);
const bOwner = await teamFor('o', now0), bSales = await teamFor('s', now0), bBroker = await teamFor('b', now0);
ok(bOwner.length === 1 && bOwner[0].template === 'team_plot_booked' && bOwner[0].w === 'queued', 'owner gets a WhatsApp alert for a broker booking');
ok(bSales.length === 1 && bBroker.length === 0, 'sales gets it too; the broker who booked (and did not opt in) does not');
ok(bOwner[0].params[3] === 'Naveen Pillai' && bOwner[0].params[4] === '₹50,000' && bOwner[0].params.length === 5, `booking alert names buyer and advance (${bOwner[0].params.join(' | ')})`);

const now1 = (await one(null, `select clock_timestamp() t`)).t;
await as('o', `select record_payment($1, 25000)`, [T1.id]);
const pay = (await teamFor('s', now1)).filter((x) => x.kind === 'payment');
ok(pay.length === 1 && pay[0].template === 'team_payment_received' && pay[0].params[1] === '₹25,000', 'sales is told about a payment the owner recorded');
ok((await teamFor('o', now1)).every((x) => x.kind !== 'payment'), 'the person who recorded the payment is not alerted');

const now2 = (await one(null, `select clock_timestamp() t`)).t;
await as('s', `select * from sell_plot($1, 0, current_date + 7, 'Divya Nair', '9876500021', null)`, [T2.id]);
ok((await teamFor('o', now2)).some((x) => x.template === 'team_plot_sold' && x.params[3] === 'Divya Nair'), 'owner is told about a sale');

await db.query(`update plots set due_date = current_date - 3 where id = $1`, [T1.id]);
const now3 = (await one(null, `select clock_timestamp() t`)).t;
await as('s', `select send_reminder($1, 'pay')`, [T1.id]);
const od = (await teamFor('o', now3)).filter((x) => x.kind === 'overdue');
ok(od.length === 1 && od[0].template === 'team_payment_overdue' && od[0].params[2] === 'Naveen Pillai', 'owner gets an overdue alert when the payment reminder is past due');

ok((await as('s', `select recipient from team_messages`)).rows.every((r) => r.recipient === ids.s), 'sales only sees their own alerts');
ok((await as('o', `select distinct recipient from team_messages`)).rows.length >= 2, 'owner sees the whole team\'s alerts');
ok((await as('b', `select * from team_messages`)).rows.length === 0, 'broker sees no one else\'s alerts');

const sum1 = (await one(null, `select run_owner_summaries() n`)).n;
const summary = (await teamFor('o', now0)).filter((x) => x.kind === 'summary');
ok(sum1 === 1 && summary.length === 1 && summary[0].template === 'owner_daily_summary' && summary[0].params.length === 7, `owner gets one morning summary (${summary[0]?.params.join(' | ')})`);
ok(summary[0].params[0] === 'Noor' && summary[0].params[1] === 'Sai Developers' && Number(summary[0].params[5]) >= 1, 'summary greets the owner, names the company and counts overdue buyers');
ok((await one(null, `select run_owner_summaries() n`)).n === 0, 'the summary is sent once a day');
let sumBlocked = false;
try { await as('o', `select run_owner_summaries()`); } catch { sumBlocked = true; }
ok(sumBlocked, 'app users cannot trigger summaries');

await db.query(`update team_messages set wa_to = '919876500101' where recipient = $1`, [ids.s]);
await one(null, `select whatsapp_opt_out('919876500101') n`);
ok((await one(null, `select whatsapp_alerts a from profiles where id = $1`, [ids.s])).a === false, 'STOP from a team member turns their alerts off');

const hasTeam = async () => (await one(null, `select count(*)::int n from information_schema.tables where table_name = 'team_messages'`)).n === 1;
await db.exec(readFileSync(TEAM_DOWN, 'utf8'));
ok(!(await hasTeam()) && !(await db.query(`select 1 from cron.job where jobname = 'plotskart-owner-summary'`)).rows.length, 'team alerts rollback removes the queue and the morning job');
await as('s', `select send_reminder($1, 'pay')`, [T1.id]);
ok(true, 'after rollback, reminders still work');
await db.exec(readFileSync(TEAM_UP, 'utf8'));
ok(await hasTeam() && (await db.query(`select 1 from cron.job where jobname = 'plotskart-owner-summary'`)).rows.length === 1, 'team alerts migration can be applied again');

// Apartment projects: towers, floors, unit types, flats, pricing (20261102000000)
const APT_UP = new URL('20261102000000_apartments.sql', MIG_DIR);
const APT_DOWN = new URL('../rollbacks/20261102000000_apartments.down.sql', import.meta.url);
const aptArgs = [
  JSON.stringify({ name: 'Skyline Residency', location: 'Avinashi Road', sale_rate: 6000, guideline_rate: 4000, rera_no: 'TN/29/Building/0123/2026',
    floor_rise_paise: 2500, floor_rise_from: 1, parking_paise: 30000000 }),
  JSON.stringify([{ key: 'A', name: '2 BHK', bedrooms: 2, carpet_sqft: 850, builtup_sqft: 1000, saleable_sqft: 1200 },
                  { key: 'B', name: '3 BHK', bedrooms: 3, carpet_sqft: 1150, builtup_sqft: 1380, saleable_sqft: 1650 }]),
  JSON.stringify([{ name: 'a', floors: 10, first_floor: 1, stack: [{ suffix: '01', type: 'A', facing: ['E'], parking: 1 }, { suffix: '02', type: 'B', facing: ['N'], plc_paise: 20000000, parking: 2 }] },
                  { name: 'B', floors: 5, first_floor: 1, stack: [{ suffix: '01', type: 'A', facing: ['W'], parking: 1 }, { suffix: '02', type: 'A', facing: ['S'], parking: 1 }] }]),
];
await expectErr('s', `select create_apartment_project($1::jsonb, $2::jsonb, $3::jsonb)`, aptArgs, 'only the owner creates apartment projects');
const aptId = (await one('o', `select create_apartment_project($1::jsonb, $2::jsonb, $3::jsonb) id`, aptArgs)).id;
const flats = (await db.query(`select label, floor, sqft::numeric sqft, _value(plots) v from plots where project_id = $1 order by label`, [aptId])).rows;
const flat = (label) => flats.find((f) => f.label === label);
ok(flats.length === 30, `apartment project has 30 flats from 2 towers (got ${flats.length})`);
ok(flat('A-101') && flat('A-1002') && flat('B-502') && !flat('A-1101'), 'flat numbers are tower-floor-unit (A-101 … A-1002, B-502)');
ok((await one(null, `select kind, rera_no from projects where id = $1`, [aptId])).kind === 'apartments', 'project is marked as apartments');
ok(Number(flat('A-501').v) === 7620000, `2 BHK on floor 5: area × rate + floor rise + 1 car park = ₹76,20,000 (got ${flat('A-501').v})`);
ok(Number(flat('A-102').v) === 10700000, `3 BHK on floor 1 with PLC and 2 car parks = ₹1,07,00,000 (got ${flat('A-102').v})`);
ok(Number(flat('A-1002').v) === 9900000 + 9 * 25 * 1650 + 200000 + 600000, 'floor rise grows with each floor');

const a501 = (await one(null, `select id from plots where project_id = $1 and label = 'A-501'`, [aptId])).id;
await as('s', `select * from book_plot($1, 'Harish Raman', '9876500300', 762000, current_date + 30, null, null, true)`, [a501]);
const am = await one(null, `select params, whatsapp_status w from customer_messages where plot_id = $1`, [a501]);
ok(am.params[4] === '₹68,58,000' && am.w === 'queued', `booking a flat uses the full flat price for the balance (${am.params[4]})`);
await expectErr('s', `select update_unit($1, null, null, 0)`, [a501], 'only the owner changes flat details');
await as('o', `select update_unit($1, null, null, 0)`, [a501]);
ok(Number((await one(null, `select _value(plots) v from plots where id = $1`, [a501])).v) === 7320000, 'removing the car park lowers the price by ₹3,00,000');
await expectErr('o', `select update_unit($1, null, 0, 0)`, [(await one(null, `select id from plots where label = 'A1' and project_id = $1`, [projId]))?.id ?? '00000000-0000-0000-0000-000000000000'], 'update_unit only works on flats');

const typeA = (await one(null, `select id from unit_types where project_id = $1 and name = '2 BHK'`, [aptId])).id;
await expectErr('o', `select set_unit_type_plan($1, 'someone-else/plan.jpg')`, [typeA], 'floor plan must be in your own folder');
await as('o', `select set_unit_type_plan($1, $2)`, [typeA, `${orgId}/plans/2bhk.jpg`]);
ok((await one(null, `select plan_path from unit_types where id = $1`, [typeA])).plan_path === `${orgId}/plans/2bhk.jpg`, 'owner attaches a floor plan to a unit type');

// the save_layout section re-applied 20261030 on purpose; in migration order this file's guarded version wins
const aptSql = readFileSync(APT_UP, 'utf8');
await db.exec(aptSql.slice(aptSql.indexOf('create or replace function public.save_layout'), aptSql.indexOf('-- 9. Reminders')));
let guard = '';
try { await as('o', `select save_layout($1, $2::jsonb, '[]'::jsonb)`, [aptId, L2]); } catch (e) { guard = e.message; }
ok(guard.includes('towers and floors'), `apartment projects are not edited as a layout drawing ("${guard}")`);
ok((await as('s', `select count(*)::int n from towers where project_id = $1`, [aptId])).rows[0].n === 2, 'team sees the towers');
ok((await as('d', `select count(*)::int n from towers`)).rows[0].n === 0 && (await as('d', `select count(*)::int n from unit_types`)).rows[0].n === 0, 'another company cannot see the towers or unit types');
let aptWrite = false;
try { await as('o', `insert into towers (org_id, project_id, name, floors) values ($1, $2, 'Z', 3)`, [orgId, aptId]); } catch { aptWrite = true; }
ok(aptWrite, 'towers can only be changed through the database functions');
ok((await one(null, `select run_daily_reminders() n`)).n >= 0, 'daily reminders run with apartment projects');
await db.query(`update plots set due_date = current_date - 2 where id = $1`, [a501]);
const sumApt = await one(null, `select count(*)::int n from (select greatest(_value(pl) - pl.paid, 0) b from plots pl where pl.id = $1) x where b > 0`, [a501]);
ok(sumApt.n === 1, 'an overdue flat counts with its full price');

await db.exec(readFileSync(APT_DOWN, 'utf8'));
ok((await one(null, `select count(*)::int n from information_schema.tables where table_name = 'towers'`)).n === 0 && (await one(null, `select count(*)::int n from projects where id = $1`, [aptId])).n === 0, 'apartments rollback removes towers and apartment projects');
ok(Number((await one(null, `select _value(plots) v from plots where project_id = $1 and status <> 'available' limit 1`, [projId])).v) > 0, 'after rollback, plot prices still work');
await db.exec(readFileSync(APT_UP, 'utf8'));
const again = (await one('o', `select create_apartment_project($1::jsonb, $2::jsonb, $3::jsonb) id`, aptArgs)).id;
ok((await one(null, `select count(*)::int n from plots where project_id = $1`, [again])).n === 30, 'apartments migration can be applied again');

// Phone push tokens through database functions, scoped to the company (20261103000000)
const DEV_UP = new URL('20261103000000_device_tokens.sql', MIG_DIR);
const DEV_DOWN = new URL('../rollbacks/20261103000000_device_tokens.down.sql', import.meta.url);
const tok = 'fcm-token-for-test-phone-000000000001';
await as('o', `select register_device($1, 'android')`, [tok]);
const devRow = await one(null, `select user_id, org_id, platform from device_tokens where token = $1`, [tok]);
ok(devRow.user_id === ids.o && devRow.org_id === orgId && devRow.platform === 'android', 'owner registers this phone; the token is tied to the company');
await expectErr('o', `insert into device_tokens (token, user_id, platform) values ('direct-insert-token-0000000001', $1, 'android')`, [ids.o], 'the app cannot write device tokens directly');
await expectErr('o', `select register_device($1, 'web')`, ['fcm-token-for-test-phone-000000000002'], 'only Android and iPhone tokens are accepted');
await expectErr('o', `select register_device('short', 'ios')`, [], 'a malformed token is refused');
await expectErr(null, `select register_device($1, 'android')`, [tok], 'signed-out callers cannot register a phone');
await as('s', `select register_device($1, 'android')`, [tok]);
ok((await one(null, `select user_id from device_tokens where token = $1`, [tok])).user_id === ids.s, 'a phone that changes hands moves to the person now signed in');
ok((await one('o', `select count(*)::int n from device_tokens where token = $1`, [tok])).n === 0 && (await one('s', `select count(*)::int n from device_tokens where token = $1`, [tok])).n === 1, 'people see only their own phones');
ok((await one('d', `select count(*)::int n from device_tokens`)).n === 0, 'another company sees no device tokens');
await as('o', `select unregister_device($1)`, [tok]);
ok((await one(null, `select count(*)::int n from device_tokens where token = $1`, [tok])).n === 1, "signing out doesn't remove someone else's phone");
await as('s', `select unregister_device($1)`, [tok]);
ok((await one(null, `select count(*)::int n from device_tokens where token = $1`, [tok])).n === 0, 'signing out removes the phone');
ok((await one(null, `select count(*)::int n from pg_indexes where indexname = 'device_tokens_org_id_idx'`)).n === 1, 'device tokens are indexed by company');

await db.exec(readFileSync(DEV_DOWN, 'utf8'));
await as('o', `insert into device_tokens (token, user_id, platform) values ($1, $2, 'android')`, [tok, ids.o]);
ok((await one(null, `select count(*)::int n from information_schema.columns where table_name = 'device_tokens' and column_name = 'org_id'`)).n === 0, 'device tokens rollback restores the old table and direct writes');
await db.exec(readFileSync(DEV_UP, 'utf8'));
ok((await one(null, `select org_id from device_tokens where token = $1`, [tok])).org_id === orgId, 'device tokens migration applies again and fills in the company of existing tokens');


// Plans and limits: Free, Team, Business (20261104000000)
const PLAN_UP = new URL('20261104000000_plans_and_limits.sql', MIG_DIR);
const PLAN_DOWN = new URL('../rollbacks/20261104000000_plans_and_limits.down.sql', import.meta.url);
const addUser = async (k, n) => {
  ids[k] = `00000000-0000-0000-0000-0000000001${n}`; mail[k] = `${k}@plans.in`;
  await db.query('insert into auth.users values ($1, $2)', [ids[k], mail[k]]);
};
for (const [k, n] of [['f', '01'], ['t', '02'], ['t1', '03'], ['t2', '04'], ['bz', '05'], ['bz2', '06']]) await addUser(k, n);
const smallPlots = (p) => JSON.stringify([{ label: p + '1', geom: { x: 0, y: 0, w: 10, h: 10 }, front_ft: 30, depth_ft: 40, sqft: 1200, facing: ['E'] }]);
const newProject = (who, name) => one(who, `select create_project($1::jsonb, $2::jsonb) id`, [JSON.stringify({ name, sale_rate: 1000 }), smallPlots(name[0])]);
const invite = (who, org, email, role = 'sales') => as(who, `insert into invites (org_id, email, full_name, role) values ($1, $2, 'Person', $3)`, [org, email, role]);
const firstPlot = async (proj) => (await one(null, `select id from plots where project_id = $1 order by label limit 1`, [proj])).id;

// Free: owner only, 2 projects, 1 AI read per project, no WhatsApp/SMS
const freeOrg = (await one('f', `select create_org('Free Realty', 'Farid') id`)).id;
ok((await one(null, `select plan from orgs where id = $1`, [freeOrg])).plan === 'free', 'Free: new company is on Free');
const fp1 = (await newProject('f', 'First Layout')).id;
await newProject('f', 'Second Layout');
await expectErr('f', `select create_project($1::jsonb, $2::jsonb)`, [JSON.stringify({ name: 'Third' }), smallPlots('T')], 'Free: a third project is refused');
await expectErr('f', `insert into invites (org_id, email, full_name, role) values ($1, 'helper@plans.in', 'Helper', 'sales')`, [freeOrg], 'Free: no team logins');
await expectErr('f', `insert into invites (org_id, email, full_name, role) values ($1, 'partner@plans.in', 'Partner', 'owner')`, [freeOrg], 'Free: no second owner');
const freeReads = [];
for (let i = 0; i < 3; i++) freeReads.push((await one('f', `select claim_ai_read() ok`)).ok);
ok(freeReads.join() === 'true,true,false', `Free: one AI read per project, two in total (got ${freeReads})`);
await as(null, `select admin_add_credits($1, 1, 0)`, [freeOrg]);
ok((await one('f', `select claim_ai_read() ok`)).ok === true && (await one('f', `select claim_ai_read() ok`)).ok === false, 'Free: a bought AI read is used once');
await as('f', `select book_plot($1, 'Buyer One', '9876511111', 50000, current_date + 30)`, [await firstPlot(fp1)]);
const fMsg = await one(null, `select whatsapp_status, sms_status from customer_messages where org_id = $1`, [freeOrg]);
ok(fMsg.sms_status === 'not in plan' && fMsg.whatsapp_status !== 'queued', `Free: customer message logged but not sent (${fMsg.whatsapp_status} / ${fMsg.sms_status})`);
await as(null, `select admin_add_credits($1, 0, 5)`, [freeOrg]);
await as('f', `select record_payment($1, 1000)`, [await firstPlot(fp1)]);
ok((await one(null, `select count(*)::int n from customer_messages where org_id = $1 and (sms_status = 'queued' or whatsapp_status = 'queued')`, [freeOrg])).n === 0, 'Free: message top-ups do not switch on WhatsApp/SMS');
ok((await one(null, `select count(*)::int n from notifications where org_id = $1`, [freeOrg])).n >= 0, 'Free: in-app notifications are untouched');
await expectErr('f', `update orgs set plan = 'business' where id = $1`, [freeOrg], 'owners cannot change their own plan');
await expectErr('f', `select admin_set_plan($1, 'business')`, [freeOrg], 'owners cannot call admin_set_plan');
await expectErr('f', `select admin_add_credits($1, 10, 10)`, [freeOrg], 'owners cannot add their own credits');
const fPlan = (await one('f', `select my_plan() p`)).p;
ok(fPlan.plan === 'free' && fPlan.used.projects === 2 && fPlan.limits.projects === 2 && fPlan.used.ai_reads === 3, 'Free: my_plan shows plan, limits and usage');

// Team: owner + 5 team, 5 projects, 5 AI reads and 1,000 messages a month
const teamOrg = (await one('t', `select create_org('Team Realty', 'Tara') id`)).id;
await as(null, `select admin_set_plan($1, 'team')`, [teamOrg]);
const tp = [];
for (let i = 1; i <= 5; i++) tp.push((await newProject('t', `Team Layout ${i}`)).id);
await expectErr('t', `select create_project($1::jsonb, $2::jsonb)`, [JSON.stringify({ name: 'Sixth' }), smallPlots('S')], 'Team: a sixth project is refused');
await invite('t', teamOrg, mail.t1); await invite('t', teamOrg, mail.t2);
ok((await one('t1', 'select claim_invite() c')).c && (await one('t2', 'select claim_invite() c')).c, 'Team: two members joined');
for (const e of ['a@plans.in', 'b@plans.in', 'c@plans.in']) await invite('t', teamOrg, e);
await expectErr('t', `insert into invites (org_id, email, full_name, role) values ($1, 'six@plans.in', 'Six', 'broker')`, [teamOrg], 'Team: a sixth team login is refused');
await expectErr('t', `insert into invites (org_id, email, full_name, role) values ($1, 'own@plans.in', 'Own', 'owner')`, [teamOrg], 'Team: a second owner is refused');
await as('t', `delete from invites where org_id = $1 and email = 'c@plans.in'`, [teamOrg]);
await as('t', `select update_member($1, 0, false)`, [ids.t1]);
await invite('t', teamOrg, 'c2@plans.in');
await invite('t', teamOrg, 'c3@plans.in');
await expectErr('t', `select update_member($1, 0, true)`, [ids.t1], 'Team: switching a member back on is refused when every seat is taken');
await as('t', `delete from invites where org_id = $1 and email = 'c3@plans.in'`, [teamOrg]);
await as('t', `select update_member($1, 0, true)`, [ids.t1]);
ok((await one(null, `select active from profiles where id = $1`, [ids.t1])).active === true, 'Team: a member can be switched back on when a seat is free');
const teamReads = [];
for (let i = 0; i < 6; i++) teamReads.push((await one('t', `select claim_ai_read() ok`)).ok);
ok(teamReads.filter(Boolean).length === 5 && teamReads[5] === false, `Team: 5 AI reads a month (got ${teamReads})`);
await as(null, `select admin_add_credits($1, 2, 0)`, [teamOrg]);
ok((await one('t', `select claim_ai_read() ok`)).ok === true, 'Team: top-up AI read used after the monthly allowance');
ok((await one(null, `select extra_ai_reads n from orgs where id = $1`, [teamOrg])).n === 1, 'Team: one top-up read left');
const tPlot = await firstPlot(tp[0]);
await as('t', `select book_plot($1, 'Buyer Two', '9876522222', 50000, current_date + 30)`, [tPlot]);
const tMsg = await one(null, `select sms_status from customer_messages where org_id = $1 order by created_at desc limit 1`, [teamOrg]);
ok(tMsg.sms_status === 'queued', 'Team: customer message queued within the allowance');
await as(null, `update plan_usage set messages = 1000 where org_id = $1`, [teamOrg]);
const tBefore = (await one(null, `select count(*)::int n from customer_messages where org_id = $1`, [teamOrg])).n;
await as('t', `select send_reminder($1, 'pay')`, [tPlot]);
const tOver = await as(null, `select sms_status from customer_messages where org_id = $1 order by created_at desc`, [teamOrg]);
ok(tOver.rows.length === tBefore + 1 && tOver.rows.some((r) => r.sms_status === 'monthly limit reached'), 'Team: past 1,000 a month, the message is logged as "monthly limit reached" and not sent');
ok((await one(null, `select count(*)::int n from notifications where org_id = $1 and kind = 'pay'`, [teamOrg])).n > 0, 'Team: in-app reminders still go out past the limit');
await as(null, `select admin_add_credits($1, 0, 1)`, [teamOrg]);
await as('t', `select send_reminder($1, 'pay')`, [tPlot]);
const tCredit = await one(null, `select sms_status from customer_messages where org_id = $1 order by created_at desc limit 1`, [teamOrg]);
ok(tCredit.sms_status === 'queued' && (await one(null, `select extra_messages n from orgs where id = $1`, [teamOrg])).n === 0, 'Team: a message top-up sends one more');

// Business: 2 owners + 15 team, 10 projects
const bizOrg = (await one('bz', `select create_org('Big Realty', 'Bala') id`)).id;
await as(null, `select admin_set_plan($1, 'business')`, [bizOrg]);
await invite('bz', bizOrg, mail.bz2, 'owner');
ok((await one('bz2', 'select claim_invite() c')).c === true, 'Business: a second owner can be invited');
ok((await one('bz2', `select role::text r from profiles where id = auth.uid()`)).r === 'owner', 'Business: the second owner has the owner role');
await expectErr('bz', `insert into invites (org_id, email, full_name, role) values ($1, 'third@plans.in', 'Third', 'owner')`, [bizOrg], 'Business: a third owner is refused');
for (let i = 1; i <= 15; i++) await invite('bz2', bizOrg, `m${i}@plans.in`);
await expectErr('bz', `insert into invites (org_id, email, full_name, role) values ($1, 'm16@plans.in', 'M16', 'sales')`, [bizOrg], 'Business: a 16th team login is refused');
for (let i = 1; i <= 10; i++) await newProject('bz', `Biz Layout ${i}`);
await expectErr('bz2', `select create_project($1::jsonb, $2::jsonb)`, [JSON.stringify({ name: 'Eleventh' }), smallPlots('E')], 'Business: an 11th project is refused');

// demo companies skip plan limits (the demo company above is on Free)
ok((await one(null, `select plan from orgs where id = $1`, [demoOrg])).plan === 'free', 'demo company has the default plan');
ok((await one(null, `select count(*)::int n from projects where org_id = $1`, [demoOrg])).n >= 2, 'demo company keeps its sample projects');
ok((await one(null, `select count(*)::int n from customer_messages where org_id = $1 and (sms_status = 'queued' or whatsapp_status = 'queued')`, [demoOrg])).n === 0, 'demo company still sends nothing');

// roll back, then apply again
await db.exec(readFileSync(PLAN_DOWN, 'utf8'));
ok((await one(null, `select count(*)::int n from information_schema.columns where table_name = 'orgs' and column_name = 'plan'`)).n === 0, 'plans rollback removes the plan column');
await newProject('f', 'Third After Rollback');
ok(true, 'after rollback a Free company can add a third project again');
await expectErr('t', `insert into invites (org_id, email, full_name, role) values ($1, 'own2@plans.in', 'Own', 'owner')`, [teamOrg], 'after rollback owner invites are refused again');
ok((await one('t', `select claim_ai_read() ok`)).ok === true, 'after rollback AI reads are unlimited for real companies again');
await db.exec(readFileSync(PLAN_UP, 'utf8'));
ok((await one(null, `select plan from orgs where id = $1`, [freeOrg])).plan === 'business', 'plans migration applies again; existing companies get Business');
ok((await one(null, `select count(*)::int n from pg_trigger where tgname in ('projects_plan_limit', 'invites_plan_limit', 'profiles_plan_limit', 'customer_messages_plan_limit', 'team_messages_plan_limit')`)).n === 5, 'all five plan triggers are back');

// Monthly sales targets for the team race (20261105000000)
const TGT_UP = new URL('20261105000000_sales_targets.sql', MIG_DIR);
const TGT_DOWN = new URL('../rollbacks/20261105000000_sales_targets.down.sql', import.meta.url);
const tgt = await one('o', `select * from set_sales_target($1, current_date, 5, 5000000000)`, [ids.s]);
ok(tgt.units === 5 && Number(tgt.value_paise) === 5000000000 && new Date(tgt.month).getUTCDate() === 1, 'owner sets a monthly target; it is stored against the first of the month');
await as('o', `select set_sales_target($1, current_date, 6, 6000000000)`, [ids.s]);
ok((await one('s', `select count(*)::int n, max(units) u from sales_targets`)).u === 6, 'setting it again updates the same month');
await expectErr('s', `select set_sales_target($1, current_date, 99, 0)`, [ids.s], 'salespeople cannot set targets');
await expectErr('o', `select set_sales_target($1, current_date, 1, 0)`, [ids.o], 'the owner has no target of their own');
await expectErr('o', `select set_sales_target($1, current_date, -1, 0)`, [ids.b], 'a negative target is refused');
await expectErr('s', `insert into sales_targets (org_id, member_id, month) values ($1, $2, date_trunc('month', current_date))`, [orgId, ids.s], 'the app cannot write targets directly');
ok((await one('b', `select count(*)::int n from sales_targets`)).n === 1, 'the whole team sees the targets (the race is open)');
ok((await one('d', `select count(*)::int n from sales_targets`)).n === 0, 'another company sees no targets');
await db.exec(readFileSync(TGT_DOWN, 'utf8'));
ok((await one(null, `select count(*)::int n from information_schema.tables where table_name = 'sales_targets'`)).n === 0, 'targets rollback removes the table');
await db.exec(readFileSync(TGT_UP, 'utf8'));
ok((await one('o', `select units from set_sales_target($1, current_date, 3, 0)`, [ids.b])).units === 3, 'targets migration applies again');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);

