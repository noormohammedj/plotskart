import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { commissionOf, projectFinance } from '../lib/finance';
import { fmtD, short, today, whenTxt } from '../lib/format';
import { lastMonths } from '../lib/money';
import { counts, plotBalance, plotValue, unitWord } from '../lib/plots';
import { reminderTitle, upcomingReminders } from '../lib/reminders';
import { supabase } from '../lib/supabase';
import type { CommissionPayment } from '../lib/types';
import { balanceOf, useOwnerMoney } from '../pages/Finance';
import { Avatar, Confetti, Count, I, Ring, cheer, firstName, greeting, tap } from './kit';
import { coach, daysLeftInMonth, useRace, useSalesEvents, useTargets, type Racer } from './racing';

const money = (n: number) => short(n);

function Header({ title }: { title: string }) {
  const { profile, unread } = useData();
  return (
    <header className="m-head">
      <div className="t">
        <small>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</small>
        <h1>{title}{profile ? `, ${firstName(profile.full_name)}` : ''}</h1>
      </div>
      <button className="m-iconbtn" aria-label={`Alerts, ${unread} unread`} onClick={() => { tap(); go('/alerts'); }}>
        <I n="bell" />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </header>
  );
}

export function MHome() {
  const { isFinance } = useData();
  return isFinance ? <OwnerHome /> : <SellerHome />;
}

/* ------------------------------------------------------------------ owner */

