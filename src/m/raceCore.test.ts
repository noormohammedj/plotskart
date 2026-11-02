// Team race checks: points, cancellations, month edges, streaks, commission, targets, coaching, and a stress run.
// Run: npm run test:race
import { coach, computeRace, type Target } from './raceCore';
import type { Plot, PlotEvent, Profile, Project } from '../lib/types';

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const person = (id: string, name: string, role: Profile['role'] = 'sales', active = true): Profile => ({
  id, org_id: 'o', email: null, full_name: name, phone: null, role, commission_rate: 2, commission_type: 'percent',
  monthly_salary: 0, active, whatsapp_alerts: false, whatsapp_summary: false,
});
const project: Project = {
  id: 'pr', org_id: 'o', name: 'Greens', location: 'X', lat: null, lng: null, approval: null, launched: null, guideline_rate: 0,
  sale_rate: 1000, rate_updated_by: null, rate_updated_at: null, layout: { w: 1, h: 1, roads: [], parks: [], labels: [] },
  created_at: '', kind: 'plots', rera_no: null, floor_rise_paise: 0, floor_rise_from: 0, parking_paise: 0, gst_bp: 0,
};
const plot = (id: string, status: Plot['status'], soldBy: string | null, sqft = 1000): Plot => ({
  id, project_id: 'pr', org_id: 'o', label: id, geom: { x: 0, y: 0, w: 1, h: 1 }, front_ft: 30, depth_ft: 40, sqft, facing: ['E'],
  status, rate_override: null, buyer_name: null, buyer_phone: null, buyer_whatsapp: false, paid: 0, due_date: null, reg_date: null,
  registered: false, sold_by: soldBy, commission_rate: null, commission_type: null, updated_at: '', tower_id: null, floor: null,
  unit_type_id: null, plc_paise: 0, parking_slots: 0,
});
let n = 0;
const ev = (plotId: string, member: string | null, kind: PlotEvent['kind'], at: Date): PlotEvent =>
  ({ id: `e${n++}`, plot_id: plotId, org_id: 'o', actor: member, member, kind, text: '', created_at: at.toISOString() });
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

// "now": Wednesday 18 November 2026, 3 pm
const NOW = at(2026, 11, 18, 15);
const priya = person('priya', 'Priya'), ravi = person('ravi', 'Ravi'), suresh = person('suresh', 'Suresh', 'broker');
const owner = person('owner', 'Owner', 'owner'), gone = person('gone', 'Left the company', 'sales', false);
const members = [owner, priya, ravi, suresh, gone];

// 1. points and today
{
  const plots = [plot('a', 'sold', 'priya'), plot('b', 'booked', 'priya'), plot('c', 'sold', 'ravi')];
  const events = [
    ev('a', 'priya', 'booked', at(2026, 11, 3)), ev('a', 'priya', 'sold', at(2026, 11, 10)), ev('a', 'priya', 'registered', at(2026, 11, 18, 10)),
    ev('b', 'priya', 'booked', at(2026, 11, 18, 9)),
    ev('c', 'ravi', 'sold', at(2026, 11, 18, 11)),
    ev('a', 'gone', 'booked', at(2026, 11, 5)),
  ];
  const race = computeRace({ events, targets: [], members, plots, projects: [project] }, 0, NOW);
  const p = race.find((r) => r.m.id === 'priya')!, r = race.find((x) => x.m.id === 'ravi')!;
  ok(race.length === 3, 'only active salespeople and brokers race (no owner, no former staff)');
  ok(p.points === 1 + 3 + 2 + 1 && p.booked === 2 && p.sold === 1 && p.registered === 1, 'points: booking 1, sale 3, registration 2');
  ok(p.todayPoints === 2 + 1 && p.bookedToday === 1, "today's points count only today's events");
  ok(r.points === 3 && r.soldToday === 1, 'a sale today counts for today and the month');
  ok(p.earnedMonth === 20000 && p.value === 1000000, 'commission: 2% of a ₹10 L sale is ₹20,000');
  ok(r.earnedToday === 20000, 'commission earned today');
  ok(race[0].m.id === 'priya', 'most points leads the race');
  ok(p.pipeline.length === 1 && p.pipelineValue === 1000000, 'pipeline = plots booked by the person now');
}

