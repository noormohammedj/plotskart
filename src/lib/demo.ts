import { gridLayout, jatwadaSample } from './layouts';
import { demoAuthKey, supabase } from './supabase';

async function fnError(error: unknown, fallback: string) {
  try { return (await (error as { context?: Response }).context?.json())?.error ?? fallback; } catch { return fallback; }
}

// The browser's own key for its demo company, so a new tab or a second visit reopens the same
// company instead of starting another one.
const RESUME = 'plotskart-demo-resume';
function resumeKey() {
  try {
    let k = localStorage.getItem(RESUME);
    if (!k) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(36).padStart(2, '0')).join('');
      localStorage.setItem(RESUME, k);
    }
    return k;
  } catch { return undefined; /* private mode: a new demo each time */ }
}

async function signInWith(tokenHash: string) {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error) throw new Error('This demo link has expired. Start a new demo.');
}

/** Signs this tab in to the demo: with a hand-over token from another tab, or a brand-new demo company. */
export async function startDemo() {
  const params = new URLSearchParams(location.search);
  const handover = params.get('th');
  if (handover) {
    params.delete('th');
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
    return signInWith(handover);
  }
  const { data, error } = await supabase.functions.invoke('demo-start', { body: { resume: resumeKey() } });
  if (error) throw new Error(await fnError(error, 'Could not start the demo. Please try again.'));
  await signInWith((data as { token_hash: string }).token_hash);
}

/** Adds the two sample projects with sales history to a new demo company (owner only, once). */
export async function seedDemo() {
  const jat = jatwadaSample();
  const grid = gridLayout({ blocks: 4, rowsPerBlock: 5, frontFt: 30, depthFt: 45, mainRoadM: 9, sideRoadM: 7.2 });
  const projects = [
    { name: 'Jatwada Greens', location: 'Mauje Jatwada, Chh. Sambhajinagar, Maharashtra', lat: 19.953, lng: 75.287, approval: 'NA order + Gram Panchayat layout approval', launched: 'Jan 2025', guideline_rate: 1150, sale_rate: 1850, built: jat },
    { name: 'Harsul Heights', location: 'Harsul–Sawangi Road, Chh. Sambhajinagar, Maharashtra', lat: 19.938, lng: 75.353, approval: 'Town planning sanction (TP/2025/118)', launched: 'Jun 2025', guideline_rate: 900, sale_rate: 1450, built: grid },
  ];
  for (const p of projects) {
    const { built, ...details } = p;
    const { data: id, error } = await supabase.rpc('create_project', { p: { ...details, layout: built.layout }, p_plots: built.plots });
    if (error) throw new Error(error.message);
    const { error: fillErr } = await supabase.rpc('demo_fill', { p_project: id });
    if (fillErr) throw new Error(fillErr.message);
  }
  // an apartment project too: two towers, four flats a floor
  const flat = (suffix: string, type: string, facing: string, parking: number, plc = 0) => ({ suffix, type, facing: [facing], parking, plc_paise: plc * 100 });
  const { data: aptId, error: aptErr } = await supabase.rpc('create_apartment_project', {
    p: { name: 'Skyline Residency', location: 'Avinashi Road, Coimbatore, Tamil Nadu', lat: 11.03, lng: 77.03, approval: 'DTCP building approval',
      rera_no: 'TN/11/Building/0456/2026', launched: 'Mar 2026', guideline_rate: 4200, sale_rate: 6400,
      floor_rise_paise: 2500, floor_rise_from: 1, parking_paise: 30000000, gst_bp: 500 },
    p_types: [{ key: 'A', name: '2 BHK', bedrooms: 2, carpet_sqft: 860, builtup_sqft: 1010, saleable_sqft: 1215 },
              { key: 'B', name: '3 BHK', bedrooms: 3, carpet_sqft: 1180, builtup_sqft: 1390, saleable_sqft: 1660 }],
    p_towers: [
      { name: 'A', floors: 12, first_floor: 1, stack: [flat('01', 'B', 'E', 2, 200000), flat('02', 'A', 'E', 1), flat('03', 'A', 'W', 1), flat('04', 'B', 'N', 2, 150000)] },
      { name: 'B', floors: 8, first_floor: 1, stack: [flat('01', 'A', 'N', 1), flat('02', 'A', 'S', 1), flat('03', 'B', 'E', 2, 150000), flat('04', 'A', 'W', 1)] },
    ],
  });
  if (aptErr) throw new Error(aptErr.message);
  const { error: aptFill } = await supabase.rpc('demo_fill', { p_project: aptId });
  if (aptFill) throw new Error(aptFill.message);
}

/** A one-time token that signs another tab (or this one) in as `memberId` of the same demo company. */
export async function demoTokenFor(memberId: string) {
  const { data, error } = await supabase.functions.invoke('demo-switch', { body: { member: memberId } });
  if (error) throw new Error(await fnError(error, 'Could not switch person.'));
  return (data as { token_hash: string }).token_hash;
}

export async function switchDemoPerson(memberId: string) {
  await signInWith(await demoTokenFor(memberId));
}

export function exitDemo() {
  try { sessionStorage.clear(); } catch { /* private mode */ }
  location.href = 'https://plotskart.in';
}

export function restartDemo() {
  try { sessionStorage.removeItem(demoAuthKey); localStorage.removeItem(RESUME); } catch { /* private mode */ }
  location.href = `${location.pathname}?demo`;
}
