import { Capacitor } from '@capacitor/core';
import { useEffect, useState, type FormEvent } from 'react';
import { Mark } from '../components/ui';
import { useData } from '../data/DataProvider';
import { supabase } from '../lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  const verify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\D/g, '');
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    setBusy(false);
    if (error) setErr('That code did not work. Check the latest email, or send a new code.');
  };

  return (
    <div className="auth">
      <div className="card">
        <div className="brand"><Mark /><div><b>Plotskart</b><small>Plots, sales and payments in your pocket</small></div></div>
        {!sent ? (
          <form className="f" onSubmit={send}>
            <h3>Sign in</h3>
            <label>Email address<input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <button className="btn pri" disabled={busy}>Send me a code</button>
            <p className="hint">Team members: use the email address your owner invited.</p>
            {!Capacitor.isNativePlatform() && <p className="hint" style={{ marginTop: 0 }}>Just looking? <a href="?demo" className="linkbtn">Try the live demo</a> with sample data.</p>}
          </form>
        ) : (
          <form className="f" onSubmit={verify}>
            <h3>Enter the code</h3>
            <p className="muted">We sent a sign-in code to {email}.</p>
            {/* code length is set per project in Supabase Auth (6 to 10 digits) */}
            <label>Code<input className="otp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required autoFocus /></label>
            <button className="btn pri" disabled={busy}>Sign in</button>
            <button type="button" className="linkbtn" onClick={() => setSent(false)}>Use a different email</button>
          </form>
        )}
        {err && <p className="neg">{err}</p>}
      </div>
    </div>
  );
}

export function Onboarding() {
  const { reload, signOut, session } = useData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    const { error } = await supabase.rpc('create_org', { p_company: d.company, p_full_name: d.name });
    setBusy(false);
    if (error) setErr(error.message);
    else reload();
  };

  return (
    <div className="auth">
      <div className="card">
        <div className="brand"><Mark /><div><b>Set up your company</b><small>{session?.user.email}</small></div></div>
        <form className="f" onSubmit={create}>
          <label>Company name<input name="company" required autoFocus placeholder="e.g. Sai Developers" /></label>
          <label>Your name<input name="name" required /></label>
          <button className="btn pri" disabled={busy}>Create company</button>
        </form>
        <p className="hint">You become the owner. Joining someone else's company? Ask the owner to invite this email, then sign in again.</p>
        {err && <p className="neg">{err}</p>}
        <button className="linkbtn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="auth">
      <div className="card">
        <div className="brand"><Mark /><div><b>Plotskart</b><small>Setup needed</small></div></div>
        <p>Supabase keys are missing. Copy <span className="mono">.env.example</span> to <span className="mono">.env</span>, fill in your project URL and anon key, then restart <span className="mono">npm run dev</span>.</p>
      </div>
    </div>
  );
}

export type DemoRole = 'owner' | 'sales' | 'broker' | 'accountant';
const DEMO_ROLES: { role: DemoRole; title: string; who: string; sees: string }[] = [
  { role: 'owner', title: 'Owner', who: 'owner@demo.plotskart.in', sees: 'Everything: all projects, profit and loss, bank accounts, team and commissions.' },
  { role: 'sales', title: 'Sales team', who: 'ravi@demo.plotskart.in', sees: 'Live layouts, booking and selling, payments, reminders and the team leaderboard.' },
  { role: 'broker', title: 'Broker', who: 'suresh@demo.plotskart.in', sees: 'Live availability and booking. No accounts, no other people\'s commissions.' },
  { role: 'accountant', title: 'Accountant', who: 'anita@demo.plotskart.in', sees: 'Payments, receipts, bank and cash accounts, expenses, salaries and reports.' },
];

/** Demo sign-in: the same screen shape as the real one, with the demo account filled in automatically. */
export function DemoLogin({ onSignIn }: { onSignIn: (role: DemoRole) => void }) {
  const params = new URLSearchParams(location.search);
  const [role, setRole] = useState<DemoRole>((DEMO_ROLES.find((r) => r.role === params.get('as'))?.role) ?? 'owner');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const pick = DEMO_ROLES.find((r) => r.role === role)!;
  const ready = email === pick.who && code.length === 8;

  // type the demo email and code in, the way a person would
  useEffect(() => {
    setEmail(''); setCode('');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setEmail(pick.who); setCode('20261024'); return; }
    let i = 0, j = 0;
    const digits = '20261024';
    const t1 = setInterval(() => {
      i++;
      setEmail(pick.who.slice(0, i));
      if (i >= pick.who.length) {
        clearInterval(t1);
        const t2 = setInterval(() => { j++; setCode(digits.slice(0, j)); if (j >= digits.length) clearInterval(t2); }, 70);
      }
    }, 22);
    return () => clearInterval(t1);
  }, [pick.who]);

  useEffect(() => { if (params.get('go') === '1' && ready) onSignIn(role); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="auth">
      <div className="card demo-login">
        <div className="brand"><Mark /><div><b>Plotskart</b><small>Live demo · sample company</small></div></div>
        <div className="seg demo-roles" role="tablist">
          {DEMO_ROLES.map((r) => <button key={r.role} role="tab" aria-selected={role === r.role} className={role === r.role ? 'on' : ''} onClick={() => setRole(r.role)}>{r.title}</button>)}
        </div>
        <p className="muted" style={{ minHeight: '3em' }}>{pick.sees}</p>
        <form className="f" onSubmit={(e) => { e.preventDefault(); if (ready) onSignIn(role); }}>
          <label>Email address<input value={email} readOnly className="mono" /></label>
          <label>Sign-in code
            <div className="otp-boxes" aria-label={`Code ${code}`}>
              {Array.from({ length: 8 }, (_, k) => <span key={k} className={code[k] ? 'on' : ''}>{code[k] ?? ''}</span>)}
            </div>
          </label>
          <button className="btn pri" disabled={!ready}>{ready ? `Sign in as ${pick.title}` : 'Filling in the demo account…'}</button>
        </form>
        <p className="hint">The real app works the same way: each person signs in with their own email and a one-time code. No passwords to remember or share. In this demo the account is filled in for you.</p>
      </div>
    </div>
  );
}
