// WhatsApp Cloud API helpers shared by the deliver and whatsapp-webhook functions.
// Plain TypeScript with Web APIs only, so supabase/tests/whatsapp.test.mjs can run it under Node too.

export const GRAPH_VERSION = 'v25.0';

/**
 * A phone number as WhatsApp wants it: digits with the country code, no plus.
 * India: 10-digit mobiles (6-9…), with or without 0 / +91. UAE: 05x local, 5x without the 0, or +971.
 * Anything else that already carries a country code is passed through.
 */
export function toWhatsAppNumber(phone: string): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (/^05\d{8}$/.test(d)) return `971${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `971${d}`;
  if (/^91[6-9]\d{9}$/.test(d) || /^9715\d{8}$/.test(d)) return d;
  if (/^\d{8,15}$/.test(d) && !d.startsWith('0')) return d;
  return null;
}

const enc = new TextEncoder();

/** Checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret), in constant time. */
export async function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return safeEqual(expected, header.slice(7).toLowerCase());
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Delivery states in order; a late "delivered" never overwrites "read". */
const RANK: Record<string, number> = { queued: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
export const isNewerStatus = (current: string | null, next: string) => (RANK[next] ?? -1) > (RANK[current ?? ''] ?? -1);

export type StatusUpdate = { id: string; status: string; at: string; error: string | null };
export type InboundMessage = { from: string; text: string };

/** Pulls delivery statuses and incoming text messages out of a webhook payload. */
export function parseWebhook(body: unknown): { statuses: StatusUpdate[]; messages: InboundMessage[] } {
  const statuses: StatusUpdate[] = [];
  const messages: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const err = (s.errors as { code?: number; title?: string }[] | undefined)?.[0];
        statuses.push({
          id: String(s.id),
          status: String(s.status),
          at: new Date(Number(s.timestamp) * 1000).toISOString(),
          // error code and Meta's title only: never the message content or the number
          error: err ? `${err.code ?? ''} ${err.title ?? ''}`.trim() : null,
        });
      }
      for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
        const text = (m.text as { body?: string } | undefined)?.body ?? (m.button as { text?: string } | undefined)?.text ?? '';
        messages.push({ from: String(m.from), text });
      }
    }
  }
  return { statuses, messages };
}

/** STOP, UNSUBSCRIBE and similar replies switch WhatsApp off for that buyer. */
export const isOptOut = (text: string) => /^\s*(stop|unsubscribe|opt ?out|cancel|no more)\b/i.test(text);
