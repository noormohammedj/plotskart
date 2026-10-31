import { plotValue } from './plots';
import type { CommissionPayment, CommissionType, CostLine, Funding, Plot, Profile, Project } from './types';

export const fmtCommission = (type: CommissionType | null | undefined, rate: number | null | undefined) =>
  type === 'per_sqft' ? `₹${Number(rate ?? 0).toLocaleString('en-IN')}/sq ft` : `${Number(rate ?? 0)}%`;

/** Commission on one sold plot, using the deal frozen on the plot (or the person's current deal). */
export function plotCommission(pr: Project, p: Plot, member: Profile) {
  const type = p.commission_type ?? member.commission_type;
  const rate = Number(p.commission_rate ?? member.commission_rate);
  return type === 'per_sqft' ? Number(p.sqft) * rate : (plotValue(pr, p) * rate) / 100;
}

export function commissionOf(
  member: Profile,
  projects: Project[],
  plots: Plot[],
  payments: CommissionPayment[],
  projectId?: string,
) {
  let earned = 0, sold = 0, booked = 0, value = 0;
  const handled: Plot[] = [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const p of plots) {
    if (p.sold_by !== member.id || p.status === 'available') continue;
    if (projectId && p.project_id !== projectId) continue;
    const pr = byId.get(p.project_id);
    if (!pr) continue;
    handled.push(p);
    if (p.status === 'sold') {
      sold++;
      const v = plotValue(pr, p);
      value += v;
      earned += plotCommission(pr, p, member);
    } else booked++;
  }
  const paid = payments
    .filter((c) => c.member_id === member.id && (!projectId || c.project_id === projectId))
    .reduce((a, c) => a + Number(c.amount), 0);
  return { earned, paid, pending: Math.max(0, earned - paid), sold, booked, value, plots: handled };
}

export function projectFinance(
  pr: Project,
  plots: Plot[],
  costs: CostLine[],
  funding: Funding | undefined,
  members: Profile[],
  payments: CommissionPayment[],
) {
  let revenue = 0, contract = 0, collected = 0, pendingCust = 0, unsold = 0;
  const mine = plots.filter((p) => p.project_id === pr.id);
  for (const p of mine) {
    const v = plotValue(pr, p);
    revenue += v;
    if (p.status === 'available') unsold += v;
    else {
      contract += v;
      collected += Number(p.paid);
      pendingCust += Math.max(0, v - p.paid);
    }
  }
  const lines = costs.filter((c) => c.project_id === pr.id);
  const committed = lines.reduce((a, c) => a + Number(c.committed), 0);
  const paid = lines.reduce((a, c) => a + Number(c.paid), 0);
  let commEarned = 0, commPaid = 0;
  for (const m of members) {
    if (m.role === 'owner') continue;
    const c = commissionOf(m, [pr], mine, payments, pr.id);
    commEarned += c.earned;
    commPaid += c.paid;
  }
  const cost = committed + commEarned;
  const out = paid + commPaid;
  const toPay = committed - paid + Math.max(0, commEarned - commPaid);
  const f = funding ?? { bank: 0, credit: 0, cash: 0 };
  const invested = Number(f.bank) + Number(f.credit) + Number(f.cash);
  return {
    revenue, contract, collected, pendingCust, unsold, committed, paid, commEarned, commPaid,
    cost, out, toPay, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : 0,
    invested, net: collected - out, lines,
  };
}
