// Tests the WhatsApp helpers shared by the deliver and whatsapp-webhook edge functions.
// Run: npm run test:fn   (Node strips the TypeScript types itself)
import { createHmac } from 'node:crypto';
import { isNewerStatus, isOptOut, parseWebhook, toWhatsAppNumber, verifyMetaSignature } from '../functions/_shared/whatsapp.ts';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

// phone numbers
const numbers = [
  ['9876543210', '919876543210', 'Indian mobile, 10 digits'],
  ['+91 98765 43210', '919876543210', 'Indian mobile with +91 and spaces'],
  ['09876543210', '919876543210', 'Indian mobile with leading 0'],
  ['0091-9876543210', '919876543210', 'Indian mobile with 00 prefix'],
  ['0501234567', '971501234567', 'UAE mobile, local 05…'],
  ['501234567', '971501234567', 'UAE mobile without the 0'],
  ['+971 50 123 4567', '971501234567', 'UAE mobile with +971'],
  ['12345', null, 'too short is refused'],
  ['', null, 'empty is refused'],
];
for (const [input, want, label] of numbers) ok(toWhatsAppNumber(input) === want, `${label}: ${JSON.stringify(input)} → ${toWhatsAppNumber(input)}`);

// Meta signature
const secret = 'app-secret-123';
const body = JSON.stringify({ entry: [] });
const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
ok(await verifyMetaSignature(body, sig, secret), 'valid Meta signature accepted');
ok(!(await verifyMetaSignature(body + ' ', sig, secret)), 'changed body rejected');
ok(!(await verifyMetaSignature(body, sig, 'other-secret')), 'wrong app secret rejected');
ok(!(await verifyMetaSignature(body, null, secret)), 'missing signature rejected');
ok(!(await verifyMetaSignature(body, sig, '')), 'no configured secret rejects everything');

// webhook payload
const payload = {
  entry: [{ changes: [{ value: {
    statuses: [
      { id: 'wamid.A', status: 'delivered', timestamp: '1792900000' },
      { id: 'wamid.B', status: 'failed', timestamp: '1792900001', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    ],
    messages: [{ from: '919876543210', type: 'text', text: { body: 'STOP' } }, { from: '971501234567', type: 'text', text: { body: 'Thanks' } }],
  } }] }],
};
const parsed = parseWebhook(payload);
ok(parsed.statuses.length === 2 && parsed.statuses[0].status === 'delivered' && parsed.statuses[0].at.startsWith('2026'), 'statuses parsed with time');
ok(parsed.statuses[1].error === '131026 Message undeliverable', 'failure keeps only code and title');
ok(parsed.messages.length === 2 && parsed.messages[0].from === '919876543210', 'incoming replies parsed');
ok(parseWebhook({}).statuses.length === 0 && parseWebhook(null).messages.length === 0, 'empty or odd payloads are ignored');

// opt-out words and status order
ok(isOptOut('STOP') && isOptOut(' stop please') && isOptOut('Unsubscribe') && !isOptOut('Thanks, will pay tomorrow'), 'STOP-style replies detected, normal replies not');
ok(isNewerStatus('accepted', 'delivered') && isNewerStatus('delivered', 'read') && !isNewerStatus('read', 'delivered'), 'a late "delivered" never overwrites "read"');
ok(isNewerStatus('skipped: not configured', 'sent'), 'unknown earlier states can be updated');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
