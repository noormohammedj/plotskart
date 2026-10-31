import { useEffect, useMemo, useState } from 'react';
import { NoteRow } from '../components/ui';
import { useData } from '../data/DataProvider';
import { fmtT, short } from '../lib/format';
import { useTeamBoard, useTeamEvents } from '../lib/teamBoard';

const KIND: Record<string, [string, string]> = {
  booked: ['booked', 'BKD'], sold: ['sold', 'SLD'], payment: ['money', '₹'], registration: ['reg', 'REG'],
  registered: ['reg', 'REG'], cancelled: ['available', 'REL'], price: ['rate', 'RATE'], other: ['money', '•'],
};

export function Activity() {
  const { notes, memberName, openPlot, markAllRead, unread, profile, plots, projects } = useData();
  const events = useTeamEvents();
  const [tab, setTab] = useState<'team' | 'mine'>('team');
  useEffect(() => {
    if (tab !== 'mine') return;
    const t = setTimeout(markAllRead, 1500);
    return () => clearTimeout(t);
  }, [markAllRead, tab]);

  const plotById = useMemo(() => new Map(plots.map((p) => [p.id, p])), [plots]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // this month's race: bookings and sales credited to whoever handles the plot
  const board = useTeamBoard(events);
  const top = Math.max(1, ...board.map((r) => r.sold * 2 + r.booked));
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });

  return (
    <div className="stack-v">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>Team activity</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My notifications{unread ? ` (${unread})` : ''}</button>
      </div>

      {tab === 'team' ? (
        <div className="grid2">
          <section className="card">
            <div className="card-h"><h2>{monthName} leaderboard</h2><span className="lbl">sold · booked</span></div>
            <div className="board">
              {board.map((r, i) => (
                <div key={r.m.id} className={`board-row${r.m.id === profile?.id ? ' me' : ''}`}>
                  <span className="rank">{i + 1}</span>
                  <div className="who-col">
                    <b>{r.m.full_name}{r.m.id === profile?.id ? ' (you)' : ''}</b>
                    <span className="meta">{r.m.role === 'sales' ? 'Sales' : 'Broker'}{r.value ? ` · ${short(r.value)} sold` : ''}</span>
                    <span className="bar" style={{ height: 6, marginTop: 4 }}>
                      <i className="s-sold" style={{ width: `${(r.sold * 2 / top) * 100}%` }} />
                      <i className="s-booked" style={{ width: `${(r.booked / top) * 100}%` }} />
                    </span>
                  </div>
                  <span className="num score"><b>{r.sold}</b> · {r.booked}</span>
                </div>
              ))}
              {!board.length && <p className="empty">Invite your sales team and brokers to start the race.</p>}
            </div>
            <p className="hint">Ranked by plots sold this month, then by sale value. Updates the moment anyone books or sells.</p>
          </section>

          <section className="card">
            <div className="card-h"><h2>What the team is doing</h2><span className="lbl">live</span></div>
            <div className="list">
              {events.slice(0, 60).map((e) => {
                const p = plotById.get(e.plot_id), pr = p && projectById.get(p.project_id);
                const [cls, label] = KIND[e.kind ?? 'other'] ?? KIND.other;
                return (
                  <div className="li" key={e.id} onClick={() => p && openPlot(p.id)} style={{ cursor: p ? 'pointer' : undefined }}>
                    <span className={`ic k-${cls}`}>{label}</span>
                    <div className="body">
                      <p><b>{memberName(e.actor)}</b> · {p ? `${p.label} · ${pr?.name ?? ''}` : 'a removed plot'}</p>
                      <span className="meta">{e.text} · {fmtT(e.created_at)}</span>
                    </div>
                  </div>
                );
              })}
              {!events.length && <p className="empty">No activity yet. Bookings, sales, payments and price changes appear here for the whole team.</p>}
            </div>
          </section>
        </div>
      ) : (
        <section className="card">
          <div className="card-h"><h2>Updates for {profile?.role === 'owner' ? 'you' : profile?.full_name}</h2><span className="muted">{unread} unread</span></div>
          <div className="list">
            {notes.length ? notes.map((n) => <NoteRow key={n.id} n={n} actor={memberName(n.actor)} onOpen={n.plot_id ? () => openPlot(n.plot_id) : undefined} />)
              : <p className="empty">No updates yet. Bookings, sales, rate changes and reminders appear here.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