function OwnerHome() {
  const { projects, plots, members } = useData();
  const money$ = useOwnerMoney();
  const { events } = useSalesEvents();
  const { targets } = useTargets();
  const racers = useRace(events, targets);
  const month = today().slice(0, 7);

  const c = counts(plots);
  const byId = new Map(projects.map((p) => [p.id, p]));
  let inventory = 0, contract = 0, due = 0;
  for (const p of plots) {
    const pr = byId.get(p.project_id);
    if (!pr) continue;
    const v = plotValue(pr, p);
    inventory += v;
    if (p.status !== 'available') { contract += v; due += plotBalance(pr, p); }
  }

  const monthEvents = events.filter((e) => e.created_at.slice(0, 7) === month);
  const soldValue = monthEvents.filter((e) => e.kind === 'sold').reduce((s, e) => {
    const p = plots.find((x) => x.id === e.plot_id), pr = p && byId.get(p.project_id);
    return s + (p && pr ? plotValue(pr, p) : 0);
  }, 0);
  const ledger = money$.ledger.filter((e) => e.source !== 'transfer');
  const collectedMonth = ledger.filter((e) => e.source === 'customer_payment' && e.txn_date.slice(0, 7) === month).reduce((s, e) => s + Number(e.amount), 0);
  const cash = money$.accounts.filter((a) => a.active).reduce((s, a) => s + balanceOf(a, money$.ledger), 0);

  const pl = projects.map((pr) => ({ pr, f: projectFinance(pr, plots, money$.costs, money$.funding.find((x) => x.project_id === pr.id), members, money$.payments) }))
    .sort((a, b) => b.f.profit - a.f.profit);
  const maxRev = Math.max(1, ...pl.map((x) => Math.max(x.f.revenue, x.f.cost)));
  const totalProfit = pl.reduce((s, x) => s + x.f.profit, 0);

  const months = lastMonths(6);
  const trend = months.map((m) => ({
    ...m,
    booked: events.filter((e) => e.kind === 'booked' && e.created_at.slice(0, 7) === m.key).length,
    sold: events.filter((e) => e.kind === 'sold' && e.created_at.slice(0, 7) === m.key).length,
    in: ledger.filter((e) => e.direction === 'in' && e.txn_date.slice(0, 7) === m.key).reduce((s, e) => s + Number(e.amount), 0),
    out: ledger.filter((e) => e.direction === 'out' && e.txn_date.slice(0, 7) === m.key).reduce((s, e) => s + Number(e.amount), 0),
  }));
  const maxCount = Math.max(1, ...trend.map((t) => t.booked + t.sold));
  const maxCash = Math.max(1, ...trend.map((t) => Math.max(t.in, t.out)));
  const tips = coach(racers);

  return (
    <div className="m-page">
      <Header title={greeting()} />
      <div className="m-stack">
        <section className="m-hero" aria-label="Portfolio">
          <div className="m-hero-row">
            <Ring value={inventory ? contract / inventory : 0} size={118} stroke={13}>
              <b><Count value={inventory ? (contract / inventory) * 100 : 0} />%</b><span>taken</span>
            </Ring>
            <div className="info">
              <div className="lab">Portfolio</div>
              <div className="big num"><Count value={contract} fmt={money} /></div>
              <div className="sm">booked or sold of {money(inventory)} across {projects.length} project{projects.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="hchips">
            <span className="hchip"><i style={{ background: '#7CF2C5' }} />{c.sold} sold</span>
            <span className="hchip"><i style={{ background: '#FFD27A' }} />{c.booked} booked</span>
            <span className="hchip"><i />{c.available} available</span>
          </div>
        </section>

        <div className="m-tiles">
          <Tile tone="mint" icon="trend" label="Sold this month" value={soldValue} />
          <Tile tone="sky" icon="coin" label="Collected this month" value={collectedMonth} />
          <Tile tone="violet" icon="bank" label="Cash in bank & hand" value={cash} />
          <Tile tone="amber" icon="wallet" label="Still due from buyers" value={due} />
        </div>

        <section className="m-card">
          <div className="m-cardhead"><h3>Profit by project</h3><span className="num" style={{ color: totalProfit < 0 ? 'var(--m-red)' : 'var(--m-mint)' }}>{totalProfit < 0 ? 'Loss ' : ''}{money(Math.abs(totalProfit))}</span></div>
          {pl.length ? (
            <div className="m-pl">
              {pl.map(({ pr, f }) => {
                const loss = f.profit < 0;
                return (
                  <button key={pr.id} className="m-row" style={{ display: 'block', padding: 0 }} onClick={() => { tap(); go(`/finance`); }}>
                    <div className="hd"><b>{pr.name}</b><span className="num" style={{ color: loss ? 'var(--m-red)' : 'var(--m-mint)' }}>{loss ? '−' : '+'}{money(Math.abs(f.profit)).replace('−', '')} · {Math.round(f.margin * 100)}%</span></div>
                    <div className="track">
                      <i style={{ width: `${(f.revenue / maxRev) * 100}%`, background: 'var(--m-mint-soft)' }} />
                      <i style={{ width: `${(f.cost / maxRev) * 100}%`, background: loss ? 'var(--m-red)' : 'linear-gradient(90deg,var(--m-violet),var(--m-rose))', animationDelay: '.15s' }} />
                    </div>
                    <div className="meta"><span>Cost {money(f.cost)} · in {money(f.collected)}</span><span>Value {money(f.revenue)}</span></div>
                  </button>
                );
              })}
            </div>
          ) : <p className="m-sub m-small">Add a project to see its profit here.</p>}
          <div className="m-legend"><span><i style={{ background: 'linear-gradient(90deg,var(--m-violet),var(--m-rose))' }} />Cost so far + committed</span><span><i style={{ background: 'var(--m-mint-soft)' }} />Sale value when all sold</span></div>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Sales, last 6 months</h3><span>{unitWord(undefined)} & flats</span></div>
          <div className="m-cols">
            {trend.map((t, i) => (
              <div key={t.key} className={`col${i === trend.length - 1 ? ' now' : ''}`}>
                <div className="bars">
                  <i style={{ height: `${(t.booked / maxCount) * 100}%`, background: 'var(--m-amber)' }} title={`${t.booked} booked`} />
                  <i style={{ height: `${(t.sold / maxCount) * 100}%`, background: 'var(--m-mint)' }} title={`${t.sold} sold`} />
                </div>
                <span className="ml">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="m-legend"><span><i style={{ background: 'var(--m-amber)' }} />Booked</span><span><i style={{ background: 'var(--m-mint)' }} />Sold</span></div>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Cash flow</h3><span>money in and out</span></div>
          <div className="m-cols">
            {trend.map((t, i) => (
              <div key={t.key} className={`col${i === trend.length - 1 ? ' now' : ''}`}>
                <div className="bars">
                  <i style={{ height: `${(t.in / maxCash) * 100}%`, background: 'var(--m-sky)' }} />
                  <i style={{ height: `${(t.out / maxCash) * 100}%`, background: 'var(--m-rose)' }} />
                </div>
                <span className="ml">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="m-legend"><span><i style={{ background: 'var(--m-sky)' }} />In {money(trend[trend.length - 1]?.in ?? 0)}</span><span><i style={{ background: 'var(--m-rose)' }} />Out {money(trend[trend.length - 1]?.out ?? 0)}</span><span>this month</span></div>
        </section>

        <div className="m-sec"><h2>Team race</h2><button onClick={() => { tap(); go('/race'); }}>See all</button></div>
        <section className="m-card">
          {racers.length ? <MiniBoard racers={racers.slice(0, 3)} /> : <p className="m-sub m-small">Invite salespeople or brokers from More → Team to start the race.</p>}
          {tips.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--m-line)', paddingTop: 4 }}>
              <p className="m-small" style={{ fontWeight: 800, margin: '10px 0 0' }}>Who needs what</p>
              {tips.map((t, i) => (
                <div key={i} className="m-insight">
                  <span className={`m-badge t-${t.tone === 'warn' ? 'amber' : t.tone === 'good' ? 'mint' : 'sky'}`}><I n={t.tone === 'warn' ? 'bolt' : t.tone === 'good' ? 'check' : 'users'} /></span>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <Upcoming />
      </div>
    </div>
  );
}

function Tile({ tone, icon, label, value }: { tone: string; icon: 'trend' | 'coin' | 'bank' | 'wallet'; label: string; value: number }) {
  return (
    <div className="m-tile">
      <div className={`ic t-${tone}`}><I n={icon} /></div>
      <b className="num"><Count value={value} fmt={money} /></b>
      <span>{label}</span>
    </div>
  );
}

function MiniBoard({ racers }: { racers: Racer[] }) {
  return (
    <div className="m-list">
      {racers.map((r, i) => (
        <button key={r.m.id} className="m-row" onClick={() => { tap(); go('/race'); }}>
          <span style={{ width: 18, fontWeight: 800, color: 'var(--m-sub)' }}>{i + 1}</span>
          <Avatar id={r.m.id} name={r.m.full_name} size={38} crowned={i === 0 && r.points > 0} />
          <div className="body"><b>{r.m.full_name}</b><span>{r.sold} sold · {r.booked} booked{r.streak ? ` · 🔥 ${r.streak} wk` : ''}</span></div>
          <div className="end num">{r.points}<small>points</small></div>
        </button>
      ))}
    </div>
  );
}

function Upcoming() {
  const { projects, plots, profile, openPlot } = useData();
  if (!profile) return null;
  const list = upcomingReminders(projects, plots, profile, 14).slice(0, 5);
  if (!list.length) return null;
  return (
    <>
      <div className="m-sec"><h2>Coming up</h2></div>
      <section className="m-card" style={{ paddingBlock: 6 }}>
        <div className="m-list">
          {list.map((r) => (
            <button key={r.type + r.p.id} className="m-row wrap" onClick={() => { tap(); openPlot(r.p.id); }}>
              <span className={`m-badge ${r.type === 'reg' ? 't-violet' : r.d < 0 ? 't-red' : 't-sky'}`}><I n={r.type === 'reg' ? 'stamp' : 'coin'} /></span>
              <div className="body"><b>{reminderTitle(r)}</b><span>{r.p.label} · {r.pr.name} · {r.p.buyer_name}</span></div>
              <div className="end" style={{ fontSize: '.78rem', color: 'var(--m-sub)' }}>{fmtD(r.type === 'reg' ? r.p.reg_date : r.p.due_date).replace(/ \d{4}$/, '')}</div>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ salesperson / broker */

function SellerHome() {
  const { profile, projects, plots, openPlot } = useData();
  const { events } = useSalesEvents();
  const { targets } = useTargets();
  const racers = useRace(events, targets);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  useEffect(() => {
    if (!profile) return;
    supabase.from('commission_payments').select('*').eq('member_id', profile.id).then(({ data }) => setPayments((data ?? []) as CommissionPayment[]));
  }, [profile]);

  const meIdx = racers.findIndex((r) => r.m.id === profile?.id);
  const me = racers[meIdx];
  const all = useMemo(() => (profile ? commissionOf(profile, projects, plots, payments) : null), [profile, projects, plots, payments]);
  const hit = !!me?.target?.units && me.sold >= me.target.units;
  useEffect(() => { if (hit) cheer(); }, [hit]);
  if (!profile) return null;
  const left = daysLeftInMonth();
  const ahead = meIdx > 0 ? racers[meIdx - 1] : null;
  const units = me?.target?.units ?? 0;

  return (
    <div className="m-page">
      <Header title={greeting()} />
      <div className="m-stack">
        <section className="m-hero alt" aria-label="This month's target">
          {hit && <Confetti />}
          <div className="m-hero-row">
            <Ring value={units ? (me?.sold ?? 0) / units : 0} size={132} stroke={14}>
              {units ? <><b className="num">{me?.sold ?? 0}<span style={{ fontSize: '1rem', opacity: .8 }}>/{units}</span></b><span>sold</span></> : <><b className="num">{me?.sold ?? 0}</b><span>sold</span></>}
            </Ring>
            <div className="info">
              <div className="lab">{new Date().toLocaleDateString('en-IN', { month: 'long' })} target</div>
              <div className="big num"><Count value={me?.earnedMonth ?? 0} fmt={money} /></div>
              <div className="sm">commission earned this month</div>
              <div className="sm" style={{ marginTop: 8, fontWeight: 700 }}>
                {hit ? 'Target hit. Brilliant work!' : units ? `${units - (me?.sold ?? 0)} more to go · ${left} day${left === 1 ? '' : 's'} left` : 'No target set yet for this month'}
              </div>
            </div>
          </div>
          {me?.target?.value_paise ? (
            <div style={{ marginTop: 16 }}>
              <div className="m-prog" style={{ background: 'rgba(255,255,255,.25)' }}><i style={{ width: `${Math.min(100, (me.value / (me.target.value_paise / 100)) * 100)}%`, background: '#fff' }} /></div>
              <div className="sm">{money(me.value)} of {money(me.target.value_paise / 100)} sales value</div>
            </div>
          ) : null}
        </section>

        <div className="m-tiles">
          <div className="m-tile">
            <div className="ic t-amber"><I n="bolt" /></div>
            <b className="num">{me?.streak ? `🔥 ${me.streak} wk` : '—'}</b>
            <span>{me?.streakAtRisk ? 'Streak at risk: book this week' : me?.streak ? 'Weeks in a row' : 'Book this week to start a streak'}</span>
            <div className="m-weeks">{(me?.weeks ?? Array(8).fill(false)).map((w, i, a) => <i key={i} className={`${w ? 'on' : ''}${i === a.length - 1 ? ' now' : ''}`} />)}</div>
          </div>
          <button className="m-tile m-press" style={{ all: 'unset', boxSizing: 'border-box', background: 'var(--m-card)', borderRadius: 22, padding: '15px 16px', boxShadow: 'var(--m-shadow)', cursor: 'pointer' }} onClick={() => { tap(); go('/race'); }}>
            <div className="ic t-rose"><I n="flag" /></div>
            <b className="num">{meIdx >= 0 ? `#${meIdx + 1}` : '—'}<span style={{ display: 'inline', fontSize: '.85rem', color: 'var(--m-sub)' }}> of {racers.length}</span></b>
            <span>{meIdx === 0 && me?.points ? 'You lead the race!' : ahead ? `${ahead.points - (me?.points ?? 0) + 1} point${ahead.points - (me?.points ?? 0) === 0 ? '' : 's'} to pass ${firstName(ahead.m.full_name)}` : 'Team race'}</span>
          </button>
        </div>

        <section className="m-card">
          <div className="m-cardhead"><h3>My earnings</h3><span>commission</span></div>
          <div className="m-tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 }}>
            <Mini label="Today" value={me?.earnedToday ?? 0} tone="var(--m-rose)" />
            <Mini label="Paid to me" value={all?.paid ?? 0} tone="var(--m-mint)" />
            <Mini label="Pending" value={all?.pending ?? 0} tone="var(--m-amber)" />
          </div>
        </section>

        <div className="m-sec"><h2>My pipeline</h2><span className="m-sub m-small">{me?.pipeline.length ?? 0} booked · {money(me?.pipelineValue ?? 0)}</span></div>
        <section className="m-card" style={{ paddingBlock: 6 }}>
          {me?.pipeline.length ? (
            <div className="m-list">
              {me.pipeline.map((p) => {
                const pr = projects.find((x) => x.id === p.project_id);
                return (
                  <button key={p.id} className="m-row" onClick={() => { tap(); openPlot(p.id); }}>
                    <span className="m-badge t-amber" style={{ fontWeight: 800, fontSize: '.8rem' }}>{p.label}</span>
                    <div className="body"><b>{p.buyer_name}</b><span>{pr?.name} · {p.due_date ? `balance due ${whenTxt(Math.round((new Date(p.due_date).getTime() - Date.now()) / 864e5))}` : 'no due date'}</span></div>
                    <div className="end num">{pr ? money(plotValue(pr, p) - p.paid) : ''}<small>to collect</small></div>
                  </button>
                );
              })}
            </div>
          ) : <div className="m-empty"><div className="art">🌱</div><b>No open bookings</b>Book a plot to start your pipeline.</div>}
        </section>

        <Upcoming />
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ background: 'var(--m-sunk)', borderRadius: 16, padding: '12px 10px', minWidth: 0 }}>
      <b className="num" style={{ display: 'block', fontWeight: 800, fontSize: '1.02rem', color: tone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><Count value={value} fmt={money} /></b>
      <span style={{ fontSize: '.74rem', fontWeight: 600, color: 'var(--m-sub)' }}>{label}</span>
    </div>
  );
}

