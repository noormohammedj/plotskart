// Delivers what the database queues:
//   notifications row      -> push to the recipient's phones (Firebase Cloud Messaging)
//   customer_messages row  -> WhatsApp template message + SMS to the customer
//   team_messages row      -> WhatsApp template message to a team member who opted in
// Called by the _call_deliver() trigger through pg_net. Deploy with --no-verify-jwt;
// the request is authenticated with the shared DELIVER_SECRET header instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GRAPH_VERSION, toWhatsAppNumber } from '../_shared/whatsapp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const TITLES: Record<string, string> = {
  booked: 'Plot booked',
  sold: 'Plot sold',
  available: 'Booking cancelled',
  money: 'Payment recorded',
  rate: 'Price updated',
  reg: 'Registration reminder',
  pay: 'Payment reminder',
};

Deno.serve(async (req) => {
  if (req.headers.get('x-deliver-secret') !== Deno.env.get('DELIVER_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const { table, record } = await req.json();
  try {
    if (table === 'notifications') return json(await pushNotification(record));
    if (table === 'customer_messages') return json(await sendCustomerMessage(record));
    if (table === 'team_messages') return json(await sendTeamMessage(record));
    return json({ skipped: 'unknown table' });
  } catch (e) {
    // no PII in logs: report the error type only
    console.error('deliver failed:', e instanceof Error ? e.name : 'error');
    return json({ error: 'delivery failed' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ------------------------------------------------------------------ push (FCM HTTP v1)

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let cachedToken: { value: string; exp: number } | null = null;

async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;
  const b64url = (data: Uint8Array | string) =>
    btoa(typeof data === 'string' ? data : String.fromCharCode(...data))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${await res.text()}`);
  const body = await res.json();
  cachedToken = { value: body.access_token, exp: now + body.expires_in };
  return cachedToken.value;
}

async function pushNotification(n: { recipient: string; kind: string; text: string; plot_id: string | null }) {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return { skipped: 'FCM_SERVICE_ACCOUNT not set' };
  const sa: ServiceAccount = JSON.parse(raw);
  const { data: devices } = await admin.from('device_tokens').select('token').eq('user_id', n.recipient);
  if (!devices?.length) return { skipped: 'no devices' };

  const access = await fcmAccessToken(sa);
  const results = await Promise.all(devices.map(async ({ token }) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: TITLES[n.kind] ?? 'Plotskart', body: n.text },
          data: { kind: n.kind, plot_id: n.plot_id ?? '' },
          android: { priority: 'high', notification: { channel_id: 'updates' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.status === 404 || res.status === 400) {
      // token no longer valid (app uninstalled or re-installed)
      const err = await res.text();
      if (err.includes('UNREGISTERED') || err.includes('INVALID_ARGUMENT')) {
        await admin.from('device_tokens').delete().eq('token', token);
      }
      return { token: token.slice(0, 8), ok: false, err };
    }
    return { token: token.slice(0, 8), ok: res.ok };
  }));
  return { sent: results };
}

// ------------------------------------------------------------------ WhatsApp + SMS

type WaResult = { status: string; id?: string };

// Approved template on the one Plotskart number; the developer's name is the last variable.
async function sendWhatsApp(to: string, template: string, params: string[]): Promise<WaResult> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) return { status: 'skipped: not configured' };
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: Deno.env.get('WHATSAPP_LANGUAGE') ?? 'en' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  if (!res.ok) {
    // Meta's error code and title only, never the payload (it holds the buyer's name and number)
    const err = await res.json().catch(() => ({}));
    return { status: `failed: ${err?.error?.code ?? res.status} ${err?.error?.error_data?.details ?? err?.error?.message ?? ''}`.slice(0, 200) };
  }
  const body = await res.json();
  return { status: 'accepted', id: body?.messages?.[0]?.id };
}

// MSG91 Flow API. Create one DLT-approved SMS template per message type and put its id in
// MSG91_TEMPLATE_BOOKING_CONFIRMATION / _REGISTRATION_REMINDER / _PAYMENT_REMINDER.
// Template variables are ##var1##, ##var2##, ... in the same order as `params`.
async function sendSms(to: string, template: string, params: string[]) {
  const key = Deno.env.get('MSG91_AUTH_KEY');
  const templateId = Deno.env.get(`MSG91_TEMPLATE_${template.toUpperCase()}`);
  if (!key || !templateId) return 'skipped: not configured';
  const recipient: Record<string, string> = { mobiles: to };
  params.forEach((p, i) => (recipient[`var${i + 1}`] = p));
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [recipient] }),
  });
  return res.ok ? 'sent' : `failed: ${(await res.text()).slice(0, 300)}`;
}

async function sendCustomerMessage(m: { id: string; to_phone: string; template: string; params: string[]; whatsapp_status: string; sms_status: string }) {
  const to = toWhatsAppNumber(m.to_phone);
  if (!to) {
    await admin.from('customer_messages').update({ whatsapp_status: 'failed', sms_status: 'failed', error: 'invalid phone number' }).eq('id', m.id);
    return { whatsapp: 'failed', sms: 'failed' };
  }
  // the database decides who gets WhatsApp (consent, demo companies); only 'queued' is sent
  const [wa, sms] = await Promise.all([
    m.whatsapp_status === 'queued' ? sendWhatsApp(to, m.template, m.params) : Promise.resolve({ status: m.whatsapp_status } as WaResult),
    m.sms_status === 'queued' ? sendSms(to, m.template, m.params) : Promise.resolve(m.sms_status),
  ]);
  const failed = [wa.status, sms].filter((s) => s.startsWith('failed')).join(' | ');
  await admin.from('customer_messages').update({
    whatsapp_status: wa.status.startsWith('failed') ? 'failed' : wa.status,
    sms_status: sms.startsWith('failed') ? 'failed' : sms,
    wa_to: to,
    wa_message_id: wa.id ?? null,
    error: failed || null,
    sent_at: wa.status === 'accepted' || sms === 'sent' ? new Date().toISOString() : null,
  }).eq('id', m.id);
  return { whatsapp: wa.status, sms };
}

// Team alerts and the owner's daily summary: WhatsApp only, to people who turned alerts on for themselves.
async function sendTeamMessage(m: { id: string; to_phone: string; template: string; params: string[]; whatsapp_status: string }) {
  if (m.whatsapp_status !== 'queued') return { whatsapp: m.whatsapp_status };
  const to = toWhatsAppNumber(m.to_phone);
  if (!to) {
    await admin.from('team_messages').update({ whatsapp_status: 'failed', error: 'invalid phone number' }).eq('id', m.id);
    return { whatsapp: 'failed' };
  }
  const wa = await sendWhatsApp(to, m.template, m.params);
  await admin.from('team_messages').update({
    whatsapp_status: wa.status.startsWith('failed') ? 'failed' : wa.status,
    wa_to: to,
    wa_message_id: wa.id ?? null,
    error: wa.status.startsWith('failed') ? wa.status : null,
    sent_at: wa.status === 'accepted' ? new Date().toISOString() : null,
  }).eq('id', m.id);
  return { whatsapp: wa.status };
}
