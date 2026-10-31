import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { dayOff, fmtD, inr, today } from '../lib/format';
import { MODES } from '../lib/money';
import { plotBalance, plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { CustomerPayment, Installment, Plot, PlotDocument, Project } from '../lib/types';
import { isNative, openExternal } from '../lib/native';

/** Payments received (with receipts) and the instalment plan for a booked or sold plot. */
export function PlotMoney({ p, pr }: { p: Plot; pr: Project }) {
  const { canSell, isFinance, rpc, openPlot } = useData();
  const [pays, setPays] = useState<CustomerPayment[]>([]);
  const [plan, setPlan] = useState<Installment[]>([]);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ due_date: string; amount: number }[]>([]);
  const [split, setSplit] = useState(3);
  const canEdit = canSell || isFinance;

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('customer_payments').select('*').eq('plot_id', p.id).order('received_on').order('receipt_no'),
      supabase.from('plot_installments').select('*').eq('plot_id', p.id).order('due_date'),
    ]);
    // a plot can change hands after a cancelled booking: show only this customer's payments
    setPays(((a.data ?? []) as CustomerPayment[]).filter((x) => !x.buyer_name || x.buyer_name === p.buyer_name));
    setPlan((b.data ?? []) as Installment[]);
  }, [p.id, p.buyer_name]);
  useEffect(() => { load(); }, [load, p.paid, p.updated_at]);

  const value = plotValue(pr, p), bal = plotBalance(pr, p);
  // an instalment is paid once everything up to and including it is covered
  let cum = 0;
  const t = today();
  const status = plan.map((i) => {
    cum += Number(i.amount);
    return cum <= Number(p.paid) + 0.5 ? 'paid' : i.due_date < t ? 'late' : 'due';
  });

  const startEdit = () => {
    setRows(plan.length ? plan.map((i) => ({ due_date: i.due_date, amount: Number(i.amount) })) : []);
    setEditing(true);
  };
  const doSplit = () => {
    const n = Math.max(1, split), each = Math.floor(bal / n);
    setRows(Array.from({ length: n }, (_, k) => ({ due_date: dayOff(30 * (k + 1)), amount: k === n - 1 ? Math.round(bal - each * (n - 1)) : each })));
  };
  // instalments cover the whole price, so already-paid money counts as the first part
  const planTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) + (plan.length ? 0 : Number(p.paid));
  const save = async () => {
    const items = plan.length ? rows : [{ due_date: today(), amount: Number(p.paid) }, ...rows];
    const ok = await rpc('save_installments', { p_plot: p.id, p_items: items.filter((r) => r.amount > 0) }, 'Payment plan saved');
    if (ok) { setEditing(false); load(); }
  };

  return (
    <>
      <section className="sec">
        <div className="card-h" style={{ margin: 0 }}><h3>Payments received</h3><span className="num">{inr(p.paid)} of {inr(value)}</span></div>
        <div>
          {pays.map((x) => (
            <div className="pay-row" key={x.id}>
              <div>
                <b className="num">{inr(x.amount)}</b> <span className="muted">· {fmtD(x.received_on)}{x.mode ? ` · ${MODES[x.mode]}` : ''}{x.reference ? ` · ${x.reference}` : ''}</span>
              </div>
              <button className="btn sm ghost" onClick={() => { openPlot(null); go(`/receipt/${x.id}`); }}>Receipt #{x.receipt_no}</button>
            </div>
          ))}
          {!pays.length && <p className="muted">No payments recorded yet.</p>}
        </div>
      </section>

      <section className="sec">
        <div className="card-h" style={{ margin: 0 }}>
          <h3>Payment plan</h3>
          {canEdit && !editing && bal > 0 && <button className="linkbtn" onClick={startEdit}>{plan.length ? 'Change plan' : 'Set instalments'}</button>}
        </div>
        {!editing && (plan.length ? (
          <div>
            {plan.map((i, k) => (
              <div className="pay-row" key={i.id}>
                <div><b className="num">{inr(i.amount)}</b> <span className="muted">· {fmtD(i.due_date)}{i.note ? ` · ${i.note}` : ''}</span></div>
                <span className={`inst-status ${status[k]}`}>{status[k] === 'paid' ? 'Paid' : status[k] === 'late' ? 'Overdue' : 'Due'}</span>
              </div>
            ))}
            <p className="hint">Reminders follow the next unpaid instalment automatically.</p>
          </div>
        ) : <p className="muted">{bal > 0 ? 'One balance due date. Set instalments to split the balance into a schedule.' : 'Fully paid.'}</p>)}
        {editing && (
          <div className="sec" style={{ background: 'var(--sunk)', borderRadius: 10, padding: 12 }}>
            {!plan.length && <p className="hint" style={{ margin: 0 }}>Already paid: {inr(p.paid)}. Plan the balance of {inr(bal)} below.</p>}
            <div className="btns" style={{ alignItems: 'center' }}>
              <span>Split balance into</span>
              <input type="number" min="1" max="60" value={split} onChange={(e) => setSplit(+e.target.value || 1)} style={{ width: 64 }} className="mini-select" />
              <span>monthly instalments</span>
              <button className="btn sm" type="button" onClick={doSplit}>Split</button>
            </div>
            {rows.map((r, k) => (
              <div className="inst-row" key={k}>
                <input type="date" value={r.due_date} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === k ? { ...x, due_date: e.target.value } : x)))} aria-label={`Instalment ${k + 1} date`} />
                <input type="number" min="0" value={r.amount || ''} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === k ? { ...x, amount: +e.target.value } : x)))} aria-label={`Instalment ${k + 1} amount`} />
                <button className="linkbtn" type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== k))}>Remove</button>
              </div>
            ))}
            <button className="linkbtn" type="button" onClick={() => setRows((rs) => [...rs, { due_date: dayOff(30 * (rs.length + 1)), amount: 0 }])}>+ Add instalment</button>
            <p className={`hint ${Math.abs(planTotal - value) > 1 ? 'neg' : ''}`} style={{ margin: 0 }}>
              Plan total {inr(planTotal)} of plot price {inr(value)}{Math.abs(planTotal - value) > 1 ? ` (${planTotal < value ? 'short by' : 'over by'} ${inr(Math.abs(value - planTotal))})` : ''}
            </p>
            <div className="btns"><button className="btn pri" type="button" onClick={save}>Save plan</button><button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        )}
      </section>
    </>
  );
}

