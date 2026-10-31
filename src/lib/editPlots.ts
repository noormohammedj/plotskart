import type { Dir, Layout, NewPlot, Plot, Status } from './types';
import { supabase } from './supabase';

/** A plot while the owner is editing a layout. Coordinates are in the layout's drawing units. */
export type EditPlot = {
  key: string;
  id?: string;
  label: string;
  x: number; y: number; w: number; h: number;
  pts?: string | null;
  front_ft: number;
  depth_ft: number;
  sqft: number;
  facing: Dir[];
  status: Status;
  /** where the size came from: written on the drawing, worked out from the scale, or typed in */
  dimSource: 'read' | 'scale' | 'manual';
};

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

const isEW = (p: { facing: Dir[] }) => p.facing[0] === 'E' || p.facing[0] === 'W';
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Feet per drawing unit for a plot whose size is known, along each axis. */
function unitScale(p: EditPlot) {
  const fx = isEW(p) ? p.depth_ft : p.front_ft; // feet across (x)
  const fy = isEW(p) ? p.front_ft : p.depth_ft; // feet down (y)
  return p.w > 0 && p.h > 0 && fx > 0 && fy > 0 ? (fx / p.w + fy / p.h) / 2 : null;
}

/** Best guess of feet per drawing unit, from plots whose sizes were read or typed in. */
export function estimateScale(plots: EditPlot[]): number | null {
  const s = plots.filter((p) => p.dimSource !== 'scale').map(unitScale).filter((v): v is number => !!v).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

/** Fills in sizes for plots that have no written dimensions, from the drawing scale. */
export function applyScale(p: EditPlot, ftPerUnit: number | null): EditPlot {
  if (p.dimSource !== 'scale' || !ftPerUnit) return p;
  const fx = r1(p.w * ftPerUnit), fy = r1(p.h * ftPerUnit);
  const front = isEW(p) ? fy : fx, depth = isEW(p) ? fx : fy;
  return { ...p, front_ft: front, depth_ft: depth, sqft: Math.round(front * depth) };
}

export const fromPlot = (p: Plot): EditPlot => ({
  key: p.id, id: p.id, label: p.label, x: p.geom.x, y: p.geom.y, w: p.geom.w, h: p.geom.h, pts: p.geom.pts ?? null,
  front_ft: Number(p.front_ft), depth_ft: Number(p.depth_ft), sqft: Number(p.sqft), facing: p.facing, status: p.status, dimSource: 'manual',
});

export const fromNew = (p: NewPlot): EditPlot => ({
  key: newKey(), label: p.label, x: p.geom.x, y: p.geom.y, w: p.geom.w, h: p.geom.h, pts: p.geom.pts ?? null,
  front_ft: p.front_ft, depth_ft: p.depth_ft, sqft: p.sqft, facing: p.facing, status: 'available', dimSource: 'manual',
});

export const toSave = (p: EditPlot) => ({
  ...(p.id ? { id: p.id } : {}),
  label: p.label.trim(),
  geom: { x: r1(p.x), y: r1(p.y), w: r1(p.w), h: r1(p.h), pts: p.pts ?? null },
  front_ft: p.front_ft, depth_ft: p.depth_ft, sqft: p.sqft, facing: p.facing,
});

/** Next free plot number after `after` (A12 -> A13), or P1, P2... */
export function nextLabel(plots: EditPlot[], after?: string) {
  const used = new Set(plots.map((p) => p.label.toLowerCase()));
  const m = after?.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1] : 'P';
  let n = m ? Number(m[2]) + 1 : 1;
  while (used.has(`${prefix}${n}`.toLowerCase())) n++;
  return `${prefix}${n}`;
}

export function problems(plots: EditPlot[]) {
  const seen = new Map<string, number>();
  plots.forEach((p) => seen.set(p.label.trim().toLowerCase(), (seen.get(p.label.trim().toLowerCase()) ?? 0) + 1));
  const dup = [...seen].filter(([l, n]) => n > 1 && l).map(([l]) => l.toUpperCase());
  const noSize = plots.filter((p) => !(p.sqft > 0)).map((p) => p.label);
  const noLabel = plots.filter((p) => !p.label.trim()).length;
  return { dup, noSize, noLabel, ok: !dup.length && !noSize.length && !noLabel };
}

type Draft = {
  project_name: string | null;
  location: string | null;
  north: string;
  warnings: string[];
  plots: { label: string; x: number; y: number; w: number; h: number; front_ft: number | null; depth_ft: number | null; area_sqft: number | null; facing: Dir | null; corner_facing: Dir | null }[];
};

/** Sends an uploaded layout picture to the AI reader and converts its answer into editable plots. */
export async function readLayout(path: string, imgW: number, imgH: number) {
  const { data, error } = await supabase.functions.invoke('read-layout', { body: { path } });
  if (error) {
    // the function answers with a readable message in the JSON body
    let msg = 'Could not read this layout automatically.';
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const draft = (data as { draft: Draft }).draft;
  const plots: EditPlot[] = draft.plots.map((p) => {
    const facing: Dir[] = [p.facing ?? 'E'];
    if (p.corner_facing && p.corner_facing !== facing[0]) facing.push(p.corner_facing);
    const front = p.front_ft ?? 0, depth = p.depth_ft ?? 0;
    const sqft = p.area_sqft ?? (front && depth ? Math.round(front * depth) : 0);
    return {
      key: newKey(), label: p.label,
      x: (p.x / 1000) * imgW, y: (p.y / 1000) * imgH, w: (p.w / 1000) * imgW, h: (p.h / 1000) * imgH,
      front_ft: front, depth_ft: depth, sqft, facing, status: 'available',
      dimSource: front && depth ? 'read' : 'scale',
    };
  });
  return { plots, warnings: draft.warnings ?? [], projectName: draft.project_name, location: draft.location, north: draft.north };
}

export const imageLayout = (path: string, w: number, h: number): Layout => ({
  w, h, roads: [], diag: [], parks: [], labels: [], image: { path, w, h },
});

export const blankLayout = (): Layout => ({ w: 1200, h: 800, roads: [], diag: [], parks: [], labels: [], compass: [1170, 30] });
