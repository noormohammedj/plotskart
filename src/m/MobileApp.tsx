import { useEffect, type ReactNode } from 'react';
import { PlotSheet } from '../components/PlotSheet';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { isNative } from '../lib/native';
import { Activity } from '../pages/Activity';
import { EditLayout } from '../pages/EditLayout';
import { Finance } from '../pages/Finance';
import { MyTeam } from '../pages/MyTeam';
import { NewApartmentProject } from '../pages/NewApartmentProject';
import { NewProject } from '../pages/NewProject';
import { Receipt } from '../pages/Receipt';
import { Reminders } from '../pages/Reminders';
import { Team } from '../pages/Team';
import { MAlerts } from './Alerts';
import { MHome } from './Home';
import { I, tap, type IconKey } from './kit';
import { applyTheme, MMore, readTheme } from './More';
import { MProjects } from './Projects';
import { MProjectView } from './ProjectView';
import { MBroadcast } from './Broadcast';
import { MContacts } from './Contacts';
import { MRace } from './Race';
import { MShowcase } from './Showcase';
import { MShowcaseEdit } from './ShowcaseEdit';
import './m.css';
import './legacy.css';

const UI_KEY = 'plotskart-ui';
/** The phone design runs in the iPhone and Android apps. In a browser, open the app with ?ui=phone to try it
    (and ?ui=web to go back); the choice is remembered on that browser only. */
export function phoneUi() {
  if (isNative) return true;
  try {
    const q = new URLSearchParams(location.search).get('ui');
    if (q === 'phone') localStorage.setItem(UI_KEY, 'phone');
    if (q === 'web') localStorage.removeItem(UI_KEY);
    return localStorage.getItem(UI_KEY) === 'phone';
  } catch { return false; }
}

const TABS: [string, string, IconKey][] = [['/', 'Home', 'home'], ['/projects', 'Projects', 'grid'], ['/race', 'Race', 'flag'], ['/alerts', 'Alerts', 'bell'], ['/more', 'More', 'more']];

function TabBar({ route }: { route: string }) {
  const { unread } = useData();
  const section = '/' + (route.split('/')[1] ?? '');
  // screens reached from More (customers, broadcasts, finance, team...) keep More lit
  const more = ['/contacts', '/broadcast', '/finance', '/team', '/reminders', '/activity', '/receipt'].includes(section);
  const i = more ? TABS.length - 1 : Math.max(0, TABS.findIndex(([to]) => to === section || (to === '/projects' && section === '/p')));
  return (
    <nav className="m-tabbar" aria-label="Main">
      <span className="knob" style={{ width: `calc((100% - 12px) / ${TABS.length})`, transform: `translateX(${i * 100}%)` }} />
      {TABS.map(([to, label, icon], k) => (
        <button key={to} className={k === i ? 'on' : ''} aria-current={k === i ? 'page' : undefined}
          onClick={() => { tap(); if (to === route) window.scrollTo({ top: 0, behavior: 'smooth' }); else go(to); }}>
          <I n={icon} sw={k === i ? 2.3 : 1.9} />{label}
          {to === '/alerts' && unread > 0 && k !== i && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      ))}
    </nav>
  );
}

/** Screens not redesigned yet keep their current look, under a phone-style top bar. */
function Legacy({ title, back, children }: { title: string; back: string; children: ReactNode }) {
  return (
    <>
      <header className="m-legacy-top">
        <button className="m-iconbtn" aria-label="Back" onClick={() => { tap(); go(back); }}><I n="back" sw={2.4} /></button>
        <h2>{title}</h2>
      </header>
      <div className="m-legacy">{children}</div>
    </>
  );
}

export function MobileApp({ route }: { route: string }) {
  const { isFinance, toastMsg, openPlot } = useData();
  // a plot left open must not follow you to another screen
  useEffect(() => { openPlot(null); }, [route, openPlot]);
  useEffect(() => {
    applyTheme(readTheme());
    document.documentElement.classList.add('m-on');
    return () => document.documentElement.classList.remove('m-on');
  }, []);

  const parts = route.split('/').filter(Boolean);
  let page: ReactNode;
  if (parts[0] === 'p' && parts[1] && parts[2] === 'edit') page = <Legacy title="Edit layout" back={`/p/${parts[1]}`}><EditLayout id={parts[1]} key={parts[1]} /></Legacy>;
  else if (parts[0] === 'p' && parts[1]) {
    const tab = parts[2] === 'list' ? 'list' : parts[2] === 'info' ? 'info' : parts[2] === 'blocks' ? 'blocks' : 'layout';
    page = <MProjectView id={parts[1]} tab={tab} key={parts[1]} />;
  } else if (parts[0] === 'projects' && parts[1] === 'new') {
    page = <Legacy title="New project" back="/projects">{parts[2] === 'apartments' ? <NewApartmentProject /> : <NewProject />}</Legacy>;
  } else if (parts[0] === 'projects') page = <MProjects />;
  else if (parts[0] === 'show' && parts[1]) page = parts[2] === 'edit' ? <MShowcaseEdit id={parts[1]} key={parts[1]} /> : <MShowcase id={parts[1]} key={parts[1]} />;
  else if (parts[0] === 'contacts') page = <MContacts />;
  else if (parts[0] === 'broadcast') page = <MBroadcast projectId={parts[1]} key={parts[1] ?? 'all'} />;
  else if (parts[0] === 'race') page = <MRace />;
  else if (parts[0] === 'alerts') page = <MAlerts />;
  else if (parts[0] === 'more') page = <MMore />;
  else if (parts[0] === 'finance') {
    const tab = (['bank', 'reports', 'assets'] as const).find((t) => t === parts[1]) ?? 'projects';
    page = <Legacy title="Finance" back="/more"><Finance tab={tab} /></Legacy>;
  } else if (parts[0] === 'team') page = <Legacy title={isFinance ? 'Team & commission' : 'My commission'} back="/more">{isFinance ? <Team /> : <MyTeam />}</Legacy>;
  else if (parts[0] === 'reminders') page = <Legacy title="Reminders & WhatsApp" back="/more"><Reminders /></Legacy>;
  else if (parts[0] === 'activity') page = <Legacy title="Activity log" back="/more"><Activity /></Legacy>;
  else if (parts[0] === 'receipt' && parts[1]) page = <Legacy title="Payment receipt" back="/finance"><Receipt id={parts[1]} /></Legacy>;
  else page = <MHome />;

  return (
    <div className="m-app">
      <div key={parts[0] ?? 'home'}>{page}</div>
      {parts[0] !== 'show' && <TabBar route={route} />}
      <PlotSheet />
      {toastMsg && <div className="m-toast" role="status">{toastMsg}</div>}
    </div>
  );
}
