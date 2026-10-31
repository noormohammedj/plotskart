import { useEffect, useMemo, useState } from 'react';
import { NoteRow } from '../components/ui';
import { useData } from '../data/DataProvider';
import { fmtT, short } from '../lib/format';
import { plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { PlotEvent } from '../lib/types';

const KIND: Record<string, [string, string]> = {
  booked: ['booked', 'BKD'], sold: ['sold', 'SLD'], payment: ['money', '₹'], registration: ['reg', 'REG'],
  registered: ['reg', 'REG'], cancelled: ['available', 'REL'], price: ['rate', 'RATE'], other: ['money', '•'],
};

/** The last 200 plot events in the company, kept live. */
function useTeamEvents() {
  const { org } = useData();
  const [events, setEvents] = useState<PlotEvent[]>([]);
  useEffect(() => {
    if (!org) return;
    const since = new Date();
    since.setDate(since.getDate() - 45);
    supabase.from('plot_events').select('*').eq('org_id', org.id).gte('created_at', since.toISOString())
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setEvents((data ?? []) as PlotEvent[]));
    const ch = supabase.channel(`events-${org.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plot_events', filter: `org_id=eq.${org.id}` },
        (e) => setEvents((all) => [e.new as PlotEvent, ...all.filter((x) => x.id !== (e.new as PlotEvent).id)]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [org]);
  return events;
}

export function Activity() {
  const { notes, memberName, openPlot, markAllRead, unread, profile, members, plots, projects } = useData();
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
  const board = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const rows = new Map<string, { booked: number; sold: number; value: number }>();
    for (const e of events) {
      if (new Date(e.created_at) < start || !e.member || (e.kind !== 'booked' && e.kind !== 'sold')) continue;
      const r = rows.get(e.member) ?? { booked: 0, sold: 0, value: 0 };
      r[e.kind]++;
      const p = plotById.get(e.plot_id), pr = p && projectById.get(p.project_id);
      if (e.kind === 'sold' && p && pr) r.value += plotValue(pr, p);
      rows.set(e.member, r);
    }
    return members.filter((m) => m.active && m.role !== 'owner')
      .map((m) => ({ m, ...(rows.get(m.id) ?? { booked: 0, sold: 0, value: 0 }) }))
      .sort((a, b) => b.sold - a.sold || b.value - a.value || b.booked - a.booked);
  }, [events, members, plotById, projectById]);
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
