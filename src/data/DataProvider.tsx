import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { registerPush, unregisterPush } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { AppNotification, Org, Plot, Profile, Project, Tower, UnitType } from '../lib/types';

type Ctx = {
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  org: Org | null;
  members: Profile[];
  projects: Project[];
  plots: Plot[];
  /** apartment projects: towers and unit types (with floor plans) */
  towers: Tower[];
  unitTypes: UnitType[];
  notes: AppNotification[];
  unread: number;
  isOwner: boolean;
  canSell: boolean;
  /** owner or accountant: finance, bank accounts, reports, payroll */
  isFinance: boolean;
  sheetPlot: string | null;
  openPlot: (id: string | null) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
  reload: () => Promise<void>;
  /** Calls a database function; shows its error as a toast. Returns null on failure. */
  rpc: <T = unknown>(fn: string, args: Record<string, unknown>, okMsg?: string) => Promise<T | null>;
  upsertPlot: (p: Plot) => void;
  memberName: (id: string | null) => string;
  signOut: () => Promise<void>;
  markAllRead: () => Promise<void>;
};

const DataCtx = createContext<Ctx | null>(null);

export const useData = () => {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
};

async function fetchAllPlots(orgId: string) {
  const out: Plot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('plots').select('*').eq('org_id', orgId).range(from, from + 999);
    if (error) throw error;
    out.push(...(data as Plot[]));
    if (!data || data.length < 1000) return out;
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [sheetPlot, openPlot] = useState<string | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;

  const reload = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      let { data: me } = await supabase.from('profiles').select('*').eq('id', uid).single();
      if (me && !me.org_id) {
        const { data: claimed } = await supabase.rpc('claim_invite');
        if (claimed) ({ data: me } = await supabase.from('profiles').select('*').eq('id', uid).single());
      }
      setProfile(me as Profile | null);
      if (!me?.org_id) return;
      const [o, m, pr, pl, n, tw, ut] = await Promise.all([
        supabase.from('orgs').select('*').eq('id', me.org_id).single(),
        supabase.from('profiles').select('*').eq('org_id', me.org_id).order('created_at'),
        supabase.from('projects').select('*').eq('org_id', me.org_id).order('created_at'),
        fetchAllPlots(me.org_id),
        supabase.from('notifications').select('*').eq('recipient', uid).order('created_at', { ascending: false }).limit(100),
        supabase.from('towers').select('*').eq('org_id', me.org_id).order('sort'),
        supabase.from('unit_types').select('*').eq('org_id', me.org_id).order('sort'),
      ]);
      setOrg(o.data as Org);
      setMembers((m.data ?? []) as Profile[]);
      setProjects((pr.data ?? []) as Project[]);
      setPlots(pl);
      setNotes((n.data ?? []) as AppNotification[]);
      setTowers((tw.data ?? []) as Tower[]);
      setUnitTypes((ut.data ?? []) as UnitType[]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load your data');
    } finally {
      setLoading(false);
    }
  }, [uid, toast]);

  useEffect(() => {
    if (uid) reload();
    else {
      setProfile(null); setOrg(null); setMembers([]); setProjects([]); setPlots([]); setTowers([]); setUnitTypes([]); setNotes([]);
    }
  }, [uid, reload]);

  const upsertPlot = useCallback((p: Plot) => {
    setPlots((all) => {
      const i = all.findIndex((x) => x.id === p.id);
      if (i < 0) return [...all, p];
      const next = all.slice();
      next[i] = p;
      return next;
    });
  }, []);

  // Phone apps: a phone in the pocket drops the live connection without telling us. Coming back to the
  // app reconnects and reloads, so a plot booked meanwhile by someone else shows as booked straight away.
  const [resumes, setResumes] = useState(0);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !uid) return;
    let hiddenAt = 0;
    const h = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 2000) { setResumes((n) => n + 1); reload(); }
      hiddenAt = 0;
    });
    return () => { h.then((x) => x.remove()); };
  }, [uid, reload]);

  // Live sync: every change by any team member lands here within a second.
  const orgId = profile?.org_id;
  useEffect(() => {
    if (!orgId || !uid) return;
    const ch = supabase
      .channel(`org-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plots', filter: `org_id=eq.${orgId}` }, (e) => {
        if (e.eventType === 'DELETE') setPlots((all) => all.filter((x) => x.id !== (e.old as Plot).id));
        else upsertPlot(e.new as Plot);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `org_id=eq.${orgId}` }, (e) => {
        if (e.eventType === 'DELETE') setProjects((all) => all.filter((x) => x.id !== (e.old as Project).id));
        else {
          const p = e.new as Project;
          setProjects((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p]));
          // a layout save can delete plots, and delete events can't be filtered by org, so refetch them
          if (e.eventType === 'UPDATE') {
            supabase.from('plots').select('*').eq('project_id', p.id).then(({ data }) => {
              if (data) setPlots((all) => [...all.filter((x) => x.project_id !== p.id), ...(data as Plot[])]);
            });
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `org_id=eq.${orgId}` }, (e) => {
        const p = e.new as Profile;
        if (!p?.id) return;
        setMembers((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p]));
        if (p.id === uid) setProfile(p);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orgs', filter: `id=eq.${orgId}` }, (e) => setOrg(e.new as Org))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient=eq.${uid}` }, (e) => {
        const n = e.new as AppNotification;
        setNotes((all) => [n, ...all.filter((x) => x.id !== n.id)]);
        toast(n.text);
      })
      .subscribe((status) => {
        // after a reconnect (phone slept, network change) catch up on anything missed
        if (status === 'SUBSCRIBED') return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => reload(), 3000);
      });
    return () => { supabase.removeChannel(ch); };
  }, [orgId, uid, upsertPlot, toast, reload, resumes]);

  useEffect(() => {
    if (orgId && uid) registerPush((plotId) => openPlot(plotId));
  }, [orgId, uid]);

  const rpc = useCallback(async <T,>(fn: string, args: Record<string, unknown>, okMsg?: string) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      toast(error.message);
      return null;
    }
    // plot functions return the updated row; apply it now rather than waiting for realtime
    if (data && typeof data === 'object' && 'project_id' in (data as object) && 'label' in (data as object)) upsertPlot(data as Plot);
    if (okMsg) toast(okMsg);
    return (data ?? true) as T;
  }, [toast, upsertPlot]);

  const memberName = useCallback((id: string | null) => {
    if (!id) return '—';
    if (id === uid) return 'You';
    const m = members.find((x) => x.id === id);
    if (!m) return 'Former member';
    return m.role === 'owner' ? 'Owner' : m.full_name;
  }, [members, uid]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    await supabase.auth.signOut();
    location.hash = '/';
  }, []);

  const unread = notes.filter((n) => !n.read_at).length;
  const markAllRead = useCallback(async () => {
    if (!unread) return;
    const { error } = await supabase.rpc('mark_notifications_read');
    if (!error) {
      const now = new Date().toISOString();
      setNotes((all) => all.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    }
  }, [unread]);

  const value = useMemo<Ctx>(() => ({
    session, loading, profile, org, members, projects, plots, towers, unitTypes, notes, unread,
    isOwner: profile?.role === 'owner',
    canSell: profile?.role === 'owner' || profile?.role === 'sales',
    isFinance: profile?.role === 'owner' || profile?.role === 'accountant',
    sheetPlot, openPlot, toast, toastMsg, reload, rpc, upsertPlot, memberName, signOut, markAllRead,
  }), [session, loading, profile, org, members, projects, plots, towers, unitTypes, notes, unread, sheetPlot, toast, toastMsg, reload, rpc, upsertPlot, memberName, signOut, markAllRead]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
