import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { fmtT } from '../lib/format';
import { plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import { useContacts } from './Contacts';
import { cheer, I, tap } from './kit';

interface Broadcast { id: string; project_id: string | null; body: string; total: number; created_at: string }
interface Sent { broadcast_id: string; contact_id: string | null; whatsapp_status: string; created_at: string }

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
/** Delivery state shown to people: Meta's ticks, or why it was not sent. */
const bucket = (s: string) =>
  s === 'read' ? 'read' : s === 'delivered' ? 'delivered' : s === 'sent' || s === 'accepted' || s === 'queued' ? 'sent' : s === 'failed' ? 'failed' : 'not sent';

/** Owner: announce a project on WhatsApp to every customer who agreed to offers, and see how it landed. */
export function MBroadcast({ projectId }: { projectId?: string }) {
  const { projects, plots, org, isOwner, rpc } = useData();
  const { contacts, reload: reloadContacts } = useContacts();
  const [pick, setPick] = useState(projectId ?? '');
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: b } = await supabase.from('broadcasts').select('id, project_id, body, total, created_at').order('created_at', { ascending: false }).limit(30);
    const list = (b ?? []) as Broadcast[];
    setHistory(list);
    if (!list.length) { setSent([]); return; }
    const { data: m } = await supabase.from('customer_messages').select('broadcast_id, contact_id, whatsapp_status, created_at').in('broadcast_id', list.map((x) => x.id));
    setSent((m ?? []) as Sent[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  // delivery ticks arrive over the next minutes
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const open = useMemo(() => projects.map((pr) => {
    const avail = plots.filter((p) => p.project_id === pr.id && p.status === 'available');
    return { pr, n: avail.length, from: avail.length ? Math.min(...avail.map((p) => plotValue(pr, p))) : 0 };
  }).filter((x) => x.n > 0), [projects, plots]);
  useEffect(() => { if (!pick && open[0]) setPick(open[0].pr.id); }, [open, pick]);
  const cur = open.find((x) => x.pr.id === pick);

  const agreed = contacts.filter((c) => c.marketing_ok && !c.opted_out_at);
  const weekAgo = Date.now() - 7 * 864e5;
  const recent = new Set(sent.filter((m) => {
    const b = history.find((h) => h.id === m.broadcast_id);
    return b?.project_id === pick && new Date(m.created_at).getTime() > weekAgo;
  }).map((m) => m.contact_id));
  const audience = agreed.filter((c) => !recent.has(c.id));
  const first = (audience[0]?.name ?? 'Ravi').trim().split(/\s+/)[0];

  if (!isOwner) return <div className="m-page"><div className="m-card m-empty"><b>Only the owner sends broadcasts</b></div></div>;

  const send = async () => {
    if (!cur || !audience.length) return;
    if (!confirm(`Send ${cur.pr.name} to ${audience.length} customer${audience.length === 1 ? '' : 's'} on WhatsApp?`)) return;
    setBusy(true);
    const n = await rpc<number>('send_broadcast', { p_project: cur.pr.id, p_contacts: null });
    setBusy(false);
    if (n) { cheer(); load(); reloadContacts(); }
  };

  return (
    <div className="m-page">
      <header className="m-head">
        <button className="m-iconbtn" aria-label="Back" onClick={() => { tap(); go('/contacts'); }}><I n="back" sw={2.4} /></button>
        <div className="t"><small>WhatsApp</small><h1 style={{ fontSize: '1.6rem' }}>Announce a project</h1></div>
      </header>
      <div className="m-stack">
        {open.length === 0 ? (
          <div className="m-card m-empty"><div className="art">🏗️</div><b>Nothing open to announce</b>Every plot and flat is booked or sold.</div>
        ) : <>
          <div className="m-chips">
            {open.map(({ pr }) => <button key={pr.id} className={`m-chip${pick === pr.id ? ' on' : ''}`} onClick={() => { tap(); setPick(pr.id); }}>{pr.name}</button>)}
          </div>

          {cur && (
            <section className="m-wa" aria-label="Message preview">
              <div className="m-wa-bubble">
                <p>Hi {first}, <b>{cur.pr.name}</b> at {cur.pr.location} is now open. {cur.pr.kind === 'apartments' ? 'Flats' : 'Plots'} from <b>{inr(cur.from)}</b> ({inr(Number(cur.pr.sale_rate))} per sq ft). Reply to book a site visit. – {org?.name}</p>
                <time>{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</time>
              </div>
              <div className="m-wa-btn">Stop promotions</div>
              <p className="m-wa-note">Each customer sees their own first name. The wording comes from the template approved by WhatsApp.</p>
            </section>
          )}

          <section className="m-card">
            <div className="m-cardhead"><h3>Who gets it</h3><span>{audience.length} customer{audience.length === 1 ? '' : 's'}</span></div>
            <p className="m-small" style={{ margin: 0 }}>
              Everyone who agreed to offers ({agreed.length}){recent.size ? `, except ${recent.size} who got this project in the last 7 days` : ''}.
              {' '}Customers who said STOP are never included.
            </p>
            <button className="m-btn ghost sm" style={{ marginTop: 12 }} onClick={() => { tap(); go('/contacts'); }}>Manage customers</button>
          </section>

          <button className="m-btn" disabled={busy || !audience.length} onClick={send}>
            {busy ? 'Sending…' : audience.length ? `Send to ${audience.length} on WhatsApp` : 'No one to send to yet'}
          </button>
        </>}

        {history.length > 0 && <>
          <div className="m-sec"><h2>Sent</h2></div>
          {history.map((b) => {
            const msgs = sent.filter((m) => m.broadcast_id === b.id);
            const c = { sent: 0, delivered: 0, read: 0, failed: 0, 'not sent': 0 } as Record<string, number>;
            msgs.forEach((m) => { c[bucket(m.whatsapp_status)]++; });
            const total = Math.max(1, msgs.length);
            const pr = projects.find((p) => p.id === b.project_id);
            return (
              <section key={b.id} className="m-card">
                <div className="m-cardhead"><h3>{pr?.name ?? 'Project'}</h3><span>{fmtT(b.created_at)}</span></div>
                <div className="m-stackbar" aria-hidden="true">
                  <i style={{ width: `${(c.read / total) * 100}%`, background: 'var(--m-sky)' }} />
                  <i style={{ width: `${(c.delivered / total) * 100}%`, background: 'var(--m-mint)' }} />
                  <i style={{ width: `${(c.sent / total) * 100}%`, background: 'var(--m-faint)' }} />
                  <i style={{ width: `${(c.failed / total) * 100}%`, background: 'var(--m-red)' }} />
                </div>
                <div className="m-legend">
                  <span><i style={{ background: 'var(--m-sky)' }} />{c.read} read</span>
                  <span><i style={{ background: 'var(--m-mint)' }} />{c.delivered} delivered</span>
                  <span><i style={{ background: 'var(--m-faint)' }} />{c.sent} on the way</span>
                  {c.failed > 0 && <span><i style={{ background: 'var(--m-red)' }} />{c.failed} failed</span>}
                  {c['not sent'] > 0 && <span>{c['not sent']} not sent{msgs.some((m) => m.whatsapp_status.startsWith('demo')) ? ' (demo)' : msgs.some((m) => /plan|limit/.test(m.whatsapp_status)) ? ' (plan limit)' : ''}</span>}
                </div>
              </section>
            );
          })}
        </>}
      </div>
    </div>
  );
}
