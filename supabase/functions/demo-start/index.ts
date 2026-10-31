// Starts a private demo company for a visitor: an owner, two salespeople and a broker, each a real
// sign-in so the visitor can open different roles in different tabs and watch updates arrive live.
// Returns a one-time sign-in token for the owner. Sample projects are added by the app after sign-in.
// A visitor who sends the resume key of a demo still running gets that demo back, without a new company.
// Public (deploy with --no-verify-jwt), so new demos are rate-limited per visitor address and per day.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TEAM = [
  { key: 'owner', name: 'Demo Owner', role: 'owner', rate: 0, type: 'percent', salary: 0, phone: '+91 90000 00100' },
  { key: 'ravi', name: 'Ravi Kumar', role: 'sales', rate: 1.5, type: 'percent', salary: 25000, phone: '+91 90000 00101' },
  { key: 'priya', name: 'Priya Shankar', role: 'sales', rate: 25, type: 'per_sqft', salary: 22000, phone: '+91 90000 00102' },
  { key: 'suresh', name: 'Suresh Babu', role: 'broker', rate: 2, type: 'percent', salary: 0, phone: '+91 90000 00103' },
  { key: 'anita', name: 'Anita Desai', role: 'accountant', rate: 0, type: 'percent', salary: 30000, phone: '+91 90000 00104' },
] as const;

// demo companies are deleted after 3 days; only resume ones with time left
const RESUME_HOURS = 70;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ownerToken(email: string) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  return error ? null : link?.properties?.hashed_token ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let resume = '';
  try { resume = String((await req.json())?.resume ?? ''); } catch { /* no body */ }
  const keyHash = /^[a-z0-9]{20,64}$/.test(resume) ? await sha256(resume) : null;

  if (keyHash) {
    const since = new Date(Date.now() - RESUME_HOURS * 3600e3).toISOString();
    const { data: prev } = await admin.from('demo_resume').select('org_id').eq('key_hash', keyHash).gt('created_at', since).maybeSingle();
    if (prev) {
      const { data: owner } = await admin.from('profiles').select('email').eq('org_id', prev.org_id).eq('role', 'owner').maybeSingle();
      const token = owner?.email ? await ownerToken(owner.email) : null;
      if (token) return json({ token_hash: token, resumed: true });
    }
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const { data: allowed, error: limitErr } = await admin.rpc('demo_allow_start', { p_ip: ip });
  if (limitErr) return json({ error: 'Could not start the demo.' }, 500);
  if (!allowed) return json({ error: 'The demo is very busy today. Please try again in a few hours.' }, 429);

  const id = crypto.randomUUID().slice(0, 8);
  const { data: org, error: orgErr } = await admin.from('orgs').insert({ name: 'Demo Realty', is_demo: true }).select('id').single();
  if (orgErr || !org) return json({ error: 'Could not start the demo.' }, 500);

  const emails: Record<string, string> = {};
  for (const m of TEAM) {
    const email = `${m.key}-${id}@demo.plotskart.in`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { demo: true } });
    if (error || !u.user) {
      console.error('demo user', error);
      return json({ error: 'Could not start the demo.' }, 500);
    }
    // the sign-up trigger has created the bare profile; attach it to the demo company
    await admin.from('profiles').update({
      org_id: org.id, role: m.role, full_name: m.name, phone: m.phone, commission_rate: m.rate, commission_type: m.type,
      monthly_salary: m.salary,
    }).eq('id', u.user.id);
    emails[m.key] = email;
  }
  if (keyHash) await admin.from('demo_resume').upsert({ org_id: org.id, key_hash: keyHash }, { onConflict: 'key_hash' });

  // always the owner first: only the owner can add the sample projects; the app then switches role
  const token = await ownerToken(emails.owner);
  if (!token) return json({ error: 'Could not start the demo.' }, 500);
  return json({ token_hash: token });
});
