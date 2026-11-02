import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { short, ymd } from '../lib/format';
import { Avatar, Count, I, Seg, Sheet, firstName, tap } from './kit';
import { POINTS, daysLeftInMonth, useRace, useSalesEvents, useTargets, type Racer } from './racing';

type View = 'month' | 'last' | 'today' | 'streaks';

export function MRace() {
  const { profile, isOwner } = useData();
  const { events } = useSalesEvents();
  const [view, setView] = useState<View>('month');
  const { targets, reload } = useTargets();
  const last = useTargets(-1);
  const racers = useRace(events, targets);
  const lastRacers = useRace(events, last.targets, -1);
  const [editing, setEditing] = useState(false);

  const list = view === 'today'
    ? [...racers].sort((a, b) => b.todayPoints - a.todayPoints || b.earnedToday - a.earnedToday)
    : view === 'streaks' ? [...racers].sort((a, b) => b.streak - a.streak || b.points - a.points) : view === 'last' ? lastRacers : racers;
  const score = (r: Racer) => (view === 'today' ? r.todayPoints : view === 'streaks' ? r.streak : r.points);
  const top = Math.max(1, ...list.map(score));
  const left = daysLeftInMonth();

  return (
    <div className="m-page">
      <header className="m-head">
        <div className="t"><small>{new Date().toLocaleDateString('en-IN', { month: 'long' })} · {left} day{left === 1 ? '' : 's'} to the finish</small><h1>Team race</h1></div>
        {isOwner && <button className="m-iconbtn" aria-label="Set monthly targets" onClick={() => { tap(); setEditing(true); }}><I n="target" /></button>}
      </header>
      <div className="m-stack">
        <Seg value={view} onChange={setView} options={[['today', 'Today'], ['month', 'This month'], ['last', 'Last month'], ['streaks', 'Streaks']]} />

        {list.length === 0 ? (
          <div className="m-card m-empty"><div className="art">🏁</div><b>No racers yet</b>Salespeople and brokers race here once they join.</div>
        ) : <>
          {list.length >= 2 && (
            <section className="m-card" key={view}>
              <div className="m-podium">
                {[list[1], list[0], list[2]].map((r, slot) => r ? (
                  <div key={r.m.id} className={`p p${[2, 1, 3][slot]}`}>
                    {slot === 1 && score(r) > 0 && <span className="m-crown" aria-hidden="true">👑</span>}
                    <Avatar id={r.m.id} name={r.m.full_name} size={slot === 1 ? 62 : 50} crowned={slot === 1 && score(r) > 0} />
                    <b>{r.m.id === profile?.id ? 'You' : firstName(r.m.full_name)}</b>
                    <small className="num">{scoreText(view, r)}</small>
                    <div className="step">{[2, 1, 3][slot]}</div>
                  </div>
                ) : <div key={slot} />)}
              </div>
            </section>
          )}

          <section className="m-card" style={{ paddingBlock: 4 }} key={`lanes-${view}`}>
            {list.map((r, i) => <Lane key={r.m.id} r={r} rank={i + 1} pct={score(r) / top} view={view} me={r.m.id === profile?.id} />)}
          </section>
        </>}

        <section className="m-card flat">
          <p className="m-small" style={{ margin: 0 }}>
            <b>How points work:</b> booking {POINTS.booked}, registration {POINTS.registered}, sale {POINTS.sold}. A streak counts the weeks in a row
            with at least one booking or sale; this week keeps it alive until Sunday night.
          </p>
        </section>
      </div>
      {isOwner && <TargetSheet open={editing} onClose={() => setEditing(false)} racers={racers} onSaved={reload} />}
    </div>
  );
}

const scoreText = (view: View, r: Racer) =>
  view === 'today' ? `${r.todayPoints} pts today` : view === 'streaks' ? `${r.streak} wk streak` : `${r.points} pts`;

