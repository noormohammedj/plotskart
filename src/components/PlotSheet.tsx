import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import { DIR, SQFT_PER_CENT, SQM_PER_SQFT, dayOff, fmtD, inr } from '../lib/format';
import { fmtCommission, plotCommission } from '../lib/finance';
import { FloorPlanImg } from './FloorPlans';
import { plotBalance, plotValue, priceParts, stars, vastu } from '../lib/plots';
import { supabase } from '../lib/supabase';
import { MODES } from '../lib/money';
import type { Account, PlotEvent } from '../lib/types';
import { PlotDocs, PlotMoney } from './PlotExtras';
import { Pill } from './ui';

type Mode = 'book' | 'sell' | 'pay' | 'reg' | 'rate' | 'unit' | null;

const formData = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
};

export function PlotSheet() {
  const { sheetPlot, openPlot, plots, projects, towers, unitTypes, members, profile, canSell, isOwner, isFinance, rpc, memberName } = useData();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<PlotEvent[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (isFinance) supabase.from('accounts').select('*').eq('active', true).order('created_at').then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, [isFinance]);

  const p = plots.find((x) => x.id === sheetPlot);
  const pr = p && projects.find((x) => x.id === p.project_id);

  useEffect(() => {
    setMode(null);
    if (!sheetPlot) return;
    supabase.from('plot_events').select('*').eq('plot_id', sheetPlot).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setEvents((data ?? []) as PlotEvent[]));
  }, [sheetPlot, p?.updated_at]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && openPlot(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [openPlot]);

  if (!sheetPlot) return null;
  if (!p || !pr || !profile) return null;

  const v = plotValue(pr, p);
  const b = plotBalance(pr, p);
  const handler = members.find((m) => m.id === p.sold_by);
  const vs = vastu(p);
  const broker = profile.role === 'broker';
  // flats in apartment projects: tower, floor, unit type and a price breakdown
  const flat = p.tower_id ? {
    tower: towers.find((t) => t.id === p.tower_id),
    type: unitTypes.find((t) => t.id === p.unit_type_id),
    parts: priceParts(pr, p),
    types: unitTypes.filter((t) => t.project_id === pr.id),
  } : null;

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const res = await rpc(fn, { p_plot: p.id, ...args }, ok);
    setBusy(false);
    if (res) setMode(null);
  };

  const soldBy = broker ? null : (
    <label>Sold by
      <select name="by" defaultValue={profile.id}>
        {members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.role === 'owner' ? 'Owner (direct)' : m.full_name}</option>)}
      </select>
    </label>
  );
  const cancel = <button className="btn" type="button" onClick={() => setMode(null)}>Cancel</button>;
  // Meta only allows WhatsApp messages to buyers who agreed; SMS reminders go either way
  const waConsent = (
    <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <input name="wa" type="checkbox" style={{ width: 'auto' }} /> Customer agreed to get booking and payment updates on WhatsApp
    </label>
  );

  let form = null;
  if (mode === 'book') form = (
    <form className="f" onSubmit={(e) => { const d = formData(e); run('book_plot', { p_buyer: d.buyer, p_phone: d.phone, p_advance: +d.advance || 0, p_due: d.due || null, p_reg: d.reg || null, p_sold_by: d.by || null, p_whatsapp: d.wa === 'on' }, `${p.label} booked. Team notified.`); }}>
      <h3>Book {p.label}</h3>
      <label>Customer name<input name="buyer" required autoFocus /></label>
      <label>Mobile (WhatsApp)<input name="phone" type="tel" required placeholder="+91" /></label>
      <label>Advance received (₹)<input name="advance" type="number" min="0" required defaultValue={Math.round(v * 0.1 / 1e4) * 1e4} /></label>
      <label>Balance due by<input name="due" type="date" required defaultValue={dayOff(30)} /></label>
      <label>Registration date (optional)<input name="reg" type="date" /></label>
      {soldBy}
      {waConsent}
      <div className="wide btns"><button className="btn pri" disabled={busy}>Confirm booking</button>{cancel}</div>
    </form>
  );
  if (mode === 'sell') form = (
    <form className="f" onSubmit={(e) => { const d = formData(e); run('sell_plot', { p_amount: +d.amount || 0, p_reg: d.reg, p_buyer: d.buyer ?? null, p_phone: d.phone ?? null, p_sold_by: d.by || null, ...(p.status === 'available' ? { p_whatsapp: d.wa === 'on' } : {}) }, `${p.label} marked sold`); }}>
      <h3>Mark {p.label} as sold</h3>
      {p.status === 'available' && <>
        <label>Customer name<input name="buyer" required autoFocus /></label>
        <label>Mobile (WhatsApp)<input name="phone" type="tel" required placeholder="+91" /></label>
        {soldBy}
        {waConsent}
      </>}
      <label>Amount received now (₹)<input name="amount" type="number" min="0" defaultValue={Math.round(p.status === 'available' ? v : b)} /></label>
      <label>Registration date<input name="reg" type="date" required defaultValue={p.reg_date ?? dayOff(7)} /></label>
      <div className="wide btns"><button className="btn pri" disabled={busy}>Mark sold</button>{cancel}</div>
    </form>
  );
  if (mode === 'pay') form = (
    <form className="f" onSubmit={(e) => {
      const d = formData(e);
      run('record_payment', { p_amount: +d.amount, p_next_due: d.due || null, p_account: d.account || null, p_mode: d.mode || null, p_reference: d.reference || null, p_date: d.date || null }, 'Payment saved. Receipt ready under Payments received.');
    }}>
      <h3>Record customer payment</h3>
      <label>Amount (₹)<input name="amount" type="number" min="1" max={Math.round(b)} required defaultValue={Math.round(b)} autoFocus /></label>
      <label>Received on<input name="date" type="date" defaultValue={dayOff(0)} /></label>
      <label>Paid by<select name="mode" defaultValue="bank_transfer">{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Cheque / UTR no.<input name="reference" placeholder="optional" /></label>
      {isFinance && accounts.length > 0 && (
        <label>Into account<select name="account">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ·${a.last4}` : ''}</option>)}</select></label>
      )}
      <label>Next due date<input name="due" type="date" defaultValue={p.due_date ?? ''} /></label>
      <div className="wide btns"><button className="btn pri" disabled={busy}>Save payment</button>{cancel}</div>
    </form>
  );
  if (mode === 'reg') form = (
    <form className="f" onSubmit={(e) => { const d = formData(e); run('set_registration', { p_date: d.reg }, 'Registration date saved'); }}>
      <h3>Registration date</h3>
      <label className="wide">Date at Sub-Registrar office<input name="reg" type="date" required defaultValue={p.reg_date ?? dayOff(7)} autoFocus /></label>
      <div className="wide btns"><button className="btn pri" disabled={busy}>Save and notify</button>{cancel}</div>
    </form>
  );
  if (mode === 'rate') form = (
    <form className="f" onSubmit={(e) => { const d = formData(e); run('set_plot_rate', { p_rate: d.rate ? +d.rate : null }, p.status === 'available' ? 'Plot price saved' : `New price for ${p.buyer_name} saved. Team notified.`); }}>
      <h3>{p.status === 'available' ? `Price for ${p.label}` : `Price for ${p.buyer_name}`}</h3>
      {p.status !== 'available' && (
        <p className="wide hint" style={{ margin: 0 }}>
          A special price for this customer on plot {p.label}. The balance due, project finance and commission follow the new price, and the whole team is told.
        </p>
      )}
      <label className="wide">Sale rate (₹/sq ft). Now ₹{Number(p.rate_override || pr.sale_rate).toLocaleString('en-IN')}. Leave empty to use the project rate of ₹{Number(pr.sale_rate).toLocaleString('en-IN')}.
        <input name="rate" type="number" min="0" step="10" defaultValue={p.rate_override ?? ''} autoFocus /></label>
      <div className="wide btns"><button className="btn pri" disabled={busy}>Save</button>{cancel}</div>
    </form>
  );

  if (mode === 'unit' && flat) form = (
    <form className="f" onSubmit={(e) => { const d = formData(e); run('update_unit', { p_type: d.type || null, p_plc_paise: Math.round((+d.plc || 0) * 100), p_parking: +d.parking || 0 }, `${p.label} updated`); }}>
      <h3>Flat {p.label}</h3>
      <label>Unit type<select name="type" defaultValue={p.unit_type_id ?? ''}>{flat.types.map((t) => <option key={t.id} value={t.id}>{t.name} · {Number(t.saleable_sqft).toLocaleString('en-IN')} ft²</option>)}</select></label>
      <label>Car parks<input name="parking" type="number" min="0" max="5" defaultValue={p.parking_slots} /></label>
      <label className="wide">Preferred location charge (₹)<input name="plc" type="number" min="0" step="1000" defaultValue={p.plc_paise / 100} /></label>
      <div className="wide btns"><button className="btn pri" disabled={busy}>Save</button>{cancel}</div>
    </form>
  );

  const acts: [Exclude<Mode, null>, string, string][] = [];
  if (p.status === 'available') {
    acts.push(['book', flat ? 'Book flat' : 'Book plot', 'pri']);
    if (canSell) acts.push(['sell', 'Mark sold', ''], ['rate', flat ? 'Change flat price' : 'Change plot price', 'ghost']);
  }
  if (p.status === 'booked' && canSell) acts.push(['pay', 'Record payment', 'pri'], ['sell', 'Mark sold', ''], ['reg', p.reg_date ? 'Change registration date' : 'Set registration date', '']);
  if (p.status === 'sold' && canSell) {
    if (b > 0) acts.push(['pay', 'Record payment', 'pri']);
    if (!p.registered) acts.push(['reg', p.reg_date ? 'Change registration date' : 'Set registration date', '']);
  }
  if (p.status !== 'available' && isOwner) acts.push(['rate', 'Change price for this customer', 'ghost']);
  if (flat && isOwner) acts.push(['unit', 'Edit flat details', 'ghost']);
  // the accountant records money but does not book, sell or change prices
  if (profile.role === 'accountant' && p.status !== 'available' && b > 0) acts.push(['pay', 'Record payment', 'pri']);

  return (
    <>
      <div className="scrim" onClick={() => openPlot(null)} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={`Plot ${p.label}`}>
        <div className="sh-h">
          <div className="t">
            <span className="lbl">{pr.name}</span>
            <h2>{flat ? 'Flat' : 'Plot'} {p.label}</h2>
            <Pill status={p.status} extra={p.status === 'sold' && p.registered ? ' · registered' : ''} />
          </div>
          <button className="x" onClick={() => openPlot(null)} aria-label="Close">✕</button>
        </div>
        {flat ? (
          <div className="dl">
            <div><span className="lbl">Tower · floor</span><b>{flat.tower?.name ?? '—'} · {p.floor === 0 ? 'Ground' : `Floor ${p.floor}`}</b></div>
            <div><span className="lbl">Type</span><b>{flat.type?.name ?? '—'}</b></div>
            <div><span className="lbl">Carpet / built-up</span><b>{Number(flat.type?.carpet_sqft ?? 0).toLocaleString('en-IN')} / {Number(flat.type?.builtup_sqft ?? 0).toLocaleString('en-IN')} ft²</b></div>
            <div><span className="lbl">Saleable</span><b>{Number(p.sqft).toLocaleString('en-IN')} ft²</b></div>
            <div><span className="lbl">Facing</span><b>{p.facing.map((f) => DIR[f]).join(' + ') || '—'}</b></div>
            <div><span className="lbl">Car parks</span><b>{p.parking_slots}</b></div>
            <div><span className="lbl">{p.rate_override && p.status !== 'available' ? 'Customer rate' : 'Base rate'}</span><b>₹{Number(p.rate_override || pr.sale_rate).toLocaleString('en-IN')}/ft² · {inr(flat.parts.base)}</b></div>
            <div><span className="lbl">Floor rise</span><b>{inr(flat.parts.floorRise)}</b></div>
            <div><span className="lbl">Preferred location</span><b>{inr(flat.parts.plc)}</b></div>
            <div><span className="lbl">Car parking</span><b>{inr(flat.parts.parking)}</b></div>
            <div><span className="lbl">Flat price</span><b>{inr(v)}</b></div>
            <div><span className="lbl">GST {pr.gst_bp / 100}% (on top)</span><b>{inr((v * pr.gst_bp) / 10000)}</b></div>
          </div>
        ) : (
        <div className="dl">
          <div><span className="lbl">Size</span><b>{p.front_ft} × {p.depth_ft} ft</b></div>
          <div><span className="lbl">Area</span><b>{Number(p.sqft).toLocaleString('en-IN')} ft²</b></div>
          <div><span className="lbl">In cents</span><b>{(p.sqft / SQFT_PER_CENT).toFixed(2)} cents</b></div>
          <div><span className="lbl">In sq m</span><b>{(p.sqft * SQM_PER_SQFT).toFixed(1)} m²</b></div>
          <div><span className="lbl">Facing</span><b>{p.facing.map((f) => DIR[f]).join(' + ')}{p.facing.length > 1 ? ' (corner)' : ''}</b></div>
          <div><span className="lbl">{p.rate_override && p.status !== 'available' ? 'Customer price' : 'Sale rate'}</span><b>₹{Number(p.rate_override || pr.sale_rate).toLocaleString('en-IN')}/ft²{p.rate_override ? ` (project ₹${Number(pr.sale_rate).toLocaleString('en-IN')})` : ''}</b></div>
          <div><span className="lbl">Sale value</span><b>{inr(v)}</b></div>
          <div><span className="lbl">Guideline value</span><b>{inr(p.sqft * pr.guideline_rate)}</b></div>
        </div>
        )}

        {flat?.type?.plan_path && (
          <section className="sec">
            <h3>Floor plan · {flat.type.name}</h3>
            <FloorPlanImg type={flat.type} />
          </section>
        )}

        <section className="sec">
          <div className="card-h" style={{ margin: 0 }}><h3>Vastu</h3><span className="stars" aria-label={`${vs.score} out of 5`}>{stars(vs.score)}</span></div>
          <div className="vastu">
            {vs.notes.map((n) => <div className="vrow" key={n.title}><i className={n.tone} /><div><b>{n.title}</b><small>{n.detail}</small></div></div>)}
          </div>
          <p className="hint">{flat ? 'Based on common vastu guidance for the direction of the main door.' : 'Based on common vastu guidance for plot facing, corner and shape.'}</p>
        </section>

        {p.status !== 'available' && (
          <section className="sec">
            <h3>Customer & payment</h3>
            <div className="dl">
              <div><span className="lbl">Customer</span><b>{p.buyer_name}</b></div>
              <div><span className="lbl">Mobile</span><b>{p.buyer_phone}</b></div>
              <div className="wide">
                <span className="lbl">WhatsApp updates</span>
                <b>{p.buyer_whatsapp ? 'Customer agreed' : 'Not agreed (SMS only)'}</b>
                {canSell && (
                  <button className="linkbtn" style={{ marginLeft: 10 }} disabled={busy}
                    onClick={() => run('set_buyer_whatsapp', { p_ok: !p.buyer_whatsapp }, p.buyer_whatsapp ? 'WhatsApp updates switched off' : 'WhatsApp updates switched on')}>
                    {p.buyer_whatsapp ? 'Switch off' : 'Customer agreed'}
                  </button>
                )}
              </div>
              <div><span className="lbl">Paid</span><b>{inr(p.paid)}</b></div>
              <div><span className="lbl">Balance</span><b className={b > 0 ? 'neg' : 'pos'}>{inr(b)}</b></div>
              <div><span className="lbl">Balance due</span><b>{b > 0 && p.due_date ? fmtD(p.due_date) : '—'}</b></div>
              <div><span className="lbl">Registration</span><b>{p.reg_date ? fmtD(p.reg_date) : 'Not set'}</b></div>
              <div className={isOwner && handler && handler.role !== 'owner' ? '' : 'wide'}><span className="lbl">Handled by</span><b>{memberName(p.sold_by)}</b></div>
              {isOwner && handler && handler.role !== 'owner' && (
                <div>
                  <span className="lbl">Commission{p.status === 'sold' ? '' : ' if sold'}</span>
                  <b>{inr(plotCommission(pr, p, handler))} · {fmtCommission(p.commission_type ?? handler.commission_type, p.commission_rate ?? handler.commission_rate)}</b>
                </div>
              )}
            </div>
          </section>
        )}

        {form ?? (acts.length ? (
          <div className="btns">
            {acts.map(([k, l, c]) => <button key={k} className={`btn ${c}`} onClick={() => setMode(k)}>{l}</button>)}
            {p.status === 'sold' && !p.registered && p.reg_date && canSell && (
              <button className="btn" disabled={busy} onClick={() => run('complete_registration', {}, 'Registration marked complete')}>Registration done</button>
            )}
            {p.status === 'booked' && isOwner && (
              <button className="btn ghost danger" disabled={busy} onClick={() => run('cancel_booking', {}, 'Booking cancelled. Plot is available again.')}>Cancel booking</button>
            )}
          </div>
        ) : <p className="muted">You can view this plot. The owner or sales team can change it.</p>)}

        {p.status !== 'available' && profile.role !== 'broker' && <PlotMoney p={p} pr={pr} />}
        {p.status !== 'available' && profile.role !== 'broker' && <PlotDocs p={p} />}

        {events.length > 0 && (
          <section className="sec">
            <h3>History</h3>
            <div className="list">
              {events.map((e) => <div className="li" key={e.id}><div className="body"><p>{e.text}</p><span className="meta">{memberName(e.actor)} · {fmtD(e.created_at)}</span></div></div>)}
            </div>
          </section>
        )}
      </section>
    </>
  );
}