const KINDS = ['Sale agreement', 'ID proof (Aadhaar / PAN)', 'Payment receipt', 'Registration deed', 'Other'];

/** Agreements, ID copies and other files kept against a plot. */
export function PlotDocs({ p }: { p: Plot }) {
  const { org, profile, isOwner, toast } = useData();
  const [docs, setDocs] = useState<PlotDocument[]>([]);
  const [kind, setKind] = useState(KINDS[0]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('plot_documents').select('*').eq('plot_id', p.id).order('created_at', { ascending: false });
    setDocs((data ?? []) as PlotDocument[]);
  }, [p.id]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !org || !profile) return;
    if (f.size > 15 * 1024 * 1024) return toast('Files up to 15 MB only.');
    setBusy(true);
    const path = `${org.id}/${p.id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, '_')}`;
    const up = await supabase.storage.from('documents').upload(path, f, { contentType: f.type || undefined });
    if (up.error) { setBusy(false); return toast(up.error.message); }
    const { error } = await supabase.from('plot_documents').insert({ plot_id: p.id, org_id: org.id, name: f.name, kind, path, size_bytes: f.size, uploaded_by: profile.id });
    setBusy(false);
    if (error) return toast(error.message);
    toast(`${f.name} saved to plot ${p.label}`);
    load();
  };

  const open = async (d: PlotDocument) => {
    // browsers: open the tab inside the click so it isn't blocked; phone apps open an in-app browser sheet
    const w = isNative ? null : window.open('', '_blank');
    const { data } = await supabase.storage.from('documents').createSignedUrl(d.path, 600);
    if (data?.signedUrl) { if (isNative) openExternal(data.signedUrl); else if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl; }
    else { w?.close(); toast('Could not open this file.'); }
  };

  const remove = async (d: PlotDocument) => {
    await supabase.storage.from('documents').remove([d.path]);
    const { error } = await supabase.from('plot_documents').delete().eq('id', d.id);
    if (error) return toast(error.message);
    load();
  };

  return (
    <section className="sec">
      <div className="card-h" style={{ margin: 0 }}><h3>Documents</h3><span className="muted">{docs.length}</span></div>
      {docs.map((d) => (
        <div className="doc-row" key={d.id}>
          <span className="ic k-rate" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: '.62rem', fontFamily: 'var(--f-mono)' }}>{(d.name.split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase()}</span>
          <div className="body"><p>{d.name}</p><span className="meta">{d.kind} · {fmtD(d.created_at)}</span></div>
          <button className="btn sm ghost" onClick={() => open(d)}>Open</button>
          {isOwner && <button className="linkbtn" onClick={() => remove(d)}>Delete</button>}
        </div>
      ))}
      <div className="btns" style={{ alignItems: 'center' }}>
        <select className="mini-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <button className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Add document'}</button>
        <input ref={input} type="file" hidden accept="image/*,application/pdf,.pdf,.doc,.docx" onChange={upload} />
      </div>
      {!docs.length && <p className="hint" style={{ margin: 0 }}>Keep the sale agreement, ID copies and receipts here. Only the owner, sales team and accountant can see them.</p>}
    </section>
  );
}
