import { useEffect, useState } from 'react';
import { useData } from '../data/DataProvider';
import { fmtD, fmtT, today, ymd } from '../lib/format';
import type { AppNotification } from '../lib/types';
import { I, tap, type IconKey } from './kit';

type Kind = 'booked' | 'sold' | 'registered' | 'cancelled' | 'payment' | 'reminder' | 'price' | 'other';
const META: Record<Kind, { label: string; icon: IconKey; tone: string }> = {
  booked: { label: 'Booked', icon: 'key', tone: 'amber' },
  sold: { label: 'Sold', icon: 'check', tone: 'mint' },
  registered: { label: 'Registered', icon: 'stamp', tone: 'violet' },
  cancelled: { label: 'Cancelled · available again', icon: 'undo', tone: 'red' },
  payment: { label: 'Payment', icon: 'coin', tone: 'sky' },
  reminder: { label: 'Reminder', icon: 'clock', tone: 'rose' },
  price: { label: 'Price change', icon: 'tag', tone: 'violet' },
  other: { label: 'Update', icon: 'bell', tone: 'sky' },
};

/** What kind of alert this is, from the kind the database stored and its wording. */
export function alertKind(n: AppNotification): Kind {
  if (n.kind === 'booked') return 'booked';
  if (n.kind === 'sold') return /completed registration/i.test(n.text) ? 'registered' : 'sold';
  if (n.kind === 'available') return 'cancelled';
  if (n.kind === 'money') return 'payment';
  if (n.kind === 'reg' || n.kind === 'pay') return 'reminder';
  if (n.kind === 'rate') return 'price';
  return 'other';
}

const FILTERS: [Kind | 'all', string][] = [['all', 'All'], ['booked', 'Booked'], ['sold', 'Sold'], ['registered', 'Registered'], ['cancelled', 'Cancelled'], ['payment', 'Payments']];

export function MAlerts() {
  const { notes, unread, markAllRead, openPlot } = useData();
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  // what was unread when the screen opened keeps its dot while you look
  const [fresh] = useState(() => new Set(notes.filter((n) => !n.read_at).map((n) => n.id)));
  useEffect(() => { const t = setTimeout(() => markAllRead(), 1200); return () => clearTimeout(t); }, [markAllRead]);

  const shown = notes.filter((n) => filter === 'all' || alertKind(n) === filter);
  const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
  const groups: [string, AppNotification[]][] = [];
  for (const n of shown) {
    const d = ymd(new Date(n.created_at));
    const label = d === today() ? 'Today' : d === yest ? 'Yesterday' : fmtD(d);
    const g = groups[groups.length - 1];
    if (g && g[0] === label) g[1].push(n); else groups.push([label, [n]]);
  }
  const countOf = (k: Kind | 'all') => (k === 'all' ? notes.length : notes.filter((n) => alertKind(n) === k).length);

  return (
    <div className="m-page">
      <header className="m-head"><div className="t"><small>{unread ? `${unread} new` : 'All caught up'}</small><h1>Alerts</h1></div></header>
      <div className="m-stack">
        <div className="m-chips">
          {FILTERS.map(([k, l]) => <button key={k} className={`m-chip${filter === k ? ' on' : ''}`} onClick={() => { tap(); setFilter(k); }}>{l}<em>{countOf(k)}</em></button>)}
        </div>
        {groups.length === 0 ? (
          <div className="m-card m-empty"><div className="art">🔔</div><b>Nothing here yet</b>Every booking, sale, registration and cancellation shows up here for the whole team.</div>
        ) : groups.map(([label, list]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="m-day">{label}</div>
            {list.map((n) => {
              const m = META[alertKind(n)];
              return (
                <button key={n.id} className={`m-alert${fresh.has(n.id) ? ' new' : ''}`} onClick={() => { if (n.plot_id) { tap(); openPlot(n.plot_id); } }}>
                  <span className={`m-badge t-${m.tone}`}><I n={m.icon} /></span>
                  <div className="body">
                    <div className="k" style={{ color: `var(--m-${m.tone})` }}>{m.label}</div>
                    <p>{n.text}</p>
                    <time>{fmtT(n.created_at)}</time>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