// 2. cancellations cannot farm points
{
  const plots = [plot('a', 'available', null), plot('b', 'booked', 'ravi')];
  const events = [
    ev('a', 'priya', 'booked', at(2026, 11, 2)), ev('a', null, 'cancelled', at(2026, 11, 3)),
    ev('a', 'priya', 'booked', at(2026, 11, 4)), ev('a', null, 'cancelled', at(2026, 11, 5)),
    ev('b', 'ravi', 'booked', at(2026, 11, 2)), ev('b', null, 'cancelled', at(2026, 11, 3)), ev('b', 'ravi', 'booked', at(2026, 11, 6)),
  ];
  const race = computeRace({ events, targets: [], members, plots, projects: [project] }, 0, NOW);
  ok(race.find((r) => r.m.id === 'priya')!.points === 0, 'booking then cancelling earns nothing');
  ok(race.find((r) => r.m.id === 'ravi')!.points === 1, 'a fresh booking after a cancellation counts once');
}

// 3. month edges
{
  const plots = [plot('a', 'booked', 'priya'), plot('b', 'booked', 'priya')];
  const events = [ev('a', 'priya', 'booked', at(2026, 10, 31, 23, 59)), ev('b', 'priya', 'booked', at(2026, 11, 1, 0, 0))];
  const input = { events, targets: [], members, plots, projects: [project] };
  ok(computeRace(input, 0, NOW).find((r) => r.m.id === 'priya')!.points === 1, '31 Oct 23:59 is last month, 1 Nov 00:00 is this month');
  ok(computeRace(input, -1, NOW).find((r) => r.m.id === 'priya')!.points === 1, 'last month view picks up the October booking');
  const jan = computeRace({ ...input, events: [ev('a', 'priya', 'booked', at(2026, 12, 31, 20))] }, -1, at(2027, 1, 2));
  ok(jan.find((r) => r.m.id === 'priya')!.points === 1, 'last month works across the new year');
  const future = computeRace({ ...input, events: [ev('a', 'priya', 'booked', at(2026, 11, 30))] }, 0, NOW);
  ok(future.find((r) => r.m.id === 'priya')!.points === 0, 'an event dated in the future (wrong phone clock) is ignored');
}

// 4. streaks (weeks start on Monday; 16 Nov 2026 is a Monday)
{
  const plots = [plot('a', 'booked', 'priya')];
  const wk = (d: number) => at(2026, 11, d);
  const base = { targets: [], members, plots, projects: [project] };
  const run = (dates: Date[]) => computeRace({ ...base, events: dates.map((d) => ev('a', 'priya', 'booked', d)) }, 0, NOW).find((r) => r.m.id === 'priya')!;
  let r = run([wk(17), wk(10), at(2026, 11, 3), at(2026, 10, 27)]);
  ok(r.streak === 4 && !r.streakAtRisk, 'four weeks in a row, including this one: 4-week streak');
  r = run([wk(10), at(2026, 11, 3)]);
  ok(r.streak === 2 && r.streakAtRisk, 'nothing yet this week: streak kept but at risk');
  r = run([wk(17), at(2026, 11, 3)]);
  ok(r.streak === 1, 'a missed week breaks the streak');
  r = run([at(2026, 11, 15, 23, 30), wk(16)]);
  ok(r.streak === 2, 'Sunday night and Monday morning are different weeks');
  ok(r.weeks.length === 8 && r.weeks[7] === true && r.weeks[6] === true && r.weeks[5] === false, 'last 8 weeks shown oldest first');
  r = run([]);
  ok(r.streak === 0 && !r.streakAtRisk, 'no bookings: no streak and nothing at risk');
}

