import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data/DataProvider';
import { plotCommission } from '../lib/finance';
import { today, ymd } from '../lib/format';
import { plotValue } from '../lib/plots';
import { supabase } from '../lib/supabase';
import type { Plot, PlotEvent, Profile } from '../lib/types';

/** Points in the team race: a sale counts most, then a registration, then a booking. */
export const POINTS = { booked: 1, registered: 2, sold: 3 } as const;
const RACE_KINDS = ['booked', 'sold', 'registered', 'cancelled'] as const;
const WEEKS = 8;

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

export interface Target { member_id: string; month: string; units: number; value_paise: number }

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

/** Monday of the week a date falls in, as yyyy-mm-dd. */
const weekKey = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };

export interface Racer {
  m: Profile;
  points: number;
  todayPoints: number;
  booked: number; sold: number; registered: number;
  bookedToday: number; soldToday: number;
  /** sale value and commission on plots sold this month (and today) */
  value: number; earnedMonth: number; earnedToday: number;
  /** weeks in a row with at least one booking or sale; the current week counts once it has one */
  streak: number; streakAtRisk: boolean;
  /** the last 8 weeks, oldest first: was there a booking or sale? */
  weeks: boolean[];
  lastWin: string | null;
  target: Target | null;
  /** 0..1 of the unit target (sales), when there is one */
  targetPct: number | null;
  pipeline: Plot[]; pipelineValue: number;
}

/** The race for one month (0 = this month, -1 = last month). "Today" figures only mean something for this month. */
export function useRace(events: PlotEvent[], targets: Target[], offset = 0) {
  const { members, plots, projects } = useData();
  return useMemo(() => {
    const plotById = new Map(plots.map((p) => [p.id, p]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1), end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    const day = today();
    const thisWeek = weekKey(new Date());
    const weekKeys: string[] = [];
    for (let i = WEEKS - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i * 7); weekKeys.push(weekKey(d)); }

    const racers = members.filter((m) => m.active && (m.role === 'sales' || m.role === 'broker')).map((m): Racer => {
      const mine = events.filter((e) => e.member === m.id);
      const r: Racer = {
        m, points: 0, todayPoints: 0, booked: 0, sold: 0, registered: 0, bookedToday: 0, soldToday: 0,
        value: 0, earnedMonth: 0, earnedToday: 0, streak: 0, streakAtRisk: false, weeks: [], lastWin: null,
        target: targets.find((t) => t.member_id === m.id) ?? null, targetPct: null, pipeline: [], pipelineValue: 0,
      };
      const active = new Set<string>();
      for (const e of mine) {
        if (e.kind !== 'booked' && e.kind !== 'sold' && e.kind !== 'registered') continue;
        const at = new Date(e.created_at);
        if (e.kind !== 'registered') { active.add(weekKey(at)); if (!r.lastWin || e.created_at > r.lastWin) r.lastWin = e.created_at; }
        if (at < start || at >= end) continue;
        const isToday = ymd(at) === day;
        r[e.kind]++;
        r.points += POINTS[e.kind];
        if (isToday) r.todayPoints += POINTS[e.kind];
        if (isToday && e.kind === 'booked') r.bookedToday++;
        if (e.kind === 'sold') {
          if (isToday) r.soldToday++;
          const p = plotById.get(e.plot_id), pr = p && projectById.get(p.project_id);
          if (p && pr && p.status === 'sold') {
            const c = plotCommission(pr, p, m);
            r.value += plotValue(pr, p);
            r.earnedMonth += c;
            if (isToday) r.earnedToday += c;
          }
        }
      }
      r.weeks = weekKeys.map((k) => active.has(k));
      // streak: count back week by week; a quiet current week doesn't break it yet, it only puts it at risk
      const cur = new Date();
      if (!active.has(thisWeek)) { r.streakAtRisk = true; cur.setDate(cur.getDate() - 7); }
      while (active.has(weekKey(cur))) { r.streak++; cur.setDate(cur.getDate() - 7); }
      if (!r.streak) r.streakAtRisk = false;
      if (r.target?.units) r.targetPct = r.sold / r.target.units;
      r.pipeline = plots.filter((p) => p.sold_by === m.id && p.status === 'booked');
      r.pipelineValue = r.pipeline.reduce((s, p) => { const pr = projectById.get(p.project_id); return s + (pr ? plotValue(pr, p) : 0); }, 0);
      return r;
    });
    racers.sort((a, b) => b.points - a.points || b.value - a.value || b.streak - a.streak || a.m.full_name.localeCompare(b.m.full_name));
    return racers;
  }, [events, targets, members, plots, projects, offset]);
}

export const daysLeftInMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate(); };
const monthShare = () => { const d = new Date(); return d.getDate() / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

export interface Insight { tone: 'good' | 'warn' | 'info'; who: Profile; text: string }

/** Plain-language coaching for the owner: who is ahead, who is slipping, and what would help. */
export function coach(racers: Racer[]): Insight[] {
  const out: Insight[] = [];
  const share = monthShare();
  racers.forEach((r, i) => {
    const n = r.m.full_name;
    const quiet = r.lastWin ? Math.floor((Date.now() - new Date(r.lastWin).getTime()) / 864e5) : null;
    if (r.target?.units) {
      const pace = r.target.units * share;
      if (r.sold >= r.target.units) out.push({ tone: 'good', who: r.m, text: `${n} has hit this month's target (${r.sold} of ${r.target.units} sold). Time to recognise it.` });
      else if (r.sold + 0.5 < pace) out.push({ tone: 'warn', who: r.m, text: `${n} is behind pace: ${r.sold} of ${r.target.units} sold, should be near ${Math.round(pace)} by now.` });
    }
    if (share > 0.25 && r.pipeline.length >= 2 && r.sold === 0) out.push({ tone: 'warn', who: r.m, text: `${n} holds ${r.pipeline.length} bookings but no sale yet this month. Help close them.` });
    if (quiet !== null && quiet >= 10) out.push({ tone: 'warn', who: r.m, text: `${n} hasn't booked or sold in ${quiet} days. A site visit or fresh leads may help.` });
    if (quiet === null) out.push({ tone: 'info', who: r.m, text: `${n} has no bookings yet. Pair them with ${racers[0] && racers[0] !== r ? racers[0].m.full_name : 'a senior'} for a few site visits.` });
    if (i === 0 && r.points > 0) out.push({ tone: 'good', who: r.m, text: `${n} leads the race with ${r.points} points this month.` });
    if (r.streak >= 3) out.push({ tone: 'good', who: r.m, text: `${n} is on a ${r.streak}-week streak.` });
  });
  const rank = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 5);
}
