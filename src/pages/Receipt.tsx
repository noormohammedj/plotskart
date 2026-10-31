import { useEffect, useState } from 'react';
import { Mark } from '../components/ui';
import { useData } from '../data/DataProvider';
import { fmtD, inr } from '../lib/format';
import { MODES, rupeesInWords } from '../lib/money';
import { plotBalance, plotValue, unitWord } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { CustomerPayment } from '../lib/types';
import { isNative } from '../lib/native';

/** Printable payment receipt, numbered automatically, ready to share on WhatsApp. */
export function Receipt({ id }: { id: string }) {
  const { plots, projects, org, memberName, toast } = useData();
  const [pay, setPay] = useState<CustomerPayment | null>(null);
  const [missing, setMissing] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    supabase.from('customer_payments').select('*').eq('id', id).single().then(({ data }) => {
      if (data) setPay(data as CustomerPayment); else setMissing(true);
    });
  }, [id]);

  if (missing) return <p className="empty">Receipt not found.</p>;
  const p = pay && plots.find((x) => x.id === pay.plot_id);
  const pr = p && projects.find((x) => x.id === p.project_id);
  if (!pay || !p || !pr || !org) return <p className="empty">Loading receipt…</p>;

  const buyer = pay.buyer_name ?? p.buyer_name ?? '';
  // flats in apartment projects, plots everywhere else
  const unit = unitWord(pr, 1), Unit = unit[0].toUpperCase() + unit.slice(1);
  const no = `${org.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PP'}-${String(pay.receipt_no).padStart(5, '0')}`;
  const text = `Payment receipt ${no}\n${org.name}\nReceived from ${buyer} ${inr(pay.amount)} (${rupeesInWords(pay.amount)}) on ${fmtD(pay.received_on)} for ${unit} ${p.label}, ${pr.name}${pay.mode ? ` by ${MODES[pay.mode]}` : ''}${pay.reference ? ` (ref ${pay.reference})` : ''}.\nTotal paid so far ${inr(p.paid)}, balance ${inr(plotBalance(pr, p))}.`;
  const digits = (p.buyer_phone ?? '').replace(/\D/g, '');
  const wa = `https://wa.me/${digits.length === 10 ? '91' + digits : digits}?text=${encodeURIComponent(text)}`;
  const sharePdf = async () => {
    setSharing(true);
    try {
      const { shareReceiptPdf } = await import('../lib/receiptPdf');
      const bal = plotBalance(pr, p);
      await shareReceiptPdf({
        no, date: fmtD(pay.received_on), org: org.name, project: `${pr.name} · ${pr.location}`, buyer,
        amount: inr(pay.amount), words: rupeesInWords(pay.amount), recordedBy: memberName(pay.recorded_by),
        rows: [
          ['Towards', `${Unit} ${p.label}, ${pr.name}`], ['Area', `${Number(p.sqft).toLocaleString('en-IN')} sq ft`],
          ['Paid by', pay.mode ? MODES[pay.mode] : '—'], ['Reference', pay.reference ?? '—'],
          [`${Unit} price`, inr(plotValue(pr, p))], ['Paid so far', inr(p.paid)],
          ['Balance due', `${inr(bal)}${p.due_date && bal > 0 ? ` · next due ${fmtD(p.due_date)}` : ''}`],
        ],
      });
    } catch {
      toast('Could not make the PDF. Try "Copy text" instead.');
    } finally { setSharing(false); }
  };

  return (
    <div className="stack-v">
      <div className="btns no-print">
        <button className="back" onClick={() => history.back()}>← Back</button>
        <span style={{ flex: 1 }} />
        {/* phone apps can't print from the WebView: they share the receipt as a PDF instead */}
        {isNative
          ? <button className="btn" disabled={sharing} onClick={sharePdf}>Share as PDF</button>
          : <button className="btn" onClick={() => window.print()}>Print or save as PDF</button>}
        <a className="btn pri" href={wa} target="_blank" rel="noopener">Send on WhatsApp</a>
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Receipt text copied'))}>Copy text</button>
      </div>
      <article className="receipt">
        <header>
          <div className="brand"><Mark /><div><b>{org.name}</b><small>{pr.name} · {pr.location}</small></div></div>
          <div className="r-no"><span className="lbl">Receipt</span><b className="mono">{no}</b><span className="mono">{fmtD(pay.received_on)}</span></div>
        </header>
        <p className="r-line">Received with thanks from <b>{buyer}</b> the sum of</p>
        <p className="r-amount">{inr(pay.amount)}</p>
        <p className="r-words">{rupeesInWords(pay.amount)}</p>
        <div className="dl">
          <div><span className="lbl">Towards</span><b>{Unit} {p.label}, {pr.name}</b></div>
          <div><span className="lbl">Area</span><b>{Number(p.sqft).toLocaleString('en-IN')} sq ft</b></div>
          <div><span className="lbl">Paid by</span><b>{pay.mode ? MODES[pay.mode] : '—'}</b></div>
          <div><span className="lbl">Reference</span><b>{pay.reference ?? '—'}</b></div>
          <div><span className="lbl">{Unit} price</span><b>{inr(plotValue(pr, p))}</b></div>
          <div><span className="lbl">Paid so far</span><b>{inr(p.paid)}</b></div>
          <div className="wide"><span className="lbl">Balance due</span><b>{inr(plotBalance(pr, p))}{p.due_date && plotBalance(pr, p) > 0 ? ` · next due ${fmtD(p.due_date)}` : ''}</b></div>
        </div>
        <footer>
          <span className="muted">Recorded by {memberName(pay.recorded_by)} in Plotskart</span>
          <span className="sign">Authorised signatory</span>
        </footer>
      </article>
    </div>
  );
}
