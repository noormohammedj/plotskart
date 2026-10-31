import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { TeamPerformance } from '../components/TeamPerformance';
import { useData } from '../data/DataProvider';
import { useTeamBoard, useTeamEvents } from '../lib/teamBoard';
import { fmtD, inr, short } from '../lib/format';
import { commissionOf, fmtCommission, plotCommission } from '../lib/finance';
import { plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { CommissionType, Invite } from '../lib/types';
import { AccountSelect, useOwnerMoney } from './Finance';
import { today } from '../lib/format';

/** Commission deal picker: % of sale value, or a fixed ₹ per sq ft. Field names: ctype, rate. */
function CommissionFields({ type, rate, label }: { type: CommissionType; rate: number; label: string }) {
  const [t, setT] = useState<CommissionType>(type);
  return (
    <>
      <label>{label} type
        <select name="ctype" value={t} onChange={(e) => setT(e.target.value as CommissionType)}>
          <option value="percent">% of sale value</option>
          <option value="per_sqft">₹ per sq ft sold</option>
        </select>
      </label>
      <label>{t === 'percent' ? 'Percent (%)' : 'Rupees per sq ft (₹)'}
        <input name="rate" type="number" min="0" max={t === 'percent' ? 100 : undefined} step={t === 'percent' ? 0.25 : 1} defaultValue={rate} required />
      </label>
    </>
  );
}

const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
};

const ROLE_LABEL: Record<string, string> = { sales: 'Sales', broker: 'Broker', accountant: 'Accountant', owner: 'Owner' };

