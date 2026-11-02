// The team race worked out from plain data, so it can be tested without a browser or the database.
import { plotCommission } from '../lib/finance';
import { ymd } from '../lib/format';
import { plotValue } from '../lib/plots';
import type { Plot, PlotEvent, Profile, Project } from '../lib/types';

/** Points in the team race: a sale counts most, then a registration, then a booking. */
export const POINTS = { booked: 1, registered: 2, sold: 3 } as const;
const WEEKS = 8;

export interface Target { member_id: string; month: string; units: number; value_paise: number }

/** Monday of the week a date falls in, as yyyy-mm-dd. */
export const weekKey = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };

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

export interface RaceInput { events: PlotEvent[]; targets: Target[]; members: Profile[]; plots: Plot[]; projects: Project[] }

/** The race for one month (0 = this month, -1 = last month), as of `now`. "Today" figures only mean something for this month.
    A booking or sale that was later cancelled earns nothing, so booking and cancelling cannot farm points. */
export function computeRace({ events, targets, members, plots, projects }: RaceInput, offset = 0, now = new Date()): Racer[] {
  const plotById = new Map(plots.map((p) => [p.id, p]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1), end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  const day = ymd(now);
  const thisWeek = weekKey(now);
  const weekKeys: string[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i * 7); weekKeys.push(weekKey(d)); }
  // latest cancellation of each plot
  const cancelledAt = new Map<string, string>();
  for (const e of events) if (e.kind === 'cancelled' && (cancelledAt.get(e.plot_id) ?? '') < e.created_at) cancelledAt.set(e.plot_id, e.created_at);
  const byMember = new Map<string, PlotEvent[]>();
  for (const e of events) {
    if (!e.member || (e.kind !== 'booked' && e.kind !== 'sold' && e.kind !== 'registered')) continue;
    if (e.kind !== 'registered' && (cancelledAt.get(e.plot_id) ?? '') > e.created_at) continue;
    const list = byMember.get(e.member);
    if (list) list.push(e); else byMember.set(e.member, [e]);
  }
  const pipelines = new Map<string, Plot[]>();
  for (const p of plots) if (p.status === 'booked' && p.sold_by) { const l = pipelines.get(p.sold_by); if (l) l.push(p); else pipelines.set(p.sold_by, [p]); }

  const racers = members.filter((m) => m.active && (m.role === 'sales' || m.role === 'broker')).map((m): Racer => {
    const r: Racer = {
      m, points: 0, todayPoints: 0, booked: 0, sold: 0, registered: 0, bookedToday: 0, soldToday: 0,
      value: 0, earnedMonth: 0, earnedToday: 0, streak: 0, streakAtRisk: false, weeks: [], lastWin: null,
      target: targets.find((t) => t.member_id === m.id) ?? null, targetPct: null, pipeline: [], pipelineValue: 0,
    };
    const active = new Set<string>();
    for (const e of byMember.get(m.id) ?? []) {
      const kind = e.kind as 'booked' | 'sold' | 'registered';
      const at = new Date(e.created_at);
      if (at > now) continue;
      if (kind !== 'registered') { active.add(weekKey(at)); if (!r.lastWin || e.created_at > r.lastWin) r.lastWin = e.created_at; }
      if (at < start || at >= end) continue;
      const isToday = ymd(at) === day;
      r[kind]++;
      r.points += POINTS[kind];
      if (isToday) r.todayPoints += POINTS[kind];
      if (isToday && kind === 'booked') r.bookedToday++;
      if (kind === 'sold') {
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
    const cur = new Date(now);
    if (!active.has(thisWeek)) { r.streakAtRisk = true; cur.setDate(cur.getDate() - 7); }
    while (active.has(weekKey(cur))) { r.streak++; cur.setDate(cur.getDate() - 7); }
    if (!r.streak) r.streakAtRisk = false;
    if (r.target?.units) r.targetPct = r.sold / r.target.units;
    r.pipeline = pipelines.get(m.id) ?? [];
    r.pipelineValue = r.pipeline.reduce((s, p) => { const pr = projectById.get(p.project_id); return s + (pr ? plotValue(pr, p) : 0); }, 0);
    return r;
  });
  racers.sort((a, b) => b.points - a.points || b.value - a.value || b.streak - a.streak || a.m.full_name.localeCompare(b.m.full_name));
  return racers;
}

export const daysLeftInMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
const monthShare = (now: Date) => now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

export interface Insight { tone: 'good' | 'warn' | 'info'; who: Profile; text: string }

/** Plain-language coaching for the owner: who is ahead, who is slipping, and what would help. */
export function coach(racers: Racer[], now = new Date()): Insight[] {
  const out: Insight[] = [];
  const share = monthShare(now);
  racers.forEach((r, i) => {
    const n = r.m.full_name;
    const quiet = r.lastWin ? Math.floor((now.getTime() - new Date(r.lastWin).getTime()) / 864e5) : null;
    if (r.target?.units) {
      const pace = r.target.units * share;
      if (r.sold >= r.target.units) out.push({ tone: 'good', who: r.m, text: `${n} has hit this month's target (${r.sold} of ${r.target.units} sold). Time to recognise it.` });
      else if (r.sold + 0.5 < pace) out.push({ tone: 'warn', who: r.m, text: `${n} is behind pace: ${r.sold} of ${r.target.units} sold, should be near ${Math.round(pace)} by now.` });
    }
    if (share > 0.25 && r.pipeline.length >= 2 && r.sold === 0) out.push({ tone: 'warn', who: r.m, text: `${n} holds ${r.pipeline.length} bookings but no sale yet this month. Help close them.` });
    const hit = !!r.target?.units && r.sold >= r.target.units;
    if (!hit && quiet !== null && quiet >= 10) out.push({ tone: 'warn', who: r.m, text: `${n} hasn't booked or sold in ${quiet} days. A site visit or fresh leads may help.` });
    if (quiet === null) out.push({ tone: 'info', who: r.m, text: `${n} has no bookings yet. Pair them with ${racers[0] && racers[0] !== r ? racers[0].m.full_name : 'a senior'} for a few site visits.` });
    if (i === 0 && r.points > 0) out.push({ tone: 'good', who: r.m, text: `${n} leads the race with ${r.points} points this month.` });
    if (r.streak >= 3) out.push({ tone: 'good', who: r.m, text: `${n} is on a ${r.streak}-week streak.` });
  });
  // problems first, but always keep room for good news so wins get recognised too
  // one problem per person (the first, most important one found), so the owner sees more of the team
  const seen = new Set<string>();
  const problems = out.filter((t) => t.tone !== 'good' && !seen.has(t.who.id) && seen.add(t.who.id))
    .sort((a, b) => (a.tone === 'warn' ? 0 : 1) - (b.tone === 'warn' ? 0 : 1));
  const wins = out.filter((t) => t.tone === 'good');
  const keep = Math.min(problems.length, wins.length ? 4 : 5);
  return [...problems.slice(0, keep), ...wins.slice(0, 5 - keep)];
}
