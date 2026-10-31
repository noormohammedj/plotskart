import { DIR } from './format';
import type { Plot, Project, Status } from './types';

/** Price breakdown in rupees; mirrors _value() in the database. Flats add floor rise, PLC and car parks. */
export function priceParts(pr: Project, p: Plot) {
  const base = p.sqft * (p.rate_override || pr.sale_rate);
  if (pr.kind !== 'apartments') return { base, floorRise: 0, plc: 0, parking: 0, total: base };
  const floorRise = (Math.max((p.floor ?? 0) - pr.floor_rise_from, 0) * pr.floor_rise_paise * p.sqft) / 100;
  const plc = p.plc_paise / 100;
  const parking = (p.parking_slots * pr.parking_paise) / 100;
  return { base, floorRise, plc, parking, total: base + floorRise + plc + parking };
}
export const plotValue = (pr: Project, p: Plot) => priceParts(pr, p).total;
/** Singular and plural word for a project's units. */
export const unitWord = (pr: Pick<Project, 'kind'> | undefined, n = 2) => (pr?.kind === 'apartments' ? (n === 1 ? 'flat' : 'flats') : n === 1 ? 'plot' : 'plots');
export const plotBalance = (pr: Project, p: Plot) => (p.status === 'available' ? 0 : Math.max(0, plotValue(pr, p) - p.paid));

export function counts(plots: Plot[]) {
  const c: Record<Status, number> & { total: number } = { sold: 0, booked: 0, available: 0, total: plots.length };
  plots.forEach((p) => c[p.status]++);
  return c;
}

export type VastuNote = { title: string; detail: string; tone: 'good' | 'ok' | 'warn' };

// Common vastu guidance for facing, corner position and shape.
export function vastu(p: Plot): { score: number; notes: VastuNote[] } {
  const main = p.facing[0] ?? 'E';
  let score = { E: 5, N: 5, W: 3.5, S: 2.5 }[main];
  const notes: VastuNote[] = [];
  notes.push({
    title: `${DIR[main]}-facing entrance`,
    detail: {
      E: 'Most preferred. Morning sun reaches the entrance.',
      N: 'Highly preferred. Associated with prosperity.',
      W: 'Acceptable. Keep the gate in the north-west half of the frontage.',
      S: 'Needs care. Keep the gate in the south-east half of the frontage.',
    }[main],
    tone: ({ E: 'good', N: 'good', W: 'ok', S: 'warn' } as const)[main],
  });
  if (p.tower_id) {
    notes[0].title = `${DIR[main]}-facing main door`;
    return { score: Math.max(1, Math.min(5, score)), notes };
  }
  if (p.facing.length > 1) {
    const s = new Set(p.facing);
    if (s.has('N') && s.has('E')) {
      notes.push({ title: 'North-east corner plot', detail: 'Ishanya corner, considered the most auspicious.', tone: 'good' });
      score += 0.5;
    } else if (s.has('S') && s.has('W')) {
      notes.push({ title: 'South-west corner plot', detail: 'Nairutya corner. Suits the master bedroom; keep this corner built-up.', tone: 'ok' });
    } else if (s.has('S') && s.has('E')) {
      notes.push({ title: 'South-east corner plot', detail: 'Agneya corner. Good position for the kitchen.', tone: 'ok' });
      score -= 0.3;
    } else {
      notes.push({ title: 'North-west corner plot', detail: 'Vayavya corner. Average; suits guest rooms and storage.', tone: 'ok' });
    }
  } else {
    notes.push({ title: 'Road on one side', detail: 'Single frontage, no corner influence.', tone: 'ok' });
  }
  const r = Math.max(p.front_ft, p.depth_ft) / Math.max(1, Math.min(p.front_ft, p.depth_ft));
  if (p.geom.pts) {
    notes.push({ title: 'Irregular shape', detail: 'One side is not square to the road. Rated lower in vastu.', tone: 'warn' });
    score -= 0.8;
  } else {
    notes.push({
      title: r <= 1.1 ? 'Square plot' : r <= 1.8 ? 'Rectangular plot' : 'Elongated plot',
      detail: `Side ratio 1 : ${r.toFixed(2)}${r <= 1.8 ? ', within the preferred range.' : '. Long, narrow plots are rated lower.'}`,
      tone: r <= 1.8 ? 'good' : 'warn',
    });
    if (r > 1.8) score -= 0.7;
  }
  return { score: Math.max(1, Math.min(5, Math.round(score * 2) / 2)), notes };
}

export const stars = (s: number) => '★'.repeat(Math.floor(s)) + (s % 1 ? '½' : '') + '☆'.repeat(5 - Math.ceil(s));
