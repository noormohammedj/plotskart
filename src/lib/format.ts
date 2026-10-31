import type { Dir, Status } from './types';

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const today = () => ymd(startOfToday());

export const dayOff = (n: number) => {
  const d = startOfToday();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export const daysTo = (s: string) => Math.round((new Date(s + 'T00:00:00').getTime() - startOfToday().getTime()) / 864e5);

export const fmtD = (s: string | null | undefined) =>
  s ? new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtT = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export const inr = (n: number | null | undefined) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

export const short = (n: number | null | undefined) => {
  const v = n || 0;
  const a = Math.abs(v);
  const s = a >= 1e7 ? (a / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? (a / 1e5).toFixed(1) + ' L' : Math.round(a).toLocaleString('en-IN');
  return (v < 0 ? '−' : '') + '₹' + s;
};

export const whenTxt = (d: number) =>
  d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;

export const LBL: Record<Status, string> = { sold: 'Sold', booked: 'Booked', available: 'Available' };
export const DIR: Record<Dir, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };

export const SQFT_PER_CENT = 435.6;
export const SQM_PER_SQFT = 0.092903;

export const CATS = ['Land purchase', 'Registration', 'Layout design', 'Electricity', 'Water connection', 'Road', 'Broker', 'Marketing', 'Sales', 'Legal', 'Other'];
