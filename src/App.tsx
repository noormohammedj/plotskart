import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlotSheet } from './components/PlotSheet';
import { Shell } from './components/Shell';
import { useData } from './data/DataProvider';
import { useRoute } from './data/route';
import { restartDemo, seedDemo, startDemo, switchDemoPerson } from './lib/demo';
import { configured, isDemo } from './lib/supabase';
import { DemoLogin, Login, NotConfigured, Onboarding, type DemoRole } from './pages/Auth';
import { EditLayout } from './pages/EditLayout';
import { Finance } from './pages/Finance';
import { Home, Projects } from './pages/Home';
import { NewProject } from './pages/NewProject';
import { NewApartmentProject } from './pages/NewApartmentProject';
import { ProjectPage } from './pages/Project';
import { Receipt } from './pages/Receipt';
import { Reminders } from './pages/Reminders';
import { Activity } from './pages/Activity';
import { MyTeam } from './pages/MyTeam';
import { Team } from './pages/Team';
import { OfflineBanner } from './components/OfflineBanner';

function useAndroidBack(route: string) {
  const { sheetPlot, openPlot, toast } = useData();
  const state = useRef({ sheetPlot, route });
  state.current = { sheetPlot, route };
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let armed = 0; // on Home, the first back press only warns; a second within 2 seconds closes the app
    const h = CapApp.addListener('backButton', () => {
      if (state.current.sheetPlot) openPlot(null);
      else if (state.current.route !== '/') history.back();
      else if (Date.now() - armed < 2000) CapApp.exitApp();
      else { armed = Date.now(); toast('Press back again to close Plotskart'); }
    });
    return () => { h.then((x) => x.remove()); };
  }, [openPlot, toast]);
}

/** Demo mode: sign this tab in (new demo company, or a hand-over from another tab), then add sample projects. */
function useDemoBoot() {
  const { session, loading, profile, org, projects, isOwner, members, reload } = useData();
  const [state, setState] = useState<'idle' | 'login' | 'starting' | 'seeding' | 'switching' | 'error'>('idle');
  const [error, setError] = useState('');
  const started = useRef(false);
  const seeded = useRef(false);
  const wantRole = useRef<DemoRole>('owner');

  const begin = useCallback((role: DemoRole) => {
    wantRole.current = role;
    started.current = true;
    setState('starting');
    startDemo().then(() => setState('idle')).catch((e) => { setError(e.message); setState('error'); });
  }, []);

  // a hand-over link from another tab signs in straight away; otherwise show the demo sign-in screen
  useEffect(() => {
    if (!isDemo || started.current || loading) return;
    if (new URLSearchParams(location.search).has('th')) { begin('owner'); return; }
    if (!session) setState('login');
  }, [session, loading, begin]);

  useEffect(() => {
    if (!isDemo || seeded.current || loading || !org?.is_demo || !isOwner || projects.length) return;
    seeded.current = true;
    setState('seeding');
    seedDemo().then(reload).then(() => setState('idle')).catch((e) => { setError(e.message); setState('error'); });
  }, [loading, org, isOwner, projects.length, profile, reload]);

  // after the sample company is ready, become the role picked on the sign-in screen
  useEffect(() => {
    if (!isDemo || state !== 'idle' || wantRole.current === 'owner' || !projects.length || !members.length) return;
    const target = members.find((m) => m.role === wantRole.current);
    wantRole.current = 'owner';
    if (!target || target.id === profile?.id) return;
    setState('switching');
    switchDemoPerson(target.id).then(() => setState('idle')).catch((e) => { setError(e.message); setState('error'); });
  }, [state, projects.length, members, profile]);

  return { state, error, begin };
}

export function App() {
  const route = useRoute();
  const { session, loading, profile, projects, toastMsg, isFinance } = useData();
  const demo = useDemoBoot();
  useAndroidBack(route);

  if (!configured) return <NotConfigured />;
  if (isDemo && demo.state === 'error') {
    return <div className="spin"><div style={{ textAlign: 'center' }}><p>{demo.error}</p><button className="btn pri" style={{ marginTop: 12 }} onClick={restartDemo}>Start a new demo</button></div></div>;
  }
  if (isDemo && demo.state === 'login' && !session) return <DemoLogin onSignIn={demo.begin} />;
  if (isDemo && (demo.state === 'starting' || !session)) return <div className="spin">Signing in to your demo company…</div>;
  if (isDemo && demo.state === 'seeding') return <div className="spin">Adding sample projects, payments and sales history…</div>;
  if (isDemo && demo.state === 'switching') return <div className="spin">Opening your view…</div>;
  if (!session) return <Login />;
  if (loading && !profile) return <div className="spin">Loading your plots…</div>;
  if (!profile?.org_id) return <Onboarding />;

  const parts = route.split('/').filter(Boolean);
  let title = 'Portfolio';
  let page;
  if (parts[0] === 'p' && parts[1] && parts[2] === 'edit') {
    title = 'Edit layout';
    page = <EditLayout id={parts[1]} key={parts[1]} />;
  } else if (parts[0] === 'p' && parts[1]) {
    const tab = parts[2] === 'list' ? 'list' : parts[2] === 'info' ? 'info' : parts[2] === 'blocks' ? 'blocks' : 'layout';
    title = projects.find((p) => p.id === parts[1])?.name ?? 'Project';
    page = <ProjectPage id={parts[1]} tab={tab} key={parts[1]} />;
  } else if (parts[0] === 'projects' && parts[1] === 'new' && parts[2] === 'apartments') { title = 'New apartment project'; page = <NewApartmentProject />; }
  else if (parts[0] === 'projects' && parts[1] === 'new') { title = 'New project'; page = <NewProject />; }
  else if (parts[0] === 'projects') { title = 'Projects'; page = <Projects />; }
  else if (parts[0] === 'reminders') { title = 'Reminders'; page = <Reminders />; }
  else if (parts[0] === 'finance') {
    const tab = (['bank', 'reports', 'assets'] as const).find((t) => t === parts[1]) ?? 'projects';
    title = { projects: 'Finance', bank: 'Bank & cash', reports: 'Reports', assets: 'Assets' }[tab];
    page = <Finance tab={tab} />;
  }
  else if (parts[0] === 'receipt' && parts[1]) { title = 'Payment receipt'; page = <Receipt id={parts[1]} />; }
  else if (parts[0] === 'team') { title = isFinance ? 'Sales team & brokers' : 'Team'; page = isFinance ? <Team /> : <MyTeam />; }
  else if (parts[0] === 'activity') { title = 'Activity'; page = <Activity />; }
  else page = <Home />;

  return (
    <>
      <Shell route={route} title={title}>{page}</Shell>
      <PlotSheet />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      <OfflineBanner />
    </>
  );
}
