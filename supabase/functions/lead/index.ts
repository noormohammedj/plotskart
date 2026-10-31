// Receives enquiries from the sales page, saves them to `leads`, and emails an alert.
// Deploy with --no-verify-jwt (the page is public). Email is sent through Gmail when
// these secrets are set (Supabase dashboard > Edge Functions > Secrets):
//   ALERT_GMAIL_USER          the Gmail address that sends the alert
//   ALERT_GMAIL_APP_PASSWORD  a Gmail app password for that address
//   ALERT_TO                  where alerts go (comma-separated; defaults to ALERT_GMAIL_USER)
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const PLAN_NAMES: Record<string, string> = {
  solo: 'Free (owner, 2 projects)',
  team: 'Team (₹4,999/month)',
  custom: 'Business (₹9,999/month)',
  unsure: 'Not sure yet',
};

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type Lead = {
  name: string; company: string | null; phone: string; email: string | null; city: string | null;
  plan: string; projects: number | null; message: string | null;
};

async function emailAlert(lead: Lead) {
  const user = Deno.env.get('ALERT_GMAIL_USER');
  const pass = Deno.env.get('ALERT_GMAIL_APP_PASSWORD');
  if (!user || !pass) return 'skipped: Gmail secrets not set';
  const to = Deno.env.get('ALERT_TO') || user;
  const rows: [string, string | number | null][] = [
    ['Name', lead.name], ['Company', lead.company], ['Mobile', lead.phone], ['Email', lead.email],
    ['City', lead.city], ['Plan', PLAN_NAMES[lead.plan]], ['Projects', lead.projects], ['Message', lead.message],
  ];
  const digits = lead.phone.replace(/\D/g, '');
  const wa = `https://wa.me/${digits.length === 10 ? '91' + digits : digits}`;
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass: pass.replace(/\s/g, '') } });
  await transport.sendMail({
    from: `Plotskart enquiries <${user}>`,
    to,
    replyTo: lead.email ?? undefined,
    subject: `New Plotskart enquiry: ${lead.name}${lead.company ? ` (${lead.company})` : ''} · ${PLAN_NAMES[lead.plan]}`,
    text: rows.filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nWhatsApp: ${wa}`,
    html: `<h2 style="font-family:sans-serif">New Plotskart enquiry</h2>
      <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
      ${rows.filter(([, v]) => v != null).map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#566870">${k}</td><td style="padding:4px 0"><b>${esc(String(v))}</b></td></tr>`).join('')}
      </table>
      <p style="font-family:sans-serif"><a href="${wa}">Reply on WhatsApp</a> · <a href="tel:+${digits.length === 10 ? '91' + digits : digits}">Call</a></p>`,
  });
  return 'sent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (b.website) return json({ ok: true }); // hidden field only bots fill in

  const projects = Number(b.projects);
  const lead: Lead = {
    name: text(b.name, 120) ?? '',
    company: text(b.company, 160),
    phone: text(b.phone, 20) ?? '',
    email: text(b.email, 200),
    city: text(b.city, 80),
    plan: typeof b.plan === 'string' && b.plan in PLAN_NAMES ? b.plan : 'unsure',
    projects: b.projects !== '' && b.projects != null && Number.isInteger(projects) && projects >= 0 && projects <= 1000 ? projects : null,
    message: text(b.message, 2000),
  };
  if (lead.name.length < 2) return json({ error: 'Please enter your name.' }, 400);
  if (lead.phone.replace(/\D/g, '').length < 10) return json({ error: 'Please enter a 10-digit mobile number.' }, 400);

  const { error } = await admin.from('leads').insert(lead);
  if (error) {
    console.error('insert failed', error);
    return json({ error: 'Could not save your enquiry.' }, 500);
  }

  let alert = 'not sent';
  try { alert = await emailAlert(lead); } catch (e) { console.error('alert email failed', e); alert = 'failed'; }
  return json({ ok: true, alert });
});
