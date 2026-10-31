import { useEffect, useState } from 'react';
import { isNative } from '../lib/native';
import { enablePush, pushPermission } from '../lib/push';

const LATER = 'plotskart-alerts-later';

/** Phone apps, Home: offers booking and payment alerts once, instead of asking the moment someone signs in. */
export function AlertsCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isNative) return;
    let later = false;
    try { later = localStorage.getItem(LATER) === '1'; } catch { /* storage blocked */ }
    if (!later) pushPermission().then((p) => setShow(p === 'prompt'));
  }, []);
  if (!show) return null;
  const hide = () => { try { localStorage.setItem(LATER, '1'); } catch { /* storage blocked */ } setShow(false); };
  return (
    <section className="card alerts-card">
      <div>
        <h2>Get alerts on this phone</h2>
        <p className="muted">When a plot is booked or sold, a price changes, or a payment or registration is due.</p>
      </div>
      <div className="btns">
        <button className="btn pri" disabled={busy} onClick={async () => { setBusy(true); await enablePush(); setBusy(false); setShow(false); }}>Turn on alerts</button>
        <button className="btn ghost" onClick={hide}>Not now</button>
      </div>
    </section>
  );
}
