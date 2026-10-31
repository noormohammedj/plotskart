import type { Plot, Project, Tower } from '../lib/types';

/** A small picture of the project on its card: the layout with every plot in its colour,
    or each tower drawn as its floors of flats. Decorative; the counts below carry the facts. */
export function ProjectPreview({ project, plots, towers }: { project: Project; plots: Plot[]; towers: Tower[] }) {
  if (project.kind === 'apartments') return <TowerPreview towers={towers} flats={plots} />;
  const L = project.layout;
  if (!L?.w) return <div className="pv pv-empty" aria-hidden="true" />;
  return (
    <svg className="pv" viewBox={`0 0 ${L.w} ${L.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {L.roads.map((r, i) => <rect key={i} className="pv-road" x={r.x} y={r.y} width={r.w} height={r.h} />)}
      {(L.diag ?? []).map((d, i) => <line key={i} className="pv-roadl" x1={d[0]} y1={d[1]} x2={d[2]} y2={d[3]} strokeWidth={d[4]} />)}
      {L.parks.map((o, i) => <polygon key={i} className="pv-park" points={o.pts} />)}
      {plots.map((p) => p.geom.pts
        ? <polygon key={p.id} className={`pv-p st-${p.status}`} points={p.geom.pts} />
        : <rect key={p.id} className={`pv-p st-${p.status}`} x={p.geom.x} y={p.geom.y} width={p.geom.w} height={p.geom.h} />)}
    </svg>
  );
}

function TowerPreview({ towers, flats }: { towers: Tower[]; flats: Plot[] }) {
  const cols = towers.map((t) => {
    const mine = flats.filter((f) => f.tower_id === t.id);
    const floors = [...new Set(mine.map((f) => f.floor ?? 0))].sort((a, b) => b - a);
    const rows = floors.map((fl) => mine.filter((f) => (f.floor ?? 0) === fl).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
    return { id: t.id, rows, per: Math.max(1, ...rows.map((r) => r.length)) };
  });
  const CW = 10, CH = 6, G = 1.6, GAP = 14;
  const tall = Math.max(1, ...cols.map((c) => c.rows.length));
  const W = cols.reduce((s, c) => s + c.per * (CW + G), 0) + GAP * Math.max(0, cols.length - 1);
  const H = tall * (CH + G);
  let x = 0;
  return (
    <svg className="pv pv-towers" viewBox={`-6 -6 ${W + 12} ${H + 10}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      {cols.map((c) => {
        const x0 = x;
        x += c.per * (CW + G) + GAP;
        const y0 = H - c.rows.length * (CH + G);
        return c.rows.map((row, r) => row.map((f, i) => (
          <rect key={f.id} className={`pv-p st-${f.status}`} x={x0 + i * (CW + G)} y={y0 + r * (CH + G)} width={CW} height={CH} rx="1" />
        )));
      })}
    </svg>
  );
}
