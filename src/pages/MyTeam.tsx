import { useEffect, useState } from 'react';
import { TeamPerformance } from '../components/TeamPerformance';
import { useData } from '../data/DataProvider';
import { commissionOf, fmtCommission, plotCommission } from '../lib/finance';
import { fmtD, inr, short } from '../lib/format';
import { plotBalance, plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import { useTeamBoard, useTeamEvents } from '../lib/teamBoard';
import type { CommissionPayment } from '../lib/types';

/** Team tab for sales staff and brokers: their own commission and pipeline, then the whole team's race.
    No company finance here; that stays with the owner and accountant. */
export function MyTeam() {
  const { profile, projects, plots, openPlot } = useData();
  const board = useTeamBoard(useTeamEvents());
  const [paid, setPaid] = useState<CommissionPayment[]>([]);
  useEffect(() => {
    if (!profile) return;
    // only the person's own payments are readable to them
    supabase.from('commission_payments').select('*').eq('member_id', profile.id).order('paid_on', { ascending: false })
      .then(({ data }) => setPaid((data ?? []) as CommissionPayment[]));
  }, [profile]);
  if (!profile) return null;

  const mine = commissionOf(profile, projects, plots, paid);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pipeline = mine.plots.filter((p) => p.status === 'booked');
  const sold = mine.plots.filter((p) => p.status === 'sold');
  const pipelineValue = pipeline.reduce((s, p) => s + plotValue(byId.get(p.project_id)!, p), 0);
  const row = (p: (typeof mine.plots)[number]) => {
    const pr = byId.get(p.project_id)!;
    return (
      <div className="li" key={p.id} onClick={() => openPlot(p.id)} style={{ cursor: 'pointer' }}>
        <span className={`ic k-${p.status}`}>{p.status === 'sold' ? 'SLD' : 'BKD'}</span>
        <div className="body">
          <p>{p.label} · {pr.name} · {p.buyer_name}</p>
          <span className="meta">
            {short(plotValue(pr, p))}
            {p.status === 'sold' ? ` · commission ${inr(plotCommission(pr, p, profile))}` : ` · ${inr(plotBalance(pr, p))} still to collect${p.due_date ? ` by ${fmtD(p.due_date)}` : ''}`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="stack-v">
      <section className="tiles">
        <div className="tile"><span className="lbl">Commission earned</span><b>{short(mine.earned)}</b><small>{mine.sold} sold · {fmtCommission(profile.commission_type, profile.commission_rate)}</small></div>
        <div className="tile"><span className="lbl">Paid to me</span><b className="pos">{short(mine.paid)}</b><small>{paid.length} payment{paid.length === 1 ? '' : 's'}</small></div>
        <div className="tile hero"><span className="lbl">Pending</span><b>{short(mine.pending)}</b><small>still to be paid</small></div>
        <div className="tile"><span className="lbl">My pipeline</span><b>{pipeline.length}</b><small>booked · {short(pipelineValue)}</small></div>
      </section>

      <TeamPerformance board={board} />

      <section className="card">
        <div className="card-h"><h2>My pipeline</h2><span className="lbl">booked, not yet sold</span></div>
        <div className="list">{pipeline.length ? pipeline.map(row) : <p className="empty">No booked plots right now.</p>}</div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Sold by me</h2></div>
        <div className="list">{sold.length ? sold.map(row) : <p className="empty">Nothing sold yet. Your first sale shows here with its commission.</p>}</div>
      </section>

      {paid.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>Commission paid to me</h2></div>
          <div className="list">
            {paid.map((x) => (
              <div className="li" key={x.id}>
                <span className="ic k-money">₹</span>
                <div className="body"><p>{inr(x.amount)} · {byId.get(x.project_id)?.name ?? '—'}</p><span className="meta">{fmtD(x.paid_on)}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
