import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Project } from '../lib/types';

export interface Showcase { tagline: string; amenities: string[]; growth_bp: number | null }
export interface PricePoint { year: number; rate_paise: number; note: string | null }
export type DevKind = 'transport' | 'it_park' | 'industry' | 'education' | 'health' | 'retail' | 'road' | 'government' | 'other';
export interface Development { name: string; kind: DevKind; distance_m: number | null; expected_year: number | null; note: string | null }

export const DEV_KINDS: Record<DevKind, [string, string]> = {
  transport: ['🚇', 'Metro / rail / bus'], it_park: ['💼', 'IT park / offices'], industry: ['🏭', 'Industry'],
  education: ['🎓', 'School / college'], health: ['🏥', 'Hospital'], retail: ['🛍️', 'Mall / market'],
  road: ['🛣️', 'Highway / road'], government: ['🏛️', 'Government'], other: ['📍', 'Other'],
};

export const AMENITIES: [string, string][] = [
  ['Gated entrance', '🚪'], ['24×7 security', '🛡️'], ['CCTV', '📹'], ['Compound wall', '🧱'], ['Blacktop roads', '🛣️'],
  ['Street lights', '💡'], ['Underground drainage', '🚰'], ['Water supply', '💧'], ['Electricity', '⚡'],
  ['Park', '🌳'], ["Children's play area", '🛝'], ['Jogging track', '🏃'], ['Club house', '🏠'], ['Swimming pool', '🏊'],
  ['Gym', '🏋️'], ['Temple', '🛕'], ['Rainwater harvesting', '🌧️'], ['Avenue trees', '🌴'], ['Car parking', '🅿️'],
  ['Lift', '🛗'], ['Power backup', '🔋'], ['DTCP approved', '✅'], ['RERA registered', '📜'], ['Bank loan available', '🏦'],
];
export const amenityIcon = (name: string) => AMENITIES.find(([n]) => n === name)?.[1] ?? '✨';

/** Showcase details, price history and upcoming developments of one project. Empty when none are saved yet. */
export function useShowcase(projectId: string) {
  const [show, setShow] = useState<Showcase>({ tagline: '', amenities: [], growth_bp: null });
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [devs, setDevs] = useState<Development[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [s, p, d] = await Promise.all([
      supabase.from('project_showcase').select('tagline, amenities, growth_bp').eq('project_id', projectId).maybeSingle(),
      supabase.from('project_price_points').select('year, rate_paise, note').eq('project_id', projectId).order('year'),
      supabase.from('project_developments').select('name, kind, distance_m, expected_year, note').eq('project_id', projectId).order('sort'),
    ]);
    if (s.data) setShow(s.data as Showcase);
    setPrices(((p.data ?? []) as PricePoint[]).map((x) => ({ ...x, rate_paise: Number(x.rate_paise) })));
    setDevs((d.data ?? []) as Development[]);
    setLoaded(true);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  return { show, prices, devs, loaded, reload: load };
}

/** Today's asking rate per sq ft, in paise. */
export const nowRatePaise = (pr: Project) => Math.round(Number(pr.sale_rate) * 100);

/** Yearly growth in basis points: the owner's figure, or the average yearly growth from the oldest past price to today. */
export function growthBp(show: Showcase, prices: PricePoint[], nowPaise: number, year = new Date().getFullYear()): number | null {
  if (show.growth_bp != null) return show.growth_bp;
  const past = prices.filter((p) => p.year < year);
  if (!past.length || !nowPaise) return null;
  const first = past[0];
  const yrs = year - first.year;
  // a growth rate, not money: ordinary maths is fine here
  const g = Math.pow(nowPaise / first.rate_paise, 1 / yrs) - 1;
  return Math.max(-2000, Math.min(5000, Math.round(g * 10000)));
}

/** A rate (paise) after n years of compound growth, in exact integer maths. */
export function grow(ratePaise: number, bp: number, years: number): number {
  let v = BigInt(Math.round(ratePaise)) * 10000n ** BigInt(years);
  v = v * BigInt(10000 + bp) ** BigInt(years) / 10000n ** BigInt(years);
  return Number(v / 10000n ** BigInt(years));
}

/** The past price closest to a year (within two years), if any. */
export const priceNear = (prices: PricePoint[], year: number) =>
  prices.filter((p) => Math.abs(p.year - year) <= 2).sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year))[0] ?? null;
