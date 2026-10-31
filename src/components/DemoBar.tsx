import { useState } from 'react';
import { useData } from '../data/DataProvider';
import { demoTokenFor, exitDemo, restartDemo, switchDemoPerson } from '../lib/demo';

const roleName = (r: string) => ({ owner: 'Owner', sales: 'Sales', broker: 'Broker', accountant: 'Accountant' } as Record<string, string>)[r] ?? r;

/** Strip above the app in demo mode: who you are, switch person, open another person in a new tab. */
export function DemoBar() {
  const { members, profile, toast } = useData();
  const [busy, setBusy] = useState(false);
  const people = members.filter((m) => m.active).sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.full_name.localeCompare(b.full_name)));
  const others = people.filter((m) => m.id !== profile?.id);

  const switchTo = async (id: string) => {
    setBusy(true);
    try { await switchDemoPerson(id); location.hash = '/'; } catch (e) { toast(e instanceof Error ? e.message : 'Could not switch.'); }
    setBusy(false);
  };

  const openTab = async (id: string) => {
    // open the tab inside the click so it isn't blocked, then point it at the sign-in link
    const w = window.open('', '_blank');
    try {
      const th = await demoTokenFor(id);
      const url = `${location.origin}${location.pathname}?demo&th=${encodeURIComponent(th)}#/`;
      if (w) w.location.href = url; else location.href = url;
    } catch (e) {
      w?.close();
      toast(e instanceof Error ? e.message : 'Could not open a new tab.');
    }
  };

  return (
    <div className="demobar" role="region" aria-label="Demo controls">
      <span className="tag soon">Demo</span>
      <span className="demobar-text">Sample company. Nothing here is real and no messages are sent.</span>
      <label className="demobar-who">Viewing as
        <select value={profile?.id ?? ''} disabled={busy} onChange={(e) => switchTo(e.target.value)}>
          {people.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {roleName(m.role)}</option>)}
        </select>
      </label>
      <details className="demobar-more">
        <summary>Open another person in a new tab</summary>
        <div className="demobar-menu">
          <p className="hint" style={{ margin: 0 }}>Book a plot in one tab and watch it change in the other.</p>
          {others.map((m) => <button key={m.id} className="btn sm" onClick={() => openTab(m.id)}>{m.full_name} · {roleName(m.role)}</button>)}
        </div>
      </details>
      <button className="linkbtn" onClick={restartDemo}>Restart demo</button>
      <button className="linkbtn" onClick={exitDemo}>Exit</button>
    </div>
  );
}
