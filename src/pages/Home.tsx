import { MonthBars } from '../components/charts';
import { AlertsCard } from '../components/AlertsCard';
import { ProjectPreview } from '../components/ProjectPreview';
import { NoteRow, StackBar } from '../components/ui';
import { lastMonths } from '../lib/money';
import type { LedgerEntry } from '../lib/types';
import { balanceOf, useOwnerMoney } from './Finance';
import { today } from '../lib/format';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { fmtD, inr, short, whenTxt } from '../lib/format';
import { counts, plotBalance } from '../lib/plots';
import { upcomingReminders } from '../lib/reminders';
import type { Project } from '../lib/types';
import { plotValue } from '../lib/plots';

export function ProjectCard({ pr }: { pr: Project }) {
  const { plots, towers, isOwner } = useData();
  const mine = plots.filter((p) => p.project_id === pr.id);
  const c = counts(mine);
  let contract = 0, collected = 0;
  for (const p of mine) if (p.status !== 'available') { contract += plotValue(pr, p); collected += Number(p.paid); }
  return (
    <button className="pcard" onClick={() => go(`/p/${pr.id}`)}>
      <div className="pcard-pic"><ProjectPreview project={pr} plots={mine} towers={towers.filter((t) => t.project_id === pr.id)} /></div>
      <div><h3>{pr.name}</h3><p className="loc">{pr.location}</p></div>
      <StackBar c={c} />
      <div className="cnts">
        <div><b>{c.sold}</b><span><i className="sw s-sold" />Sold</span></div>
        <div><b>{c.booked}</b><span><i className="sw s-booked" />Booked</span></div>
        <div><b>{c.available}</b><span><i className="sw s-available" />Available</span></div>
      </div>
      {isOwner ? (
        <div className="money">
          <div><span>Sales booked</span><b>{short(contract)}</b></div>
          <div><span>Collected</span><b>{short(collected)}</b></div>
          <div><span>Due from buyers</span><b>{short(contract - collected)}</b></div>
        </div>
      ) : (
        <div className="money">
          <div><span>Sale rate</span><b>₹{Number(pr.sale_rate).toLocaleString('en-IN')}/ft²</b></div>
          <div><span>Guideline</span><b>₹{Number(pr.guideline_rate).toLocaleString('en-IN')}/ft²</b></div>
          <div><span>{pr.kind === 'apartments' ? 'Flats' : 'Plots'}</span><b>{c.total}</b></div>
        </div>
      )}
    </button>
  );
}

/** Owner and accountant: money at a glance, with the last six months of cash flow. */
function MoneyStrip() {
  const { plots, projects } = useData();
  const { accounts, ledger, loaded } = useOwnerMoney();
  if (!loaded) return null;
  const month = today().slice(0, 7);
  const real = ledger.filter((e) => e.source !== 'transfer');
  const sumOf = (pred: (e: LedgerEntry) => boolean) => real.filter(pred).reduce((s, e) => s + Number(e.amount), 0);
  const cashNow = accounts.filter((a) => a.active).reduce((s, a) => s + balanceOf(a, ledger), 0);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const overdue = plots.filter((p) => p.status !== 'available' && p.due_date && p.due_date < today())
    .reduce((s, p) => s + plotBalance(byId.get(p.project_id)!, p), 0);
  const months = lastMonths(6).map((m) => ({
    label: m.label,
    in: sumOf((e) => e.direction === 'in' && e.txn_date.startsWith(m.key)),
    out: sumOf((e) => e.direction === 'out' && e.txn_date.startsWith(m.key)),
  }));
  return (
    <div className="grid2">
      <section className="tiles" style={{ alignContent: 'start' }}>
        <button className="tile acct" onClick={() => go('/finance/bank')}><span className="lbl">Bank & cash today</span><b>{short(cashNow)}</b><small>{accounts.filter((a) => a.active).length} accounts</small></button>
        <button className="tile acct" onClick={() => go('/finance/reports')}><span className="lbl">Collected this month</span><b className="pos">{short(sumOf((e) => e.direction === 'in' && e.source === 'customer_payment' && e.txn_date.startsWith(month)))}</b><small>from buyers</small></button>
        <button className="tile acct" onClick={() => go('/finance/reports')}><span className="lbl">Spent this month</span><b>{short(sumOf((e) => e.direction === 'out' && e.txn_date.startsWith(month)))}</b><small>all heads</small></button>
        <button className="tile acct" onClick={() => go('/reminders')}><span className="lbl">Overdue from buyers</span><b className={overdue ? 'neg' : ''}>{short(overdue)}</b><small>past due date</small></button>
      </section>
      <section className="card">
        <div className="card-h"><h2>Cash flow, last 6 months</h2><span className="lbl"><i className="sw s-sold" />In <i className="sw s-available" style={{ marginLeft: 10 }} />Out</span></div>
        <MonthBars data={months} height={170} />
      </section>
    </div>
  );
}