export function Team() {
  const { isOwner, isFinance, members, projects, plots, profile, org, openPlot, rpc, toast } = useData();
  const { payments, accounts, ledger, load } = useOwnerMoney();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ id: string; what: 'commission' | 'salary' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const board = useTeamBoard(useTeamEvents());

  const loadInvites = () => {
    supabase.from('invites').select('*').is('accepted_at', null).order('created_at', { ascending: false })
      .then(({ data }) => setInvites((data ?? []) as Invite[]));
  };
  useEffect(() => { if (isOwner) loadInvites(); }, [isOwner]);

  if (!isFinance || !profile || !org) return <p className="empty">The team page is visible to the owner and accountant only.</p>;

  const team = members.filter((m) => m.role !== 'owner');
  const salaryPaid = (id: string) => ledger.filter((e) => e.source === 'salary' && e.member_id === id).reduce((s, e) => s + Number(e.amount), 0);
  const rows = team.map((m) => {
    const c = commissionOf(m, projects, plots, payments);
    const sal = salaryPaid(m.id);
    return { m, c, sal, roi: c.paid + sal > 0 ? c.value / (c.paid + sal) : null };
  });
  const own = commissionOf(profile, projects, plots, payments);
  const tot = rows.reduce((a, r) => ({ e: a.e + r.c.earned, p: a.p + r.c.paid, n: a.n + r.c.pending, s: a.s + r.sal }), { e: 0, p: 0, n: 0, s: 0 });
  const payroll = team.filter((m) => m.active).reduce((s, m) => s + Number(m.monthly_salary || 0), 0);
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? '—';
  const sells = (r: string) => r === 'sales' || r === 'broker';

  const invite = async (e: FormEvent<HTMLFormElement>) => {
    const d = form(e);
    const { error } = await supabase.from('invites').insert({
      org_id: org.id, email: d.email.trim().toLowerCase(), full_name: d.name.trim(), phone: d.phone.trim(), role: d.role,
      commission_rate: d.role === 'accountant' || d.role === 'owner' ? 0 : +d.rate || 0, commission_type: d.ctype === 'per_sqft' ? 'per_sqft' : 'percent',
    });
    if (error) return toast(error.message.includes('duplicate') ? 'That email is already invited' : error.message);
    toast(`Invite saved. Ask ${d.name.trim()} to sign in with ${d.email.trim()}.`);
    setAdding(false);
    loadInvites();
  };

  return (
    <div className="stack-v">
      <TeamPerformance board={board} />
      <section className="tiles">
        <div className="tile"><span className="lbl">Commission earned</span><b>{short(tot.e)}</b><small>on sold plots</small></div>
        <div className="tile hero"><span className="lbl">Commission still to pay</span><b>{short(tot.n)}</b><small>{rows.filter((r) => r.c.pending > 0).length} people</small></div>
        <div className="tile"><span className="lbl">Monthly payroll</span><b>{short(payroll)}</b><small>{short(tot.s)} salary paid so far</small></div>
        <div className="tile"><span className="lbl">Sold directly by owner</span><b>{own.sold}</b><small>{short(own.value)}, no commission</small></div>
      </section>

      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th className="r">Commission</th><th className="r">Salary / mo</th><th className="r">Sold</th><th className="r">Sales value</th><th className="r">Earned</th><th className="r">Pending</th><th className="r">Return</th><th /></tr></thead>
          <tbody>
            {rows.map(({ m, c, sal, roi }) => (
              <Fragment key={m.id}>
                <tr className="click" onClick={(e) => { if (!(e.target as HTMLElement).closest('button,form')) setOpen(open === m.id ? null : m.id); }}>
                  <td><b>{m.full_name}</b>{!m.active && <span className="tag" style={{ marginLeft: 6 }}>Inactive</span>}<br /><span className="mono muted" style={{ fontSize: '.76rem' }}>{m.phone ?? m.email}</span></td>
                  <td><span className="tag">{ROLE_LABEL[m.role]}</span></td>
                  <td className="r">{sells(m.role) ? fmtCommission(m.commission_type, m.commission_rate) : '—'}</td>
                  <td className="r">{m.monthly_salary ? inr(m.monthly_salary) : '—'}</td>
                  <td className="r">{sells(m.role) ? `${c.sold} · ${c.booked} bkd` : '—'}</td>
                  <td className="r">{sells(m.role) ? short(c.value) : '—'}</td>
                  <td className="r">{sells(m.role) ? inr(c.earned) : '—'}</td>
                  <td className={`r ${c.pending > 0 ? 'neg' : ''}`}>{sells(m.role) ? inr(c.pending) : '—'}</td>
                  <td className="r" title={`Sales value ÷ (commission ${inr(c.paid)} + salary ${inr(sal)} paid)`}>{roi ? <b>{Math.round(roi)}×</b> : '—'}</td>
                  <td>
                    <div className="btns" style={{ flexWrap: 'nowrap' }}>
                      {c.pending > 0 && <button className="btn sm" onClick={() => setPaying({ id: m.id, what: 'commission' })}>Pay commission</button>}
                      {Number(m.monthly_salary) > 0 && <button className="btn sm ghost" onClick={() => setPaying({ id: m.id, what: 'salary' })}>Pay salary</button>}
                    </div>
                  </td>
                </tr>
                {paying?.id === m.id && (
                  <tr><td colSpan={10}>
                    {paying.what === 'commission' ? (
                      <form className="f" onSubmit={async (e) => {
                        const d = form(e);
                        if (await rpc('pay_commission', { p_member: m.id, p_project: d.pid, p_amount: +d.amount, p_account: d.account || null, p_date: d.date || null }, `Commission paid to ${m.full_name}`)) { setPaying(null); load(); }
                      }}>
                        <label>Project<select name="pid">{projects.map((p) => {
                          const x = commissionOf(m, projects, plots, payments, p.id);
                          return <option key={p.id} value={p.id} disabled={x.pending <= 0}>{p.name} · pending {inr(x.pending)}</option>;
                        })}</select></label>
                        <label>Amount (₹)<input name="amount" type="number" min="1" required defaultValue={Math.round(c.pending)} /></label>
                        <AccountSelect accounts={accounts} label="Paid from" />
                        <label>Date<input name="date" type="date" defaultValue={today()} /></label>
                        <div className="wide btns"><button className="btn pri">Record commission payment</button><button className="btn" type="button" onClick={() => setPaying(null)}>Cancel</button></div>
                      </form>
                    ) : (
                      <form className="f" onSubmit={async (e) => {
                        const d = form(e);
                        if (await rpc('pay_salary', { p_member: m.id, p_amount: +d.amount, p_month: `${d.month}-01`, p_account: d.account || null }, `Salary paid to ${m.full_name}`)) { setPaying(null); load(); }
                      }}>
                        <label>Salary for month<input name="month" type="month" defaultValue={today().slice(0, 7)} required /></label>
                        <label>Amount (₹)<input name="amount" type="number" min="1" required defaultValue={m.monthly_salary} /></label>
                        <AccountSelect accounts={accounts} label="Paid from" />
                        <div className="wide btns"><button className="btn pri">Record salary payment</button><button className="btn" type="button" onClick={() => setPaying(null)}>Cancel</button></div>
                      </form>
                    )}
                  </td></tr>
                )}
                {open === m.id && (
                  <tr><td colSpan={10} style={{ whiteSpace: 'normal', background: 'var(--sunk)' }}>
                    {sells(m.role) && <>
                      <div className="lbl" style={{ marginBottom: 6 }}>Plots handled by {m.full_name}</div>
                      <div className="chips">
                        {c.plots.map((p) => {
                          const pr = projects.find((x) => x.id === p.project_id)!;
                          return <button key={p.id} className="chip" onClick={() => openPlot(p.id)}><i className={`sw s-${p.status}`} />{p.label} · {pr.name} <span className="n">{short(plotValue(pr, p))}{p.status === 'sold' ? ` · commission ${inr(plotCommission(pr, p, m))} (${fmtCommission(p.commission_type ?? m.commission_type, p.commission_rate ?? m.commission_rate)})` : ''}</span></button>;
                        })}
                        {!c.plots.length && <span className="muted">No plots yet.</span>}
                      </div>
                    </>}
                    {(payments.some((x) => x.member_id === m.id) || sal > 0) && <>
                      <div className="lbl" style={{ margin: '12px 0 6px' }}>Payments to {m.full_name}</div>
                      {payments.filter((x) => x.member_id === m.id).map((x) => <div key={x.id} className="mono" style={{ fontSize: '.82rem' }}>{fmtD(x.paid_on)} · Commission · {projName(x.project_id)} · {inr(x.amount)}</div>)}
                      {ledger.filter((e) => e.source === 'salary' && e.member_id === m.id).map((e) => <div key={e.id} className="mono" style={{ fontSize: '.82rem' }}>{fmtD(e.txn_date)} · {e.note ?? 'Salary'} · {inr(e.amount)}</div>)}
                    </>}
                    {isOwner && (
                      <form className="f" style={{ marginTop: 12 }} onSubmit={async (e) => {
                        const d = form(e);
                        await rpc('update_member', { p_member: m.id, p_rate: sells(m.role) ? +d.rate : 0, p_active: d.active === 'on', p_type: d.ctype ?? 'percent', p_salary: +d.salary || 0 }, 'Member updated');
                      }}>
                        {sells(m.role) && <CommissionFields type={m.commission_type} rate={m.commission_rate} label="Commission on future sales" />}
                        <label>Monthly salary (₹)<input name="salary" type="number" min="0" defaultValue={m.monthly_salary} /></label>
                        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input name="active" type="checkbox" defaultChecked={m.active} style={{ width: 'auto' }} /> Can sign in</label>
                        <div className="wide btns"><button className="btn sm">Save changes</button></div>
                      </form>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={10} className="muted">No team members yet. Invite your sales team, brokers and accountant below.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">Commission is earned when a plot is marked sold, as a % of the sale value or ₹ per sq ft, using the deal the person had on that day. Return = sales value ÷ (commission + salary paid). Tap a row for plots, payments and settings.</p>

      {isOwner && (
        <section className="card">
          <div className="card-h"><h2>Invite a team member</h2><button className="btn sm" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Invite'}</button></div>
          {adding && (
            <form className="f" onSubmit={invite}>
              <label>Name<input name="name" required /></label>
              <label>Email (they sign in with this)<input name="email" type="email" required /></label>
              <label>Mobile<input name="phone" type="tel" required placeholder="+91" /></label>
              <label>Role<select name="role"><option value="sales">Sales team</option><option value="broker">Broker</option><option value="accountant">Accountant</option><option value="owner">Second owner (Business plan)</option></select></label>
              <CommissionFields type="percent" rate={1.5} label="Commission (not used for accountants)" />
              <div className="wide btns"><button className="btn pri">Save invite</button></div>
            </form>
          )}
          {invites.length > 0 && (
            <div className="list" style={{ marginTop: 10 }}>
              {invites.map((i) => (
                <div className="li" key={i.id}>
                  <div className="body"><p>{i.full_name} · {ROLE_LABEL[i.role]}{i.role !== 'accountant' && i.role !== 'owner' ? ` · ${fmtCommission(i.commission_type, i.commission_rate)}` : ''}</p><span className="meta">{i.email} · waiting for first sign-in</span></div>
                  <button className="btn sm ghost danger" onClick={async () => { await supabase.from('invites').delete().eq('id', i.id); loadInvites(); }}>Remove</button>
                </div>
              ))}
            </div>
          )}
          {!adding && !invites.length && <p className="muted">Sales staff and brokers see live layouts and book plots. Accountants handle payments, bank accounts and reports.</p>}
        </section>
      )}
    </div>
  );
}
