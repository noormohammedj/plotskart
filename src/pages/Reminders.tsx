import { useEffect, useState } from 'react';
import { LatestDeals, MoneyDues } from '../components/TeamDues';
import { useData } from '../data/DataProvider';
import { dayOff, fmtD, fmtT, inr } from '../lib/format';
import { plotBalance } from '../lib/plots';
import { customerText, isDue, upcomingReminders, type Reminder } from '../lib/reminders';
import { supabase } from '../lib/supabase';
import type { CustomerMessage } from '../lib/types';

export function Reminders() {
  const { projects, plots, profile, org, canSell, isOwner, isFinance, rpc, openPlot, memberName, toast } = useData();
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [sending, setSending] = useState<string | null>(null);

  const loadMessages = () => {
    if (!canSell) return;
    supabase.from('customer_messages').select('*').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setMessages((data ?? []) as CustomerMessage[]));
  };
  useEffect(loadMessages, [canSell]);

  if (!profile || !org) return null;
  const list = upcomingReminders(projects, plots, profile);

  const setDays = async (field: 'reg_days' | 'pay_days', v: number) => {
    const { error } = await supabase.from('orgs').update({ [field]: v }).eq('id', org.id);
    toast(error ? error.message : 'Reminder timing saved');
  };

  const send = async (r: Reminder) => {
    setSending(r.type + r.p.id);
    await rpc('send_reminder', { p_plot: r.p.id, p_kind: r.type }, 'Reminder sent to team and customer');
    setSending(null);
    loadMessages();
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast('Message copied'), () => toast('Copy failed. Select the text instead.'));
  };

  const card = (r: Reminder) => {
    const b = plotBalance(r.pr, r.p);
    const text = customerText(r, org.name);
    const lead = r.type === 'reg' ? org.reg_days : org.pay_days;
    const cls = r.d <= 1 ? 'urgent' : r.d <= 3 ? 'soon' : '';
    return (
      <article className="rem" key={r.type + r.p.id}>
        <div className={`when ${cls}`}><b>{Math.abs(r.d)}</b><small>{r.d < 0 ? 'days late' : r.d === 1 ? 'day' : 'days'}</small></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`tag ${r.type === 'reg' ? 'ok' : 'soon'}`}>{r.type === 'reg' ? 'Registration' : 'Balance payment'}</span>
            <b>{r.p.label} · {r.pr.name}</b>
          </div>
          <p style={{ marginTop: 4 }}>{r.p.buyer_name} <span className="mono muted">{r.p.buyer_phone}</span></p>
          <p className="muted">
            {r.type === 'reg'
              ? `Registration on ${fmtD(r.p.reg_date)}${b > 0 ? ` · balance ${inr(b)}` : ''}`
              : `${inr(b)} due ${fmtD(r.p.due_date)} · paid so far ${inr(r.p.paid)}`} · handled by {memberName(r.p.sold_by)}
          </p>
          <p className="hint">{isDue(r, org) ? 'Sent automatically at 8 am on each due day' : `Goes out automatically on ${fmtD(dayOff(r.d - lead))}`}</p>
          {canSell && <>
            <div className="msg"><span className="lbl">Message to customer</span><br />{text}</div>
            <div className="btns" style={{ marginTop: 10 }}>
              <button className="btn sm pri" disabled={sending === r.type + r.p.id} onClick={() => send(r)}>Send now</button>
              <a className="btn sm" href={`https://wa.me/${(r.p.buyer_phone ?? '').replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener">Open in WhatsApp</a>
              <button className="btn sm ghost" onClick={() => copy(text)}>Copy message</button>
              <button className="btn sm ghost" onClick={() => openPlot(r.p.id)}>Open plot</button>
            </div>
          </>}
          {!canSell && <div className="btns" style={{ marginTop: 10 }}><button className="btn sm ghost" onClick={() => openPlot(r.p.id)}>Open plot</button></div>}
        </div>
      </article>
    );
  };

  const opts = [0, 1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>);
  const reg = list.filter((r) => r.type === 'reg');
  const pay = list.filter((r) => r.type === 'pay');

  const saveWhatsApp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    await rpc('set_my_whatsapp', { p_phone: String(d.get('phone') ?? ''), p_alerts: d.get('alerts') === 'on', p_summary: d.get('summary') === 'on' },
      'WhatsApp alert settings saved');
  };
  const tick = { flexDirection: 'row', alignItems: 'center', gap: 8 } as const;

  return (
    <div className="stack-v">
      <section className="sec"><h2>Registrations</h2><div className="rem-list">{reg.length ? reg.map(card) : <p className="empty">No registrations in the next two weeks.</p>}</div></section>
      <section className="sec"><h2>Pending payments from customers</h2><div className="rem-list">{pay.length ? pay.map(card) : <p className="empty">No balances due in the next two weeks.</p>}</div></section>
      {isFinance && <MoneyDues />}
      <LatestDeals />
      {canSell && (
        <section className="card">
          <div className="card-h"><h2>Messages sent to customers</h2><button className="linkbtn" onClick={loadMessages}>Refresh</button></div>
          <div className="list">
            {messages.length ? messages.map((m) => (
              <div className="li" key={m.id}>
                <span className={`ic k-${m.kind === 'reg' ? 'reg' : m.kind === 'pay' ? 'pay' : 'booked'}`}>{m.kind === 'reg' ? 'REG' : m.kind === 'pay' ? '₹' : 'BKD'}</span>
                <div className="body">
                  <p>{m.body}</p>
                  <span className="meta">To {m.to_name} · {m.to_phone} · WhatsApp {m.whatsapp_status} · SMS {m.sms_status} · {fmtT(m.created_at)}</span>
                </div>
              </div>
            )) : <p className="empty">No messages yet.</p>}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-h"><h2>My WhatsApp alerts</h2></div>
        <form className="f" onSubmit={saveWhatsApp}>
          <label>My WhatsApp number<input name="phone" type="tel" placeholder="+91" defaultValue={profile.phone ?? ''} /></label>
          <label className="wide" style={tick}>
            <input name="alerts" type="checkbox" defaultChecked={profile.whatsapp_alerts} style={{ width: 'auto' }} />
            Send me new bookings, sales, payments and overdue buyers on WhatsApp{profile.role === 'broker' ? ' (for plots I handle)' : ''}
          </label>
          {isOwner && (
            <label className="wide" style={tick}>
              <input name="summary" type="checkbox" defaultChecked={profile.whatsapp_summary} style={{ width: 'auto' }} />
              Send me a summary every morning: today's dues, registrations and overdue total
            </label>
          )}
          <div className="wide btns"><button className="btn pri">Save</button></div>
        </form>
        <p className="hint">Alerts come from the Plotskart WhatsApp number. Reply STOP to it at any time to turn them off.</p>
      </section>
      {isOwner && (
        <section className="card">
          <div className="card-h"><h2>When reminders go out</h2></div>
          <div className="setrow">
            <label>Registration alert <select value={org.reg_days} onChange={(e) => setDays('reg_days', +e.target.value)}>{opts}</select> before</label>
            <label>Payment reminder from <select value={org.pay_days} onChange={(e) => setDays('pay_days', +e.target.value)}>{opts}</select> before due date, then daily while overdue</label>
          </div>
          <p className="hint">Every morning at 8 am the owner and sales team get an app notification, and the customer gets WhatsApp and SMS.</p>
        </section>
      )}
    </div>
  );
}
