import { daysTo, fmtD, inr, whenTxt } from './format';
import { plotBalance } from './plots';
import type { Org, Plot, Profile, Project } from './types';

export type Reminder = { type: 'reg' | 'pay'; d: number; pr: Project; p: Plot };

// Mirrors run_daily_reminders() in the database so the app can show what is coming up.
export function upcomingReminders(projects: Project[], plots: Plot[], me: Profile, windowDays = 14): Reminder[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: Reminder[] = [];
  for (const p of plots) {
    if (p.status === 'available') continue;
    if (me.role === 'broker' && p.sold_by !== me.id) continue;
    const pr = byId.get(p.project_id);
    if (!pr) continue;
    if (p.reg_date && !p.registered) {
      const d = daysTo(p.reg_date);
      if (d >= -7 && d <= windowDays) out.push({ type: 'reg', d, pr, p });
    }
    if (plotBalance(pr, p) > 0 && p.due_date) {
      const d = daysTo(p.due_date);
      if (d <= windowDays && d >= -30) out.push({ type: 'pay', d, pr, p });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

export const isDue = (r: Reminder, org: Org) => (r.type === 'reg' ? r.d >= 0 && r.d <= org.reg_days : r.d <= org.pay_days);

export function customerText(r: Reminder, company: string) {
  const { pr, p } = r;
  const b = plotBalance(pr, p);
  if (r.type === 'reg') {
    return `Dear ${p.buyer_name}, registration of plot ${p.label} at ${pr.name} is scheduled on ${fmtD(p.reg_date)} at the Sub-Registrar office. Please bring Aadhaar, PAN, 2 passport photos${b > 0 ? ' and the balance of ' + inr(b) : ''}. – ${company}`;
  }
  return `Dear ${p.buyer_name}, a reminder that the balance of ${inr(b)} for plot ${p.label} at ${pr.name} ${r.d < 0 ? 'was due on' : 'is due on'} ${fmtD(p.due_date)}. Please contact us to complete the payment. – ${company}`;
}

export const reminderTitle = (r: Reminder) =>
  r.type === 'reg' ? `Registration ${whenTxt(r.d)}` : r.d < 0 ? `Payment overdue by ${-r.d} days` : `Payment due ${whenTxt(r.d)}`;
