import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { MonthBars } from '../components/charts';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { commissionOf, projectFinance } from '../lib/finance';
import { CATS, LAND_CATS, fmtD, inr, short, today } from '../lib/format';
import { assetValue, downloadCsv, EXPENSE_CATS, FUNDING_CATS, inPeriod, INCOME_CATS, lastMonths, periods, signed } from '../lib/money';
import { plotBalance, plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { Account, Asset, CommissionPayment, CostLine, Funding, LedgerEntry, PlotEvent, Project } from '../lib/types';

/** Everything the money screens need, loaded once per visit. */
export function useOwnerMoney() {
  const [costs, setCosts] = useState<CostLine[]>([]);
  const [funding, setFunding] = useState<Funding[]>([]);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const all: LedgerEntry[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('ledger').select('*').order('txn_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999);
      all.push(...((data ?? []) as LedgerEntry[]));
      if (!data || data.length < 1000) break;
    }
    const [c, f, p, a, s] = await Promise.all([
      supabase.from('cost_lines').select('*').order('created_at'),
      supabase.from('project_funding').select('*'),
      supabase.from('commission_payments').select('*').order('paid_on', { ascending: false }),
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('assets').select('*').order('purchase_date', { ascending: false }),
    ]);
    setCosts((c.data ?? []) as CostLine[]);
    setFunding((f.data ?? []) as Funding[]);
    setPayments((p.data ?? []) as CommissionPayment[]);
    setAccounts((a.data ?? []) as Account[]);
    setAssets((s.data ?? []) as Asset[]);
    setLedger(all);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { costs, funding, payments, accounts, ledger, assets, loaded, load };
}
export type Money = ReturnType<typeof useOwnerMoney>;

export const balanceOf = (a: Account, ledger: LedgerEntry[]) =>
  Number(a.opening_balance) + ledger.filter((e) => e.account_id === a.id).reduce((s, e) => s + signed(e), 0);

const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
};

export function AccountSelect({ accounts, name = 'account', label = 'From account', defaultValue }: { accounts: Account[]; name?: string; label?: string; defaultValue?: string }) {
  return (
    <label>{label}
      <select name={name} defaultValue={defaultValue}>
        {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ·${a.last4}` : ''}</option>)}
      </select>
    </label>
  );
}

const tile = (l: string, v: string, s: string, hero = false) => (
  <div className={`tile${hero ? ' hero' : ''}`}><span className="lbl">{l}</span><b>{v}</b><small>{s}</small></div>
);

type Tab = 'projects' | 'bank' | 'reports' | 'assets';

export function Finance({ tab = 'projects' }: { tab?: Tab }) {
  const { isFinance } = useData();
  const money = useOwnerMoney();
  if (!isFinance) return <p className="empty">Finance is visible to the owner and accountant only.</p>;
  const tabs: [Tab, string][] = [['projects', 'Project P&L'], ['bank', 'Bank & cash'], ['reports', 'Reports'], ['assets', 'Assets']];
  return (
    <div className="stack-v">
      <div className="seg" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k === 'projects' ? '/finance' : `/finance/${k}`)}>{l}</button>)}
      </div>
      {!money.loaded ? <p className="empty">Loading accounts…</p>
        : tab === 'bank' ? <BankTab money={money} />
        : tab === 'reports' ? <ReportsTab money={money} />
        : tab === 'assets' ? <AssetsTab money={money} />
        : <ProjectsTab money={money} />}
    </div>
  );
}

// ---------------------------------------------------------------- project P&L

function ProjectsTab({ money }: { money: Money }) {
  const { projects, plots, members, org, openPlot, rpc, toast } = useData();
  const { costs, funding, payments, accounts, load } = money;
  const [pid, setPid] = useState(projects[0]?.id);
  const [payLine, setPayLine] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editFund, setEditFund] = useState(false);

  const pr = projects.find((p) => p.id === pid) ?? projects[0];
  if (!pr || !org) return <p className="empty">Add a project first.</p>;

  const F = funding.find((x) => x.project_id === pr.id) ?? { project_id: pr.id, bank: 0, credit: 0, cash: 0 };
  const f = projectFinance(pr, plots, costs, F, members, payments);
  const mine = plots.filter((p) => p.project_id === pr.id);
  const custs = mine.filter((p) => plotBalance(pr, p) > 0).sort((a, b) => plotBalance(pr, b) - plotBalance(pr, a));
  const owe: [string, string, number][] = f.lines.filter((c) => c.committed > c.paid).map((c) => [c.party, c.category, c.committed - c.paid]);
  members.filter((m) => m.role === 'sales' || m.role === 'broker').forEach((m) => {
    const c = commissionOf(m, [pr], mine, payments, pr.id);
    if (c.pending > 0) owe.push([m.full_name, m.role === 'broker' ? 'Broker commission' : 'Sales commission', c.pending]);
  });
  owe.sort((a, b) => b[2] - a[2]);
  const fund: [string, number, string][] = [['Bank loan', Number(F.bank), 'var(--accent)'], ['Credit / private finance', Number(F.credit), 'var(--booked)'], ['Own cash', Number(F.cash), 'var(--sold)']];
  const done = async (ok: unknown, close: () => void) => { if (ok) { close(); await load(); } };

  return (
    <>
      <div className="seg">{projects.map((p) => <button key={p.id} className={p.id === pr.id ? 'on' : ''} onClick={() => { setPid(p.id); setPayLine(null); }}>{p.name}</button>)}</div>
      <section className="tiles">
        {tile('Projected profit', short(f.profit), `${(f.margin * 100).toFixed(1)}% margin if all plots sell at today's rate`, true)}
        {tile('Projected revenue', short(f.revenue), `${short(f.unsold)} still unsold`)}
        {tile('Total cost', short(f.cost), `incl. ${short(f.commEarned)} commission`)}
        {tile('Collected from buyers', short(f.collected), `of ${short(f.contract)} sold or booked`)}
        {tile('Due from buyers', short(f.pendingCust), `${custs.length} customers`)}
        {tile('We still owe', short(f.toPay), `${owe.length} parties`)}
      </section>

      <PerSqft pr={pr} sqft={mine.reduce((s, p) => s + Number(p.sqft), 0)} lines={f.lines} commission={f.commEarned} />

      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Money invested</h2><b className="num">{short(f.invested)}</b></div>
          <div className="bar" style={{ height: 14 }}>{fund.map(([l, v, c]) => <i key={l} style={{ width: `${f.invested ? (v / f.invested) * 100 : 0}%`, background: c }} />)}</div>
          <div className="list" style={{ marginTop: 8 }}>
            {fund.map(([l, v, c]) => (
              <div className="li" key={l}>
                <span className="sw" style={{ width: 12, height: 12, background: c, marginTop: 4 }} />
                <div className="body"><p>{l}</p></div>
                <b className="num">{inr(v)}</b>
                <span className="muted num" style={{ width: 48, textAlign: 'right' }}>{f.invested ? Math.round((v / f.invested) * 100) : 0}%</span>
              </div>
            ))}
          </div>
          <p className="hint">Cash position: collected {short(f.collected)} − paid out {short(f.out)} = <b className={f.net >= 0 ? 'pos' : 'neg'}>{short(f.net)}</b></p>
          {editFund ? (
            <form className="f" style={{ marginTop: 10 }} onSubmit={async (e) => {
              const d = form(e);
              const { error } = await supabase.from('project_funding').upsert({ project_id: pr.id, org_id: org.id, bank: +d.bank || 0, credit: +d.credit || 0, cash: +d.cash || 0 });
              if (error) return toast(error.message);
              toast('Funding saved');
              setEditFund(false);
              load();
            }}>
              <label>Bank loan (₹)<input name="bank" type="number" min="0" defaultValue={F.bank} /></label>
              <label>Credit (₹)<input name="credit" type="number" min="0" defaultValue={F.credit} /></label>
              <label>Own cash (₹)<input name="cash" type="number" min="0" defaultValue={F.cash} /></label>
              <div className="wide btns"><button className="btn pri">Save</button><button className="btn" type="button" onClick={() => setEditFund(false)}>Cancel</button></div>
            </form>
          ) : <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setEditFund(true)}>Edit funding</button>}
        </section>

        <section className="card">
          <div className="card-h"><h2>Customers yet to pay</h2><b className="num">{short(f.pendingCust)}</b></div>
          <div className="list">
            {custs.slice(0, 8).map((p) => (
              <div className="li" key={p.id} onClick={() => openPlot(p.id)} style={{ cursor: 'pointer' }}>
                <span className={`pill st-${p.status}`}>{p.label}</span>
                <div className="body"><p>{p.buyer_name}</p><span className="meta">{p.due_date ? `${p.due_date < today() ? 'overdue since' : 'due'} ${fmtD(p.due_date)}` : p.reg_date ? `by registration ${fmtD(p.reg_date)}` : ''}</span></div>
                <b className="num">{inr(plotBalance(pr, p))}</b>
              </div>
            ))}
            {!custs.length && <p className="empty">Nobody owes money on this project.</p>}
          </div>
          {custs.length > 8 && <p className="hint">+ {custs.length - 8} more in the plot list</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-h"><h2>Spend by head</h2><button className="btn sm" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add expense'}</button></div>
        {adding && (
          <form className="f" style={{ marginBottom: 12 }} onSubmit={async (e) => {
            const d = form(e);
            const ok = await rpc('add_cost_line', { p_project: pr.id, p_category: d.cat, p_party: d.party, p_committed: +d.committed || 0, p_paid: +d.paid || 0, p_account: d.account || null, p_date: d.date || null }, 'Expense added');
            done(ok, () => setAdding(false));
          }}>
            <label>Head<select name="cat">{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Paid to (party)<input name="party" required placeholder="e.g. Road contractor" /></label>
            <label>Total agreed (₹)<input name="committed" type="number" min="0" required /></label>
            <label>Paid now (₹)<input name="paid" type="number" min="0" defaultValue={0} /></label>
            <AccountSelect accounts={accounts} label="Paid from" />
            <label>Date<input name="date" type="date" defaultValue={today()} /></label>
            <div className="wide btns"><button className="btn pri">Add</button></div>
          </form>
        )}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Head</th><th>Party</th><th className="r">Agreed</th><th className="r">Paid</th><th className="r">To pay</th><th>Progress</th><th /></tr></thead>
            <tbody>
              {f.lines.map((c) => {
                const left = c.committed - c.paid;
                return [
                  <tr key={c.id}>
                    <td>{c.category}</td><td>{c.party}</td>
                    <td className="r">{inr(c.committed)}</td><td className="r">{inr(c.paid)}</td>
                    <td className={`r ${left > 0 ? 'neg' : ''}`}>{inr(left)}</td>
                    <td><span className="minibar"><i style={{ width: `${c.committed ? Math.min(100, (c.paid / c.committed) * 100) : 0}%` }} /></span></td>
                    <td>{left > 0 ? <button className="btn sm" onClick={() => setPayLine(c.id)}>Record payment</button> : <span className="tag">Settled</span>}</td>
                  </tr>,
                  payLine === c.id && (
                    <tr key={c.id + 'pay'}><td colSpan={7}>
                      <form className="f" onSubmit={async (e) => {
                        const d = form(e);
                        const ok = await rpc('pay_expense', { p_cost: c.id, p_amount: +d.amount, p_account: d.account || null, p_date: d.date || null, p_note: d.note || null }, `Payment to ${c.party} saved`);
                        done(ok, () => setPayLine(null));
                      }}>
                        <label>Amount paid to {c.party} (₹)<input name="amount" type="number" min="1" max={left} defaultValue={left} required /></label>
                        <AccountSelect accounts={accounts} label="Paid from" />
                        <label>Date<input name="date" type="date" defaultValue={today()} /></label>
                        <label>Bill / note<input name="note" placeholder="e.g. RA bill 3" /></label>
                        <div className="wide btns"><button className="btn pri">Save payment</button><button className="btn" type="button" onClick={() => setPayLine(null)}>Cancel</button></div>
                      </form>
                    </td></tr>
                  ),
                ];
              })}
              <tr>
                <td>Sales & broker commission</td><td>From Team page</td>
                <td className="r">{inr(f.commEarned)}</td><td className="r">{inr(f.commPaid)}</td>
                <td className={`r ${f.commEarned - f.commPaid > 0 ? 'neg' : ''}`}>{inr(Math.max(0, f.commEarned - f.commPaid))}</td>
                <td><span className="minibar"><i style={{ width: `${f.commEarned ? Math.min(100, (f.commPaid / f.commEarned) * 100) : 0}%` }} /></span></td>
                <td><button className="btn sm ghost" onClick={() => go('/team')}>Team</button></td>
              </tr>
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="r">{inr(f.cost)}</td><td className="r">{inr(f.out)}</td><td className="r">{inr(f.toPay)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
        {!f.lines.length && <p className="hint">Add land cost, registration, layout design, electricity, water, road, marketing and other heads to see the full picture.</p>}
      </section>

      <section className="card">
        <div className="card-h"><h2>Who we need to pay</h2><b className="num">{short(f.toPay)}</b></div>
        <div className="list">
          {owe.length ? owe.map(([p, c, a]) => (
            <div className="li" key={p + c}><div className="body"><p>{p}</p><span className="meta">{c}</span></div><b className="num neg">{inr(a)}</b></div>
          )) : <p className="empty">All parties are paid.</p>}
        </div>
      </section>
    </>
  );
}

/** What each saleable sq ft cost: the land, then development by head, then commission, against the sale rate. */
function PerSqft({ pr, sqft, lines, commission }: { pr: Project; sqft: number; lines: CostLine[]; commission: number }) {
  if (!sqft) return null;
  const rate = (n: number) => `₹${Math.round(n / sqft).toLocaleString('en-IN')}`;
  const land = lines.filter((c) => LAND_CATS.includes(c.category)).reduce((s, c) => s + Number(c.committed), 0);
  const heads = new Map<string, number>();
  for (const c of lines) if (!LAND_CATS.includes(c.category)) heads.set(c.category, (heads.get(c.category) ?? 0) + Number(c.committed));
  const dev = [...heads.values()].reduce((s, n) => s + n, 0);
  const allIn = land + dev + commission;
  const sale = Number(pr.sale_rate);
  const margin = sale - allIn / sqft;
  return (
    <section className="card">
      <div className="card-h"><h2>Cost per sq ft</h2><span className="lbl">on {Math.round(sqft).toLocaleString('en-IN')} sq ft of saleable {pr.kind === 'apartments' ? 'flats' : 'plots'}</span></div>
      <section className="tiles">
        {tile('Land purchase rate', rate(land), `${short(land)} land and registration`)}
        {tile('Development', rate(dev), `${heads.size} heads · ${short(dev)}`)}
        {tile('All-in cost', rate(allIn), `incl. ${rate(commission)} commission`)}
        {tile('Margin per sq ft', `₹${Math.round(margin).toLocaleString('en-IN')}`, `selling at ₹${sale.toLocaleString('en-IN')}/sq ft`, margin > 0)}
      </section>
      {heads.size > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {[...heads].sort((a, b) => b[1] - a[1]).map(([h, n]) => (
            <div className="li" key={h}><div className="body"><p>{h}</p></div><span className="muted num">{short(n)}</span><b className="num" style={{ width: 84, textAlign: 'right' }}>{rate(n)}/ft²</b></div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- bank & cash

const describe = (e: LedgerEntry) => [e.category, e.party, e.note].filter(Boolean).join(' · ');
const MANUAL = new Set(['income', 'other_expense', 'transfer', 'salary', 'asset']);

function BankTab({ money }: { money: Money }) {
  const { org, projects, rpc, toast } = useData();
  const { accounts, ledger, load } = money;
  const [sel, setSel] = useState<string>(accounts[0]?.id ?? '');
  const [panel, setPanel] = useState<'in' | 'out' | 'transfer' | 'account' | null>(null);
  const [per, setPer] = useState('all');
  const P = periods().find((p) => p.key === per)!;
  const acc = accounts.find((a) => a.id === sel) ?? accounts[0];
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '';
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + balanceOf(a, ledger), 0);
  const monthKey = today().slice(0, 7);

  const statement = useMemo(() => {
    if (!acc) return [];
    const rows = ledger.filter((e) => e.account_id === acc.id).slice().sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at));
    let run = Number(acc.opening_balance);
    const withBal = rows.map((e) => { run += signed(e); return { e, bal: run }; });
    return withBal.filter(({ e }) => inPeriod(e.txn_date, P)).reverse();
  }, [acc, ledger, P]);

  const refresh = async (ok: unknown, msg?: string) => { if (ok) { setPanel(null); if (msg) toast(msg); await load(); } };

  return (
    <>
      <section className="tiles">
        {tile('Total in bank & cash', short(total), `${accounts.filter((a) => a.active).length} accounts`, true)}
        {accounts.filter((a) => a.active).map((a) => {
          const m = ledger.filter((e) => e.account_id === a.id && e.txn_date.startsWith(monthKey));
          const mi = m.filter((e) => e.direction === 'in').reduce((s, e) => s + Number(e.amount), 0);
          const mo = m.filter((e) => e.direction === 'out').reduce((s, e) => s + Number(e.amount), 0);
          return (
            <button key={a.id} className={`tile acct${a.id === acc?.id ? ' on' : ''}`} onClick={() => setSel(a.id)}>
              <span className="lbl">{a.kind === 'cash' ? 'Cash' : a.bank_name || 'Bank'}{a.last4 ? ` ·${a.last4}` : ''}</span>
              <b>{short(balanceOf(a, ledger))}</b>
              <small>{a.name} · this month +{short(mi)} / −{short(mo)}</small>
            </button>
          );
        })}
      </section>

      <div className="btns">
        <button className="btn" onClick={() => setPanel(panel === 'in' ? null : 'in')}>+ Money in</button>
        <button className="btn" onClick={() => setPanel(panel === 'out' ? null : 'out')}>− Money out</button>
        <button className="btn" onClick={() => setPanel(panel === 'transfer' ? null : 'transfer')}>Transfer</button>
        <button className="btn ghost" onClick={() => setPanel(panel === 'account' ? null : 'account')}>Add account</button>
      </div>

      {(panel === 'in' || panel === 'out') && (
        <form className="f" onSubmit={async (e) => {
          const d = form(e);
          const ok = await rpc('add_ledger_entry', { p_direction: panel, p_amount: +d.amount, p_account: d.account, p_date: d.date, p_category: d.cat, p_party: d.party, p_note: d.note, p_project: d.project || null });
          refresh(ok, panel === 'in' ? 'Money in recorded' : 'Expense recorded');
        }}>
          <h3>{panel === 'in' ? 'Money in (other than plot sales)' : 'Money out (office and general expenses)'}</h3>
          <label>Category<select name="cat">{(panel === 'in' ? INCOME_CATS : EXPENSE_CATS).map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Amount (₹)<input name="amount" type="number" min="1" required /></label>
          <AccountSelect accounts={accounts} label={panel === 'in' ? 'Into account' : 'From account'} defaultValue={acc?.id} />
          <label>Date<input name="date" type="date" defaultValue={today()} /></label>
          <label>{panel === 'in' ? 'Received from' : 'Paid to'}<input name="party" /></label>
          <label>Project (optional)<select name="project"><option value="">Company-wide</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="wide">Note<input name="note" /></label>
          <p className="wide hint" style={{ margin: 0 }}>Plot payments, project expenses, commissions and salaries are recorded where they happen and appear here automatically.</p>
          <div className="wide btns"><button className="btn pri">Save</button><button className="btn" type="button" onClick={() => setPanel(null)}>Cancel</button></div>
        </form>
      )}
      {panel === 'transfer' && (
        <form className="f" onSubmit={async (e) => {
          const d = form(e);
          refresh(await rpc('transfer_funds', { p_from: d.from, p_to: d.to, p_amount: +d.amount, p_date: d.date, p_note: d.note }), 'Transfer saved');
        }}>
          <h3>Move money between accounts</h3>
          <AccountSelect accounts={accounts} name="from" label="From" defaultValue={acc?.id} />
          <AccountSelect accounts={accounts} name="to" label="To" defaultValue={accounts.find((a) => a.id !== acc?.id)?.id} />
          <label>Amount (₹)<input name="amount" type="number" min="1" required /></label>
          <label>Date<input name="date" type="date" defaultValue={today()} /></label>
          <label className="wide">Note<input name="note" placeholder="e.g. Cash withdrawn for site expenses" /></label>
          <div className="wide btns"><button className="btn pri">Save transfer</button><button className="btn" type="button" onClick={() => setPanel(null)}>Cancel</button></div>
        </form>
      )}
      {panel === 'account' && org && (
        <form className="f" onSubmit={async (e) => {
          const d = form(e);
          const { error } = await supabase.from('accounts').insert({ org_id: org.id, name: d.name.trim(), kind: d.kind, bank_name: d.bank || null, last4: d.last4 || null, opening_balance: +d.opening || 0 });
          if (error) return toast(error.message);
          refresh(true, 'Account added');
        }}>
          <h3>Add a bank or cash account</h3>
          <label>Name<input name="name" required placeholder="e.g. SBI current account" /></label>
          <label>Type<select name="kind"><option value="bank">Bank</option><option value="cash">Cash</option></select></label>
          <label>Bank<input name="bank" placeholder="e.g. SBI" /></label>
          <label>Last 4 digits<input name="last4" maxLength={4} inputMode="numeric" /></label>
          <label>Balance today (₹)<input name="opening" type="number" defaultValue={0} /></label>
          <div className="wide btns"><button className="btn pri">Add account</button><button className="btn" type="button" onClick={() => setPanel(null)}>Cancel</button></div>
        </form>
      )}

      {acc && (
        <section className="card">
          <div className="card-h">
            <h2>{acc.name} statement</h2>
            <div className="btns" style={{ alignItems: 'center' }}>
              <select className="mini-select" value={per} onChange={(e) => setPer(e.target.value)}>{periods().map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
              <button className="btn sm" onClick={() => downloadCsv(`${acc.name} statement.csv`, ['Date', 'Description', 'Project', 'In', 'Out', 'Balance'],
                statement.slice().reverse().map(({ e, bal }) => [e.txn_date, describe(e), projectName(e.project_id), e.direction === 'in' ? e.amount : '', e.direction === 'out' ? e.amount : '', Math.round(bal)]))}>Export</button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th>Project</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th><th /></tr></thead>
              <tbody>
                {statement.slice(0, 200).map(({ e, bal }) => (
                  <tr key={e.id}>
                    <td className="mono">{fmtD(e.txn_date)}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{describe(e)}</td>
                    <td>{projectName(e.project_id)}</td>
                    <td className="r pos">{e.direction === 'in' ? inr(e.amount) : ''}</td>
                    <td className="r neg">{e.direction === 'out' ? inr(e.amount) : ''}</td>
                    <td className="r">{inr(bal)}</td>
                    <td>{MANUAL.has(e.source) && <button className="linkbtn" onClick={async () => refresh(await rpc('delete_ledger_entry', { p_entry: e.id }), 'Entry deleted')}>Delete</button>}</td>
                  </tr>
                ))}
                {!statement.length && <tr><td colSpan={7} className="muted">No entries in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="hint">Opening balance {inr(acc.opening_balance)}. Balance updates by itself with every plot payment, expense, commission and salary paid from this account.</p>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- reports

function ReportsTab({ money }: { money: Money }) {
  const { projects, plots, members, org } = useData();
  const { ledger } = money;
  const [per, setPer] = useState('fy');
  const [pid, setPid] = useState('');
  const [events, setEvents] = useState<PlotEvent[]>([]);
  const P = periods().find((p) => p.key === per)!;

  useEffect(() => {
    if (!org) return;
    supabase.from('plot_events').select('*').eq('org_id', org.id).in('kind', ['sold', 'booked']).order('created_at', { ascending: false }).limit(5000)
      .then(({ data }) => setEvents((data ?? []) as PlotEvent[]));
  }, [org]);

  const rows = ledger.filter((e) => e.source !== 'transfer' && inPeriod(e.txn_date, P) && (!pid || e.project_id === pid));
  const sum = (xs: LedgerEntry[]) => xs.reduce((s, e) => s + Number(e.amount), 0);
  const inRows = rows.filter((e) => e.direction === 'in'), outRows = rows.filter((e) => e.direction === 'out');
  const collections = sum(inRows.filter((e) => e.source === 'customer_payment'));
  const totalIn = sum(inRows), totalOut = sum(outRows);
  const group = (xs: LedgerEntry[]) => {
    const m = new Map<string, number>();
    xs.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount)));
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const fundingRows = inRows.filter((e) => FUNDING_CATS.includes(e.category));
  const incomeLines = group(inRows.filter((e) => !FUNDING_CATS.includes(e.category))), expenseLines = group(outRows);
  const funding = sum(fundingRows), income = totalIn - funding;
  const topOut = Math.max(1, ...expenseLines.map(([, v]) => v));

  const plotById = new Map(plots.map((p) => [p.id, p]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const soldEv = events.filter((e) => e.kind === 'sold' && inPeriod(e.created_at.slice(0, 10), P)).filter((e) => !pid || plotById.get(e.plot_id)?.project_id === pid);
  const bookedEv = events.filter((e) => e.kind === 'booked' && inPeriod(e.created_at.slice(0, 10), P)).filter((e) => !pid || plotById.get(e.plot_id)?.project_id === pid);
  const valueOf = (e: PlotEvent) => { const p = plotById.get(e.plot_id); const pr = p && projectById.get(p.project_id); return p && pr ? plotValue(pr, p) : 0; };
  const soldValue = soldEv.reduce((s, e) => s + valueOf(e), 0);

  const months = lastMonths(12);
  const monthly = months.map((m) => {
    const xs = ledger.filter((e) => e.source !== 'transfer' && e.txn_date.startsWith(m.key) && (!pid || e.project_id === pid));
    return { label: m.label, in: sum(xs.filter((e) => e.direction === 'in')), out: sum(xs.filter((e) => e.direction === 'out')) };
  });

  // overdue customer balances and unpaid bills: the backlog that needs chasing
  const t = today();
  const overdue = plots.filter((p) => p.status !== 'available' && p.due_date && p.due_date < t && (!pid || p.project_id === pid))
    .map((p) => ({ p, pr: projectById.get(p.project_id)!, bal: plotBalance(projectById.get(p.project_id)!, p) })).filter((x) => x.bal > 0)
    .sort((a, b) => (a.p.due_date ?? '').localeCompare(b.p.due_date ?? ''));
  const overdueByProject = projects.map((pr) => ({ pr, amt: overdue.filter((x) => x.pr.id === pr.id).reduce((s, x) => s + x.bal, 0) })).filter((x) => x.amt > 0);

  const team = members.filter((m) => m.role === 'sales' || m.role === 'broker').map((m) => {
    const sold = soldEv.filter((e) => e.member === m.id);
    const value = sold.reduce((s, e) => s + valueOf(e), 0);
    const comm = sum(rows.filter((e) => e.source === 'commission' && e.member_id === m.id));
    const salary = sum(ledger.filter((e) => e.source === 'salary' && e.member_id === m.id && inPeriod(e.txn_date, P)));
    const cost = comm + salary;
    return { m, sold: sold.length, value, comm, salary, cost, roi: cost ? value / cost : null };
  }).sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="btns" style={{ alignItems: 'center' }}>
        <div className="seg">{periods().map((p) => <button key={p.key} className={per === p.key ? 'on' : ''} onClick={() => setPer(p.key)}>{p.label}</button>)}</div>
        <select className="mini-select" value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn sm" onClick={() => downloadCsv(`Plotskart ${P.label}.csv`, ['Date', 'In/Out', 'Category', 'Party', 'Note', 'Project', 'Amount'],
          rows.slice().sort((a, b) => a.txn_date.localeCompare(b.txn_date)).map((e) => [e.txn_date, e.direction === 'in' ? 'In' : 'Out', e.category, e.party, e.note, projectById.get(e.project_id ?? '')?.name ?? '', e.amount]))}>Export to Excel (CSV)</button>
      </div>
      <p className="hint" style={{ margin: 0 }}>{P.from ? `${fmtD(P.from)} to ${fmtD(P.to)}` : 'All time'} · financial year runs April to March</p>

      <section className="tiles">
        {tile('Net cash flow', short(totalIn - totalOut), `${short(totalIn)} in − ${short(totalOut)} out`, true)}
        {tile('Collected from buyers', short(collections), `${inRows.filter((e) => e.source === 'customer_payment').length} receipts`)}
        {tile('Plots sold', String(soldEv.length), `${short(soldValue)} sale value · ${bookedEv.length} booked`)}
        {tile('Spent', short(totalOut), `${expenseLines.length} heads`)}
        {tile('Overdue from buyers', short(overdue.reduce((s, x) => s + x.bal, 0)), `${overdue.length} customers late`)}
      </section>

      <section className="card">
        <div className="card-h"><h2>Money in and out, last 12 months</h2><span className="lbl"><i className="sw s-sold" />In <i className="sw s-available" style={{ marginLeft: 10 }} />Out</span></div>
        <MonthBars data={monthly} />
      </section>

      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Income and expenses</h2><span className="lbl">cash basis</span></div>
          <table className="pl">
            <tbody>
              <tr className="pl-h"><td>Income</td><td className="r">{inr(income)}</td></tr>
              {incomeLines.map(([k, v]) => <tr key={'i' + k}><td>{k}</td><td className="r">{inr(v)}</td></tr>)}
              <tr className="pl-h"><td>Expenses</td><td className="r">{inr(totalOut)}</td></tr>
              {expenseLines.map(([k, v]) => <tr key={'o' + k}><td>{k}</td><td className="r">{inr(v)}</td></tr>)}
              <tr className="pl-total"><td>{income >= totalOut ? 'Surplus' : 'Deficit'} from operations</td><td className={`r ${income >= totalOut ? 'pos' : 'neg'}`}>{inr(Math.abs(income - totalOut))}</td></tr>
              {funding > 0 && <tr><td className="muted">Funding received (loans and capital, not income)</td><td className="r muted">{inr(funding)}</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <div className="card-h"><h2>Where the money went</h2></div>
          <div className="hbars">
            {expenseLines.slice(0, 10).map(([k, v]) => (
              <div key={k} className="hbar"><span>{k}</span><i style={{ width: `${(v / topOut) * 100}%` }} /><b className="num">{short(v)}</b></div>
            ))}
            {!expenseLines.length && <p className="empty">No spending in this period.</p>}
          </div>
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Overdue payments</h2><b className="num neg">{short(overdue.reduce((s, x) => s + x.bal, 0))}</b></div>
          {overdueByProject.length > 1 && <p className="hint" style={{ marginTop: 0 }}>{overdueByProject.map((x) => `${x.pr.name}: ${short(x.amt)}`).join(' · ')}</p>}
          <div className="list">
            {overdue.slice(0, 10).map(({ p, pr, bal }) => (
              <div className="li" key={p.id}>
                <span className="pill st-booked">{p.label}</span>
                <div className="body"><p>{p.buyer_name}</p><span className="meta">{pr.name} · due {fmtD(p.due_date)}</span></div>
                <b className="num neg">{inr(bal)}</b>
              </div>
            ))}
            {!overdue.length && <p className="empty">No overdue payments.</p>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Team return on cost</h2><span className="lbl">{P.label}</span></div>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Person</th><th className="r">Sold</th><th className="r">Sale value</th><th className="r">Commission + salary</th><th className="r">Return</th></tr></thead>
              <tbody>
                {team.map((r) => (
                  <tr key={r.m.id}>
                    <td>{r.m.full_name}<br /><span className="muted" style={{ fontSize: '.76rem' }}>{r.m.role === 'broker' ? 'Broker' : 'Sales'}</span></td>
                    <td className="r">{r.sold}</td><td className="r">{short(r.value)}</td>
                    <td className="r">{short(r.cost)}</td>
                    <td className="r"><b>{r.roi ? `${Math.round(r.roi)}×` : '—'}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Return = value of plots sold ÷ commission and salary paid in the period.</p>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- assets

function AssetsTab({ money }: { money: Money }) {
  const { rpc } = useData();
  const { assets, accounts, load } = money;
  const [adding, setAdding] = useState(false);
  const live = assets.filter((a) => !a.disposed_on);
  const cost = live.reduce((s, a) => s + Number(a.cost), 0), value = live.reduce((s, a) => s + assetValue(a), 0);
  return (
    <>
      <section className="tiles">
        {tile('Assets worth today', short(value), 'after depreciation', true)}
        {tile('Bought for', short(cost), `${live.length} assets`)}
        {tile('Depreciation so far', short(cost - value), cost ? `${Math.round(((cost - value) / cost) * 100)}% of cost` : '')}
      </section>
      <section className="card">
        <div className="card-h"><h2>Company assets</h2><button className="btn sm" onClick={() => setAdding((a) => !a)}>{adding ? 'Close' : 'Add asset'}</button></div>
        {adding && (
          <form className="f" style={{ marginBottom: 12 }} onSubmit={async (e) => {
            const d = form(e);
            const ok = await rpc('add_asset', { p_name: d.name, p_category: d.cat, p_date: d.date, p_cost: +d.cost, p_dep: +d.dep, p_note: d.note, p_account: d.account || null, p_record_payment: d.paid === 'on' }, 'Asset added');
            if (ok) { setAdding(false); load(); }
          }}>
            <label>Asset<input name="name" required placeholder="e.g. Site vehicle" /></label>
            <label>Type<select name="cat">{['Vehicle', 'Machinery', 'Office', 'Land (non-project)', 'Computers', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Bought on<input name="date" type="date" defaultValue={today()} /></label>
            <label>Cost (₹)<input name="cost" type="number" min="0" required /></label>
            <label>Depreciation per year (%)<input name="dep" type="number" min="0" max="100" step="0.5" defaultValue={15} /></label>
            <AccountSelect accounts={accounts} label="Paid from" />
            <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input name="paid" type="checkbox" style={{ width: 'auto' }} /> Record the purchase payment in this account now</label>
            <label className="wide">Note<input name="note" /></label>
            <div className="wide btns"><button className="btn pri">Add asset</button></div>
          </form>
        )}
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Asset</th><th>Type</th><th>Bought</th><th className="r">Cost</th><th className="r">Dep./yr</th><th className="r">Worth today</th></tr></thead>
            <tbody>
              {live.map((a) => (
                <tr key={a.id}><td><b>{a.name}</b></td><td>{a.category}</td><td className="mono">{fmtD(a.purchase_date)}</td><td className="r">{inr(a.cost)}</td><td className="r">{a.depreciation_pct}%</td><td className="r">{inr(assetValue(a))}</td></tr>
              ))}
              {!live.length && <tr><td colSpan={6} className="muted">No assets yet. Add vehicles, machinery and office equipment to see what the company owns.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint">Value uses reducing-balance depreciation, the usual method for Indian books.</p>
      </section>
    </>
  );
}
