import { useEffect, useRef } from 'react';
import { LBL } from '../lib/format';
import { useLayoutImageUrl } from '../lib/layoutImage';
import type { Plot, Project, Status } from '../lib/types';

type Props = {
  project: Project;
  plots: Plot[];
  filter: Status | 'all';
  zoom: number;
  query: string;
  selected: string | null;
  onPick: (id: string) => void;
};

export function PlotMap({ project, plots, filter, zoom, query, selected, onPick }: Props) {
  const L = project.layout;
  const wrap = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const imageUrl = useLayoutImageUrl(L?.image?.path);

  useEffect(() => {
    if (!q) return;
    wrap.current?.querySelector('.m-plot.hit')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }, [q]);

  if (!L?.w) return <p className="empty">This project has no layout drawing yet.</p>;
  const unit = Math.max(L.w, L.h) / 1280; // keeps labels readable on large photo layouts

  return (
    <div className="mapwrap" ref={wrap}>
      <svg className={`map${L.image ? ' on-photo' : ''}`} viewBox={`0 0 ${L.w} ${L.h}`} style={{ width: `${zoom * 100}%` }} role="img" aria-label={`Plot layout of ${project.name}`}>
        <rect className="m-land" x="0" y="0" width={L.w} height={L.h} />
        {L.image && imageUrl && <image href={imageUrl} x="0" y="0" width={L.w} height={L.h} preserveAspectRatio="none" />}
        {L.roads.map((r, i) => <rect key={i} className="m-road" x={r.x} y={r.y} width={r.w} height={r.h} />)}
        {(L.diag ?? []).map((d, i) => <line key={i} className="m-roadl" x1={d[0]} y1={d[1]} x2={d[2]} y2={d[3]} strokeWidth={d[4]} />)}
        {L.parks.map((o, i) => (
          <g key={i}>
            <polygon className="m-park" points={o.pts} />
            {o.t.map((t, j) => <text key={j} className="m-park-t" x={o.cx} y={o.cy + (j - (o.t.length - 1) / 2) * 13}>{t}</text>)}
            {o.dp && <><rect className="m-dp" x={o.dp[0] - 11} y={o.dp[1] - 9} width="22" height="18" rx="2" /><text className="m-dp-t" x={o.dp[0]} y={o.dp[1]}>DP</text></>}
          </g>
        ))}
        {plots.map((p) => {
          const g = p.geom;
          const fs = Math.max(8 * unit, Math.min(16 * unit, Math.min(g.w, g.h) * 0.34));
          const cls = ['m-plot', `st-${p.status}`];
          if (filter !== 'all' && p.status !== filter) cls.push('dim');
          if (selected === p.id) cls.push('sel');
          if (q && p.label.toLowerCase() === q) cls.push('hit');
          return (
            <g key={p.id} className={cls.join(' ')} tabIndex={0} role="button"
              aria-label={`Plot ${p.label}, ${LBL[p.status]}, ${p.sqft} square feet`}
              onClick={() => onPick(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.id); } }}>
              {g.pts ? <polygon className="sh" points={g.pts} /> : <rect className="sh" x={g.x} y={g.y} width={g.w} height={g.h} />}
              <text x={g.pts ? g.x + g.w * 0.4 : g.x + g.w / 2} y={g.y + g.h / 2} fontSize={fs}>{p.label}</text>
            </g>
          );
        })}
        {L.labels.map((l, i) => (
          <text key={i} className="m-lbl" x={l.x} y={l.y} transform={l.r ? `rotate(${l.r} ${l.x} ${l.y})` : undefined}>{l.t}</text>
        ))}
        {L.compass && (
          <g className="m-comp" transform={`translate(${L.compass[0]} ${L.compass[1]})`}>
            <circle r="20" /><path d="M0,-15 L6,4 L0,0 L-6,4 Z" /><text y="16">N</text>
          </g>
        )}
      </svg>
    </div>
  );
}
