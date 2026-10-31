// Reads a layout drawing (photo or rendered PDF page already uploaded to the `layouts` bucket)
// with Claude and returns a draft plot list for the owner to review in the layout editor.
// Owner-only: the caller's Supabase session is checked, and the file must sit in their org folder.
// Needs the ANTHROPIC_API_KEY secret (Supabase dashboard > Edge Functions > Secrets).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { readLayoutImage } from '../_shared/layoutReader.ts';

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

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Please sign in again.' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const [{ data: role }, { data: org }] = await Promise.all([sb.rpc('my_role'), sb.rpc('my_org')]);
  if (role !== 'owner' || !org) return json({ error: 'Only the owner can add layouts.' }, 403);

  let path: string;
  try { ({ path } = await req.json()); } catch { return json({ error: 'Invalid request' }, 400); }
  if (typeof path !== 'string' || !path.startsWith(`${org}/`)) return json({ error: 'Layout file not found.' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Automatic layout reading is not switched on yet. Add plots by hand for now.' }, 503);

  const { data: allowed } = await sb.rpc('claim_ai_read');
  if (!allowed) return json({ error: 'No automatic layout reads left on your plan for now. You can still place plots on the picture by hand, or ask us to add more reads.' }, 429);

  const { data: file, error: dlErr } = await sb.storage.from('layouts').download(path);
  if (dlErr || !file) return json({ error: 'Could not open the uploaded layout.' }, 400);
  const mediaType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

  const res = await readLayoutImage(apiKey, encodeBase64(new Uint8Array(await file.arrayBuffer())), mediaType);
  return json(res.body, res.status);
});
