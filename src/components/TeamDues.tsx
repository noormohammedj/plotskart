import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { commissionOf } from '../lib/finance';
import { fmtT, inr, short } from '../lib/format';
import { plotValue } from '../lib/plots';
import { useTeamEvents } from '../lib/teamBoard';
import { useOwnerMoney } from '../pages/Finance';

/** Alerts, owner and accountant: commission owed to sales staff and brokers, and project bills not yet fully paid
    (marketing, contractors, approvals). Paying happens on the Team and Finance tabs. */
export function MoneyDues() {
  const { members, projects, plots } = useData();
  const { costs, payments, loaded } = useOwnerMoney();
  if (!loaded) return null;
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? '—';

  const commission = members.filter((m) => m.role === 'sales' || m.role === 'broker')
    .flatMap((m) => projects.map((pr) => ({ m, pr, c: commissionOf(m, projects, plots, payments, pr.id) })))
    .filter((r) => r.c.pending > 0)
    .sort((a, b) => b.c.pending - a.c.pending);
  const bills = costs.map((c) => ({ c, due: Number(c.committed) - Number(c.paid) }))
    .filter((b) => b.due > 0)
    .sort((a, b) => (a.c.category === 'Marketing' ? -1 : 0) - (b.c.category === 'Marketing' ? -1 : 0) || b.due - a.due);
  const total = (n: number[]) => short(n.reduce((s, x) => s + x, 0));

  return (
    <>
      <section className="sec">
        <div className="card-h"><h2>Commission to pay</h2><span className="lbl">{total(commission.map((r) => r.c.pending))} to sales team and brokers</span></div>
        <div className="list card">
          {commission.length ? commission.map(({ m, pr, c }) => (
            <div className="li" key={m.id + pr.id} onClick={() => go('/team')} style={{ cursor: 'pointer' }}>
              <span className="ic k-money">₹</span>
              <div className="body">
                <p>{m.full_name} · {m.role === 'broker' ? 'Broker' : 'Sales'} · {pr.name}</p>
                <span className="meta">Earned {inr(c.earned)} on {c.sold} sold · paid {inr(c.paid)}</span>
              </div>
              <span className="tag soon">{inr(c.pending)}</span>
            </div>
          )) : <p className="empty">No commission waiting to be paid.</p>}
        </div>
      </section>
      <section className="sec">
        <div className="card-h"><h2>Bills to pay</h2><span className="lbl">{total(bills.map((b) => b.due))} on project costs</span></div>
        <div className="list card">
          {bills.length ? bills.map(({ c, due }) => (
            <div className="li" key={c.id} onClick={() => go('/finance')} style={{ cursor: 'pointer' }}>
              <span className="ic k-pay">₹</span>
              <div className="body">
                <p>{c.category}{c.party ? ` · ${c.party}` : ''} · {projName(c.project_id)}</p>
                <span className="meta">Agreed {inr(c.committed)} · paid {inr(c.paid)}</span>
              </div>
              <span className="tag soon">{inr(due)}</span>
            </div>
          )) : <p className="empty">Every project bill is paid in full.</p>}
        </div>
      </section>
    </>
  );
}

/** Alerts, everyone: the latest bookings and sales across the company, live. */
export function LatestDeals() {
  const { plots, projects, memberName, openPlot } = useData();
  const events = useTeamEvents().filter((e) => e.kind === 'booked' || e.kind === 'sold').slice(0, 8);
  const plotById = new Map(plots.map((p) => [p.id, p]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return (
    <section className="sec">
      <div className="card-h"><h2>Latest bookings and sales</h2><span className="lbl">live</span></div>
      <div className="list card">
        {events.length ? events.map((e) => {
          const p = plotById.get(e.plot_id), pr = p && projectById.get(p.project_id);
          return (
            <div className="li" key={e.id} onClick={() => p && openPlot(p.id)} style={{ cursor: p ? 'pointer' : undefined }}>
              <span className={`ic k-${e.kind}`}>{e.kind === 'sold' ? 'SLD' : 'BKD'}</span>
              <div className="body">
                <p><b>{memberName(e.member ?? e.actor)}</b> {e.kind === 'sold' ? 'sold' : 'booked'} {p ? `${p.label} · ${pr?.name ?? ''}` : 'a removed plot'}</p>
                <span className="meta">{p && pr ? `${short(plotValue(pr, p))} · ` : ''}{fmtT(e.created_at)}</span>
              </div>
            </div>
          );
        }) : <p className="empty">No bookings in the last few weeks.</p>}
      </div>
    </section>
  );
}
