// Receives WhatsApp Cloud API webhooks from Meta:
//   GET  -> subscription check (hub.verify_token must equal WHATSAPP_VERIFY_TOKEN)
//   POST -> delivery statuses (sent / delivered / read / failed) for buyer messages and team alerts, and replies
//           (STOP switches WhatsApp off for that buyer or team member)
// Public (deploy with --no-verify-jwt); every POST must carry Meta's signature made with WHATSAPP_APP_SECRET.
// Never logs numbers or message text.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isNewerStatus, isOptOut, parseWebhook, safeEqual, verifyMetaSignature } from '../_shared/whatsapp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const verify = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
    const token = url.searchParams.get('hub.verify_token') ?? '';
    if (url.searchParams.get('hub.mode') === 'subscribe' && verify && safeEqual(token, verify)) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  const ok = await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), Deno.env.get('WHATSAPP_APP_SECRET') ?? '');
  if (!ok) return new Response('bad signature', { status: 401 });

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const { statuses, messages } = parseWebhook(body);

  let updated = 0, optedOut = 0;
  for (const s of statuses) {
    // a message id belongs to a buyer message or a team alert
    for (const table of ['customer_messages', 'team_messages']) {
      const { data: row } = await admin.from(table).select('id, whatsapp_status').eq('wa_message_id', s.id).maybeSingle();
      if (!row) continue;
      if (isNewerStatus(row.whatsapp_status, s.status)) {
        await admin.from(table).update({
          whatsapp_status: s.status, wa_status_at: s.at, ...(s.error ? { error: s.error } : {}),
        }).eq('id', row.id);
        updated++;
      }
      break;
    }
  }
  for (const m of messages) {
    if (!isOptOut(m.text)) continue;
    const { data } = await admin.rpc('whatsapp_opt_out', { p_wa_to: m.from });
    optedOut += Number(data ?? 0);
  }
  // Meta retries anything that isn't a 200, so always answer 200 once the signature is valid
  return new Response(JSON.stringify({ statuses: statuses.length, updated, opted_out: optedOut }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
