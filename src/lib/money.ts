import { ymd } from './format';
import type { Asset, LedgerEntry, PayMode } from './types';

export const MODES: Record<PayMode, string> = {
  bank_transfer: 'Bank transfer / NEFT', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', card: 'Card', other: 'Other',
};

/** Money that funds the business (loans, capital): cash in, but not income. */
export const FUNDING_CATS = ['Bank loan disbursed', 'Private finance', 'Owner capital'];
export const INCOME_CATS = ['Rent received', 'Interest', 'Booking cancellation fee', 'Other income', ...FUNDING_CATS];
export const EXPENSE_CATS = ['Office expenses', 'Fuel & travel', 'Legal & professional', 'Salaries & wages', 'Advertising', 'Bank charges', 'Repairs & maintenance', 'Other expense'];

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const three = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n));

/** 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only" (Indian system). */
export function rupeesInWords(amount: number) {
  let n = Math.round(amount);
  if (n === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore % 1000)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
}

/** Downloads rows as a CSV file that opens in Excel. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export type Period = { key: string; label: string; from: string | null; to: string | null };

/** Reporting periods, using the Indian financial year (April to March). */
export function periods(today = new Date()): Period[] {
  const y = today.getFullYear(), m = today.getMonth();
  const d = (yy: number, mm: number, dd: number) => ymd(new Date(yy, mm, dd));
  const fyStart = m >= 3 ? y : y - 1;
  return [
    { key: 'month', label: 'This month', from: d(y, m, 1), to: d(y, m + 1, 0) },
    { key: 'last-month', label: 'Last month', from: d(y, m - 1, 1), to: d(y, m, 0) },
    { key: 'quarter', label: 'Last 3 months', from: d(y, m - 2, 1), to: d(y, m + 1, 0) },
    { key: 'fy', label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, from: d(fyStart, 3, 1), to: d(fyStart + 1, 2, 31) },
    { key: 'last-fy', label: `FY ${fyStart - 1}-${String(fyStart).slice(2)}`, from: d(fyStart - 1, 3, 1), to: d(fyStart, 2, 31) },
    { key: 'all', label: 'Lifetime', from: null, to: null },
  ];
}

export const inPeriod = (date: string, p: { from: string | null; to: string | null }) =>
  (!p.from || date >= p.from) && (!p.to || date <= p.to);

export const signed = (e: LedgerEntry) => (e.direction === 'in' ? Number(e.amount) : -Number(e.amount));

/** Reducing-balance value of an asset today. */
export function assetValue(a: Asset, on = new Date()) {
  const years = Math.max(0, (on.getTime() - new Date(a.purchase_date).getTime()) / (365.25 * 864e5));
  return Number(a.cost) * Math.pow(1 - Number(a.depreciation_pct) / 100, years);
}

/** Last n months as [{ key: '2026-10', label: 'Oct' }], oldest first. */
export function lastMonths(n: number, today = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (n - 1 - i), 1);
    return { key: ymd(d).slice(0, 7), label: d.toLocaleDateString('en-IN', { month: 'short' }) };
  });
}
