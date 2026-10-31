// Gives a one-time sign-in token for another person in the caller's own demo company,
// so a visitor can switch between owner, sales and broker views (or open one in a new tab).
// Only works for demo companies.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return json({ error: 'Please restart the demo.' }, 401);

  let member: string;
  try { ({ member } = await req.json()); } catch { return json({ error: 'Invalid request' }, 400); }

  const { data: me } = await admin.from('profiles').select('org_id').eq('id', who.user.id).single();
  if (!me?.org_id) return json({ error: 'Please restart the demo.' }, 401);
  const { data: org } = await admin.from('orgs').select('is_demo').eq('id', me.org_id).single();
  if (!org?.is_demo) return json({ error: 'Switching people only works in the demo.' }, 403);
  const { data: target } = await admin.from('profiles').select('email, org_id').eq('id', member).single();
  if (!target || target.org_id !== me.org_id || !target.email) return json({ error: 'That person is not in this demo.' }, 404);

  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: target.email });
  if (error || !link?.properties?.hashed_token) return json({ error: 'Could not switch.' }, 500);
  return json({ token_hash: link.properties.hashed_token });
});
