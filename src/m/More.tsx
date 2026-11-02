import { useEffect, useState } from 'react';
import { ROLE_NAMES } from '../components/Shell';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { Avatar, I, tap, type IconKey } from './kit';

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'plotskart-theme';
export const readTheme = (): Theme => { try { return (localStorage.getItem(THEME_KEY) as Theme) || 'system'; } catch { return 'system'; } };
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
}

export function MMore() {
  const { profile, org, isOwner, isFinance, canSell, signOut } = useData();
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  if (!profile) return null;

  const rows: [IconKey, string, string, string, string][] = [
    ...(isFinance ? [['chart', 'Finance', 'Costs, cash, bank and reports', '/finance', 'violet'] as [IconKey, string, string, string, string]] : []),
    ...(isOwner ? [['users', 'Team & commission', 'Invite people, set commission, pay out', '/team', 'rose'] as [IconKey, string, string, string, string]] : [['users', 'My commission', 'Earned, paid and pending', '/team', 'rose'] as [IconKey, string, string, string, string]]),
    ...(canSell ? [['chat', 'Customers & broadcasts', isOwner ? 'Who agreed to offers; announce projects on WhatsApp' : 'Add customers and record their consent', '/contacts', 'mint'] as [IconKey, string, string, string, string]] : []),
    ['clock', 'Reminders & WhatsApp', 'Due dates, buyer messages, your alerts', '/reminders', 'sky'],
    ['bell', 'Activity log', 'Every change, by everyone', '/activity', 'amber'],
  ];

  return (
    <div className="m-page">
      <header className="m-head"><div className="t"><small>{org?.name}</small><h1>More</h1></div></header>
      <div className="m-stack">
        <section className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar id={profile.id} name={profile.full_name || profile.email || '?'} size={56} />
          <div style={{ minWidth: 0 }}>
            <b style={{ display: 'block', fontSize: '1.1rem', fontWeight: 800 }}>{profile.full_name || profile.email}</b>
            <span className="m-sub m-small">{ROLE_NAMES[profile.role]} · {profile.email}</span>
          </div>
        </section>

        <section className="m-card" style={{ paddingBlock: 4 }}>
          <div className="m-list">
            {rows.map(([icon, title, sub, to, tone]) => (
              <button key={to} className="m-row wrap" onClick={() => { tap(); go(to); }}>
                <span className={`m-badge t-${tone}`}><I n={icon} /></span>
                <div className="body"><b>{title}</b><span>{sub}</span></div>
                <span className="chev"><I n="chev" /></span>
              </button>
            ))}
          </div>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Appearance</h3></div>
          <div className="m-seg">
            <span className="knob" style={{ width: 'calc((100% - 8px) / 3)', transform: `translateX(${['system', 'light', 'dark'].indexOf(theme) * 100}%)` }} />
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => { tap(); setTheme(t); }}>{t === 'system' ? 'Automatic' : t === 'light' ? 'Light' : 'Dark'}</button>
            ))}
          </div>
        </section>

        <button className="m-btn ghost" onClick={() => { tap(); signOut(); }}><span style={{ width: 18, height: 18, display: 'inline-grid' }}><I n="out" /></span>Sign out</button>
      </div>
    </div>
  );
}
