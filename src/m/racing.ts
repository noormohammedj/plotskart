import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { ymd } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { PlotEvent } from '../lib/types';
import { computeRace, type Target } from './raceCore';

export { coach, daysLeftInMonth, POINTS, type Insight, type Racer, type Target } from './raceCore';

const RACE_KINDS = ['booked', 'sold', 'registered', 'cancelled'] as const;

/** Bookings, sales, registrations and cancellations over the last ~7 months, kept live. */
export function useSalesEvents() {
  const { org } = useData();
  const [events, setEvents] = useState<PlotEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!org) return;
    const since = new Date();
    since.setDate(since.getDate() - 210);
    supabase.from('plot_events').select('*').eq('org_id', org.id).in('kind', RACE_KINDS as unknown as string[])
      .gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(5000)
      .then(({ data }) => { setEvents((data ?? []) as PlotEvent[]); setLoaded(true); });
    const ch = supabase.channel(`race-${org.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plot_events', filter: `org_id=eq.${org.id}` }, (e) => {
        const ev = e.new as PlotEvent;
        if ((RACE_KINDS as readonly string[]).includes(ev.kind ?? '')) setEvents((all) => [ev, ...all.filter((x) => x.id !== ev.id)]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [org]);
  return { events, loaded };
}

const monthStart = (offset = 0) => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() + offset, 1)); };

/** A month's targets for everyone in the company (0 = this month, -1 = last month). */
export function useTargets(offset = 0) {
  const { org } = useData();
  const [targets, setTargets] = useState<Target[]>([]);
  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from('sales_targets').select('member_id, month, units, value_paise').eq('month', monthStart(offset));
    setTargets(((data ?? []) as Target[]).map((t) => ({ ...t, units: Number(t.units), value_paise: Number(t.value_paise) })));
  }, [org, offset]);
  useEffect(() => { load(); }, [load]);
  return { targets, reload: load };
}

/** The race for one month (0 = this month, -1 = last month). */
export function useRace(events: PlotEvent[], targets: Target[], offset = 0) {
  const { members, plots, projects } = useData();
  return useMemo(() => computeRace({ events, targets, members, plots, projects }, offset), [events, targets, members, plots, projects, offset]);
}
