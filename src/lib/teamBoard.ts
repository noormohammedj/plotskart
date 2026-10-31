import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { plotCommission } from './finance';
import { today, ymd } from './format';
import { plotValue } from './plots';
import { supabase } from './supabase';
import type { Plot, PlotEvent, Profile } from './types';

/** The last 200 plot events in the company (45 days), kept live. */
export function useTeamEvents() {
  const { org } = useData();
  const [events, setEvents] = useState<PlotEvent[]>([]);
  useEffect(() => {
    if (!org) return;
    const since = new Date();
    since.setDate(since.getDate() - 45);
    supabase.from('plot_events').select('*').eq('org_id', org.id).gte('created_at', since.toISOString())
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setEvents((data ?? []) as PlotEvent[]));
    const ch = supabase.channel(`events-${org.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plot_events', filter: `org_id=eq.${org.id}` },
        (e) => setEvents((all) => [e.new as PlotEvent, ...all.filter((x) => x.id !== (e.new as PlotEvent).id)]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [org]);
  return events;
}

export interface BoardRow {
  m: Profile;
  /** this month, from bookings and sales credited to the person */
  booked: number;
  sold: number;
  value: number;
  /** commission earned on plots sold this month, and today */
  earnedMonth: number;
  earnedToday: number;
  soldToday: number;
  bookedToday: number;
  /** plots the person holds as booked right now, and what they would sell for */
  pipeline: Plot[];
  pipelineValue: number;
}

/** This month's race for sales staff and brokers, with commission earned today and this month.
    Commission uses the deal frozen on the plot, the same as the Team page. */
export function useTeamBoard(events: PlotEvent[]) {
  const { members, plots, projects } = useData();
  return useMemo(() => {
    const plotById = new Map(plots.map((p) => [p.id, p]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const memberById = new Map(members.map((m) => [m.id, m]));
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const day = today();
    const rows = new Map<string, Omit<BoardRow, 'm' | 'pipeline' | 'pipelineValue'>>();
    for (const e of events) {
      if (new Date(e.created_at) < start || !e.member || (e.kind !== 'booked' && e.kind !== 'sold')) continue;
      const r = rows.get(e.member) ?? { booked: 0, sold: 0, value: 0, earnedMonth: 0, earnedToday: 0, soldToday: 0, bookedToday: 0 };
      const isToday = ymd(new Date(e.created_at)) === day;
      r[e.kind]++;
      if (isToday) r[e.kind === 'sold' ? 'soldToday' : 'bookedToday']++;
      const p = plotById.get(e.plot_id), pr = p && projectById.get(p.project_id), m = memberById.get(e.member);
      if (e.kind === 'sold' && p && pr && p.status === 'sold') {
        r.value += plotValue(pr, p);
        const c = m ? plotCommission(pr, p, m) : 0;
        r.earnedMonth += c;
        if (isToday) r.earnedToday += c;
      }
      rows.set(e.member, r);
    }
    return members.filter((m) => m.active && (m.role === 'sales' || m.role === 'broker'))
      .map((m): BoardRow => {
        const pipeline = plots.filter((p) => p.sold_by === m.id && p.status === 'booked');
        const pipelineValue = pipeline.reduce((s, p) => { const pr = projectById.get(p.project_id); return s + (pr ? plotValue(pr, p) : 0); }, 0);
        return { m, ...(rows.get(m.id) ?? { booked: 0, sold: 0, value: 0, earnedMonth: 0, earnedToday: 0, soldToday: 0, bookedToday: 0 }), pipeline, pipelineValue };
      })
      .sort((a, b) => b.sold - a.sold || b.value - a.value || b.booked - a.booked);
  }, [events, members, plots, projects]);
}
