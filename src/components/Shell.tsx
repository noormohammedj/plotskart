import { useEffect, useState, type ReactNode } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { isNative } from '../lib/native';
import { isDemo } from '../lib/supabase';
import { DemoBar } from './DemoBar';
import { Icon, Mark, type IconName } from './ui';

export const ROLE_NAMES = { owner: 'Owner', sales: 'Sales team', broker: 'Broker', accountant: 'Accountant' } as const;

type Theme = 'system' | 'light' | 'dark';
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('plotskart-theme') as Theme) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('plotskart-theme', theme); } catch { /* private mode */ }
  }, [theme]);
  const next = () => setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system'));
  return { theme, next };
}

export function Shell({ route, title, children }: { route: string; title: string; children: ReactNode }) {
  const { org, profile, isFinance, unread, signOut } = useData();
  const { theme, next } = useTheme();
  const section = route.split('/')[1] || 'home';
  const active = (k: string) => section === k || (k === 'projects' && section === 'p') || (k === 'home' && section === '');
  // phone apps: everyone gets a Team tab (sales staff and brokers see their own commission and the team's race);
  // Finance stays with the owner and accountant. Activity is one tap away on the bell.
  const nav: [IconName, string, string][] = [
    ['home', 'Home', '/'], ['projects', 'Projects', '/projects'], ['reminders', 'Reminders', '/reminders'],
    ...(isFinance ? [['finance', 'Finance', '/finance']] as [IconName, string, string][] : []),
    ...(isFinance || isNative ? [['team', 'Team', '/team']] as [IconName, string, string][] : []),
    ['activity', 'Activity', '/activity'],
  ];
  const tabs = isFinance || isNative ? nav.filter(([k]) => k !== 'activity') : nav;
  const roleName = profile ? ROLE_NAMES[profile.role] : '';
  const themeLabel = theme === 'system' ? 'Theme: automatic' : theme === 'dark' ? 'Theme: dark' : 'Theme: light';

  return (
    <>
      <div className="shell">
        <aside className="rail">
          <div className="brand"><Mark /><div><b>Plotskart</b><small>{org?.name}</small></div></div>
          <nav className="nav">
            {nav.map(([k, l, to]) => (
              <button key={k} className={active(k) ? 'on' : ''} onClick={() => go(to)}>
                <Icon name={k} />{l}{k === 'activity' && unread > 0 && <span className="tag urgent">{unread}</span>}
              </button>
            ))}
          </nav>
          <div className="rail-foot">
            <span>{profile?.full_name || profile?.email} · {roleName}</span>
            <button className="linkbtn" onClick={next}>{themeLabel}</button>
            <button className="linkbtn" onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <div className="main">
          {isDemo && <DemoBar />}
          <header className="top">
            <span className="mbrand"><Mark /></span>
            <div className="ttl"><h2>{title}</h2></div>
            <div className="who"><b>{profile?.full_name}</b><span>{roleName}</span></div>
            <button className="bell theme-btn" onClick={next} aria-label={themeLabel} title={themeLabel}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {theme === 'dark' ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
              </svg>
            </button>
            <button className="bell" onClick={() => go('/activity')} aria-label={`Notifications, ${unread} unread`}>
              <Icon name="bell" />{unread > 0 && <span className="dot">{unread}</span>}
            </button>
          </header>
          <main>{children}</main>
        </div>
      </div>
      <nav className="tabbar">
        {tabs.map(([k, l, to]) => (
          <button key={k} className={active(k) ? 'on' : ''} onClick={() => go(to)}><Icon name={k} />{k === 'reminders' ? 'Alerts' : l}</button>
        ))}
      </nav>
    </>
  );
}
