import { LBL } from '../lib/format';
import type { AppNotification, Status } from '../lib/types';
import { fmtT } from '../lib/format';

const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  projects: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></>,
  reminders: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M5 3L2 6M19 3l3 3" /></>,
  finance: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  team: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-7 7-7s7 3 7 7M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5.5-4.5-6.5" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" />,
};
export type IconName = keyof typeof ICONS;

export const Icon = ({ name }: { name: IconName }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export const Mark = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
    <rect width="34" height="34" rx="8" fill="var(--accent)" />
    <rect x="7" y="7" width="9" height="9" rx="1.5" fill="var(--sold)" />
    <rect x="18" y="7" width="9" height="9" rx="1.5" fill="var(--booked)" />
    <rect x="7" y="18" width="9" height="9" rx="1.5" fill="var(--avail)" />
    <rect x="18" y="18" width="9" height="9" rx="1.5" fill="var(--accent-ink)" opacity=".85" />
  </svg>
);

export const Pill = ({ status, extra }: { status: Status; extra?: string }) => (
  <span className={`pill st-${status}`}>{LBL[status]}{extra}</span>
);

export const StackBar = ({ c }: { c: Record<Status, number> & { total: number } }) => (
  <div className="bar" role="img" aria-label={`${c.sold} sold, ${c.booked} booked, ${c.available} available`}>
    {(['sold', 'booked', 'available'] as const).map((k) => (
      <i key={k} className={`s-${k}`} style={{ width: `${c.total ? (c[k] / c.total) * 100 : 0}%` }} />
    ))}
  </div>
);

const KIND: Record<string, [string, string]> = {
  booked: ['booked', 'BKD'], sold: ['sold', 'SLD'], available: ['available', 'REL'],
  reg: ['reg', 'REG'], pay: ['pay', '₹'], money: ['money', '₹'], rate: ['rate', 'RATE'], layout: ['rate', 'MAP'],
};

export function NoteRow({ n, actor, onOpen }: { n: AppNotification; actor: string; onOpen?: () => void }) {
  const [cls, label] = KIND[n.kind] ?? ['money', '•'];
  return (
    <div className={`li${n.read_at ? '' : ' unread'}`} onClick={onOpen} style={onOpen ? { cursor: 'pointer' } : undefined}>
      <span className={`ic k-${cls}`}>{label}</span>
      <div className="body">
        <p>{n.text}</p>
        <span className="meta">{n.actor ? actor : 'Automatic reminder'} · {fmtT(n.created_at)}</span>
      </div>
      {!n.read_at && <span className="udot" aria-label="unread" />}
    </div>
  );
}

/** Four corners pointing out: "fit the map to the screen". Drawn, because the ⤢ character renders tiny on Android. */
export const FitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