function Lane({ r, rank, pct, view, me }: { r: Racer; rank: number; pct: number; view: View; me: boolean }) {
  const toTarget = r.target?.units ? `${r.sold}/${r.target.units} target` : null;
  return (
    <div className="m-lane">
      <div className="lw">
        <span style={{ width: 20, fontWeight: 800, color: 'var(--m-sub)', textAlign: 'center' }}>{rank}</span>
        <Avatar id={r.m.id} name={r.m.full_name} size={38} />
        <div className="nm">
          <b>{me ? 'You' : r.m.full_name}{r.m.role === 'broker' && <span className="m-tag" style={{ marginLeft: 6 }}>Broker</span>}</b>
          <span>{view === 'today' ? `Earned ${short(r.earnedToday)} today` : `Earned ${short(r.earnedMonth)} · sold ${short(r.value)}`}</span>
        </div>
        <div className="pts num"><Count value={view === 'today' ? r.todayPoints : view === 'streaks' ? r.streak : r.points} /><small>{view === 'streaks' ? 'weeks' : 'points'}</small></div>
      </div>
      <div className="m-track" aria-hidden="true">
        <div className="fill" style={{ width: `calc(${Math.max(0.06, pct) * 100}% )` }} />
        <div className="runner" style={{ left: `calc(15px + ${Math.max(0, pct)} * (100% - 52px))` }}><Avatar id={r.m.id} name={r.m.full_name} size={30} /></div>
        <span className="flag">🏁</span>
      </div>
      <div className="m-tags">
        {view === 'today'
          ? <><span className="m-tag">{r.bookedToday} booked</span><span className="m-tag">{r.soldToday} sold</span></>
          : <><span className="m-tag">{r.booked} booked</span><span className="m-tag">{r.sold} sold</span><span className="m-tag">{r.registered} registered</span></>}
        {r.streak > 0 && <span className="m-tag m-flame">🔥 {r.streak} wk{r.streakAtRisk ? ' · at risk' : ''}</span>}
        {toTarget && <span className="m-tag" style={{ color: r.targetPct! >= 1 ? 'var(--m-mint)' : undefined }}>{r.targetPct! >= 1 ? '✓ ' : ''}{toTarget}</span>}
        {r.pipeline.length > 0 && <span className="m-tag">{r.pipeline.length} in pipeline</span>}
      </div>
    </div>
  );
}

function TargetSheet({ open, onClose, racers, onSaved }: { open: boolean; onClose: () => void; racers: Racer[]; onSaved: () => void }) {
  const { rpc } = useData();
  const [vals, setVals] = useState<Record<string, { units: string; value: string }>>({});
  const [busy, setBusy] = useState(false);
  const get = (r: Racer) => vals[r.m.id] ?? { units: r.target?.units ? String(r.target.units) : '', value: r.target?.value_paise ? String(Math.round(r.target.value_paise / 100 / 1e5)) : '' };
  const save = async () => {
    setBusy(true);
    const month = ymd(new Date());
    for (const r of racers) {
      if (!vals[r.m.id]) continue;
      const v = vals[r.m.id];
      const units = Math.max(0, parseInt(v.units || '0', 10) || 0);
      // the value is entered in lakhs (whole or with one decimal); stored in paise: lakhs × 1,00,000 × 100
      const tenthLakhs = Math.max(0, Math.round(parseFloat(v.value || '0') * 10) || 0);
      await rpc('set_sales_target', { p_member: r.m.id, p_month: month, p_units: units, p_value_paise: tenthLakhs * 1_000_000 });
    }
    setBusy(false);
    setVals({});
    onSaved();
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h2>Targets for {new Date().toLocaleDateString('en-IN', { month: 'long' })}</h2>
      <p className="m-sub m-small" style={{ marginBottom: 14 }}>How many plots or flats each person should sell, and the sales value in lakhs. Everyone in the team can see the targets.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {racers.map((r) => {
          const v = get(r);
          const set = (k: 'units' | 'value', x: string) => setVals((all) => ({ ...all, [r.m.id]: { ...v, [k]: x } }));
          return (
            <div key={r.m.id} className="m-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Avatar id={r.m.id} name={r.m.full_name} size={32} /><b style={{ flex: 1 }}>{r.m.full_name}</b>
                <span className="m-sub m-small">{r.sold} sold so far</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="m-field">Units to sell<input inputMode="numeric" value={v.units} onChange={(e) => set('units', e.target.value.replace(/\D/g, ''))} placeholder="0" /></label>
                <label className="m-field">Sales value (₹ lakh)<input inputMode="decimal" value={v.value} onChange={(e) => set('value', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></label>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18 }}><button className="m-btn" disabled={busy || !Object.keys(vals).length} onClick={save}>{busy ? 'Saving…' : 'Save targets'}</button></div>
    </Sheet>
  );
}