// 5. targets and coaching
{
  const plots = [plot('a', 'sold', 'priya'), plot('b', 'sold', 'priya'), plot('c', 'booked', 'ravi'), plot('d', 'booked', 'ravi')];
  const events = [
    ev('a', 'priya', 'sold', at(2026, 11, 5)), ev('b', 'priya', 'sold', at(2026, 11, 6)),
    ev('c', 'ravi', 'booked', at(2026, 10, 20)), ev('d', 'ravi', 'booked', at(2026, 10, 21)),
  ];
  const targets: Target[] = [{ member_id: 'priya', month: '2026-11-01', units: 2, value_paise: 0 }, { member_id: 'ravi', month: '2026-11-01', units: 6, value_paise: 0 }];
  const race = computeRace({ events, targets, members, plots, projects: [project] }, 0, NOW);
  ok(race.find((r) => r.m.id === 'priya')!.targetPct === 1, 'target progress: 2 of 2 sold = 100%');
  const tips = coach(race, NOW).map((t) => t.text).join(' | ');
  ok(tips.includes("Priya has hit this month's target"), 'coach: praises a hit target');
  ok(tips.includes('Ravi is behind pace'), 'coach: flags someone behind pace (0 of 6 on the 18th)');
  ok((tips.match(/Ravi/g) ?? []).length === 1, 'coach: one tip per person, the most important first');
  ok(!tips.includes("Priya hasn't booked"), 'coach: no "quiet" nag for someone who has hit the target');
  const noTargets = coach(computeRace({ events, targets: [], members, plots, projects: [project] }, 0, NOW), NOW).map((t) => t.text).join(' | ');
  ok(noTargets.includes('Ravi holds 2 bookings but no sale'), 'coach: flags bookings that are not closing');
  const quiet = coach(computeRace({ events: events.slice(2), targets: [], members, plots: plots.slice(0, 2), projects: [project] }, 0, NOW), NOW).map((t) => t.text).join(' | ');
  ok(quiet.includes("Ravi hasn't booked or sold in 28 days"), 'coach: flags a quiet salesperson');
  ok(tips.includes('Suresh has no bookings yet'), 'coach: suggests pairing a newcomer');
  ok(coach(race, NOW).length <= 5 && coach(race, NOW)[0].tone === 'warn', 'coach: at most 5 tips, problems first');
  const early = coach(computeRace({ events, targets, members, plots, projects: [project] }, 0, at(2026, 11, 3)), at(2026, 11, 3)).map((t) => t.text).join(' | ');
  ok(!early.includes('holds 2 bookings'), 'coach: no "not closing" nag in the first week of a month');
}

// 6. stress: 200 people, 50,000 plots, 100,000 events
{
  const people = Array.from({ length: 200 }, (_, i) => person(`m${i}`, `Person ${i}`, i % 5 ? 'sales' : 'broker'));
  const plots = Array.from({ length: 50000 }, (_, i) => plot(`p${i}`, i % 3 === 0 ? 'sold' : i % 3 === 1 ? 'booked' : 'available', i % 3 === 2 ? null : `m${i % 200}`, 800 + (i % 900)));
  const kinds: PlotEvent['kind'][] = ['booked', 'sold', 'registered', 'cancelled'];
  const events = Array.from({ length: 100000 }, (_, i) => ev(`p${i % 50000}`, i % 4 === 3 ? null : `m${i % 200}`, kinds[i % 4], new Date(NOW.getTime() - (i % 200) * 864e5 - (i % 1440) * 6e4)));
  const t0 = performance.now();
  const race = computeRace({ events, targets: [], members: people, plots, projects: [project] }, 0, NOW);
  const ms = performance.now() - t0;
  const t1 = performance.now();
  coach(race, NOW);
  const msCoach = performance.now() - t1;
  ok(race.length === 200 && race.every((r) => Number.isFinite(r.points) && Number.isFinite(r.earnedMonth)), 'stress: 200 racers, all numbers finite');
  ok(race.every((r, i) => i === 0 || race[i - 1].points >= r.points), 'stress: board is sorted by points');
  ok(ms < 1500, `stress: race worked out in ${Math.round(ms)} ms (limit 1500 ms)`);
  ok(msCoach < 50, `stress: coaching in ${Math.round(msCoach)} ms`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