export function Home() {
  const { plots, projects, profile, notes, memberName, openPlot, isOwner, isFinance } = useData();
  const c = counts(plots);
  const rem = profile ? upcomingReminders(projects, plots, profile, 7).slice(0, 4) : [];
  if (!projects.length) {
    return (
      <section className="card">
        <h2>No projects yet</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>{isOwner ? 'Add your first layout to start tracking plots.' : 'Your owner has not added any projects yet.'}</p>
        {isOwner && <button className="btn pri" onClick={() => go('/projects/new')}>Add a project</button>}
      </section>
    );
  }
  return (
    <div className="stack-v">
      <AlertsCard />
      <section className="kpis">
        <div className="kpi"><span className="lbl">{projects.some((p) => p.kind === 'apartments') ? 'Total plots and flats' : 'Total plots'}</span><b>{c.total}</b><small>{projects.length} project{projects.length > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span className="lbl"><i className="sw s-sold" />Sold</span><b>{c.sold}</b><small>{c.total ? Math.round((c.sold / c.total) * 100) : 0}% of inventory</small></div>
        <div className="kpi"><span className="lbl"><i className="sw s-booked" />Booked</span><b>{c.booked}</b><small>advance received</small></div>
        <div className="kpi"><span className="lbl"><i className="sw s-available" />Available</span><b>{c.available}</b><small>open for sale</small></div>
      </section>
      {isFinance && <MoneyStrip />}
      <section>
        <div className="card-h"><h2>Projects</h2><button className="linkbtn" onClick={() => go('/projects')}>All projects</button></div>
        <div className="plist">{projects.map((pr) => <ProjectCard key={pr.id} pr={pr} />)}</div>
      </section>
      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Coming up</h2><button className="linkbtn" onClick={() => go('/reminders')}>All reminders</button></div>
          <div className="list">
            {rem.length ? rem.map((r) => (
              <div className="li" key={r.type + r.p.id} onClick={() => openPlot(r.p.id)} style={{ cursor: 'pointer' }}>
                <span className={`ic k-${r.type}`}>{r.type === 'reg' ? 'REG' : '₹'}</span>
                <div className="body">
                  <p>{r.type === 'reg' ? 'Registration' : 'Payment'} · {r.p.label} · {r.pr.name}</p>
                  <span className="meta">{r.p.buyer_name} · {r.type === 'reg' ? fmtD(r.p.reg_date) : `${inr(plotBalance(r.pr, r.p))} due ${fmtD(r.p.due_date)}`}</span>
                </div>
                <span className={`tag ${r.d <= 1 ? 'urgent' : r.d <= 3 ? 'soon' : 'ok'}`}>{r.d < 0 ? 'overdue' : whenTxt(r.d)}</span>
              </div>
            )) : <p className="empty">Nothing due this week.</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Recent activity</h2><button className="linkbtn" onClick={() => go('/activity')}>See all</button></div>
          <div className="list">
            {notes.length ? notes.slice(0, 5).map((n) => <NoteRow key={n.id} n={n} actor={memberName(n.actor)} onOpen={n.plot_id ? () => openPlot(n.plot_id) : undefined} />)
              : <p className="empty">No updates yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export function Projects() {
  const { projects, isOwner } = useData();
  return (
    <div className="stack-v">
      {isOwner && <div><button className="btn pri" onClick={() => go('/projects/new')}>Add a project</button></div>}
      <div className="plist">{projects.map((pr) => <ProjectCard key={pr.id} pr={pr} />)}</div>
      {!projects.length && <p className="empty">No projects yet.</p>}
    </div>
  );
}
