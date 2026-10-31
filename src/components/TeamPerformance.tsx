import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { inr, short } from '../lib/format';
import type { BoardRow } from '../lib/teamBoard';

/** Who earned what today, then this month's race with commission earned. Seen by the whole team: knowing what
    the others made today is meant to spur everyone on. */
export function TeamPerformance({ board, compact }: { board: BoardRow[]; compact?: boolean }) {
  const { profile } = useData();
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const todays = board.filter((r) => r.earnedToday > 0 || r.soldToday > 0 || r.bookedToday > 0)
    .sort((a, b) => b.earnedToday - a.earnedToday || b.soldToday - a.soldToday || b.bookedToday - a.bookedToday);
  const top = Math.max(1, ...board.map((r) => r.sold * 2 + r.booked));
  const rows = compact ? board.slice(0, 5) : board;
  const me = (r: BoardRow) => r.m.id === profile?.id;

  return (
    <section className="card">
      <div className="card-h">
        <h2>Team performance</h2>
        {compact && <button className="linkbtn" onClick={() => go('/team')}>Whole team</button>}
      </div>

      <div className="lbl" style={{ margin: '2px 0 6px' }}>Earned today</div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {todays.map((r) => (
          <span key={r.m.id} className="chip">
            <b>{r.m.full_name.split(' ')[0]}{me(r) ? ' (you)' : ''}</b>
            <span className="n">{r.earnedToday ? inr(r.earnedToday) : ''}{r.soldToday ? ` · ${r.soldToday} sold` : ''}{r.bookedToday ? ` · ${r.bookedToday} booked` : ''}</span>
          </span>
        ))}
        {!todays.length && <span className="muted">No bookings or sales yet today. The first one shows here for everyone.</span>}
      </div>

      <div className="lbl" style={{ marginBottom: 6 }}>{monthName}: sold · booked · commission earned</div>
      <div className="board">
        {rows.map((r, i) => (
          <div key={r.m.id} className={`board-row${me(r) ? ' me' : ''}`}>
            <span className="rank">{i + 1}</span>
            <div className="who-col">
              <b>{r.m.full_name}{me(r) ? ' (you)' : ''}</b>
              <span className="meta">
                {r.m.role === 'sales' ? 'Sales' : 'Broker'}{r.value ? ` · ${short(r.value)} sold` : ''}
                {r.pipeline.length ? ` · ${r.pipeline.length} in pipeline (${short(r.pipelineValue)})` : ''}
              </span>
              <span className="bar" style={{ height: 6, marginTop: 4 }}>
                <i className="s-sold" style={{ width: `${(r.sold * 2 / top) * 100}%` }} />
                <i className="s-booked" style={{ width: `${(r.booked / top) * 100}%` }} />
              </span>
            </div>
            <span className="num score"><b>{r.sold}</b> · {r.booked}<br /><small>{short(r.earnedMonth)}</small></span>
          </div>
        ))}
        {!board.length && <p className="empty">Invite your sales team and brokers to start the race.</p>}
      </div>
    </section>
  );
}
