import { useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { DIR, LBL, SQFT_PER_CENT } from '../lib/format';
import { applyScale, estimateScale, newKey, nextLabel, problems, type EditPlot } from '../lib/editPlots';
import type { Dir, Layout } from '../lib/types';
import { FitIcon } from './ui';

type Props = {
  layout: Layout;
  imageUrl: string | null;
  plots: EditPlot[];
  onChange: (plots: EditPlot[]) => void;
  notes?: string[];
};

type Drag = { key: string; mode: 'move' | 'resize'; sx: number; sy: number; orig: EditPlot };

const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const shiftPts = (pts: string, dx: number, dy: number) =>
  pts.split(' ').map((s) => { const [x, y] = s.split(',').map(Number); return `${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`; }).join(' ');

export function LayoutEditor({ layout, imageUrl, plots, onChange, notes = [] }: Props) {
  const L = layout;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [zoom, setZoom] = useState(() => (window.innerWidth < 700 ? 2.2 : 1));
  const [scale, setScaleState] = useState<number | null>(() => estimateScale(plots));

  const selected = plots.find((p) => p.key === sel) ?? null;
  const unit = Math.max(L.w, L.h) / 120; // handle and stroke sizes scale with the drawing
  const issues = useMemo(() => problems(plots), [plots]);
  const totalSqft = plots.reduce((a, p) => a + (p.sqft || 0), 0);

  const commit = (next: EditPlot[]) => onChange(next);
  const patch = (key: string, change: Partial<EditPlot>) =>
    commit(plots.map((p) => (p.key === key ? applyScale({ ...p, ...change }, scale) : p)));

  const setScale = (s: number | null) => {
    setScaleState(s);
    commit(plots.map((p) => applyScale(p, s)));
  };

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(el.getScreenCTM()!.inverse());
  };

  const startDrag = (e: RPointerEvent, p: EditPlot, mode: Drag['mode']) => {
    e.stopPropagation();
    if (adding) return;
    if (sel !== p.key) { setSel(p.key); return; } // first tap selects, so the map still scrolls
    const pt = toSvg(e);
    drag.current = { key: p.key, mode, sx: pt.x, sy: pt.y, orig: p };
    svg.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const pt = toSvg(e);
    const dx = pt.x - d.sx, dy = pt.y - d.sy;
    if (d.mode === 'move') {
      const x = Math.max(0, Math.min(L.w - d.orig.w, d.orig.x + dx));
      const y = Math.max(0, Math.min(L.h - d.orig.h, d.orig.y + dy));
      patch(d.key, { x, y, pts: d.orig.pts ? shiftPts(d.orig.pts, x - d.orig.x, y - d.orig.y) : null });
    } else {
      const min = unit * 1.5;
      patch(d.key, { w: Math.max(min, Math.min(L.w - d.orig.x, d.orig.w + dx)), h: Math.max(min, Math.min(L.h - d.orig.y, d.orig.h + dy)), pts: null });
    }
  };

  // the click that follows a drag lands on the svg (pointer capture); ignore it
  const dragEndedAt = useRef(0);
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    dragEndedAt.current = Date.now();
  };

  const typical = () => {
    if (selected) return { w: selected.w, h: selected.h, facing: selected.facing };
    const ws = plots.map((p) => p.w).sort((a, b) => a - b), hs = plots.map((p) => p.h).sort((a, b) => a - b);
    const mid = (a: number[], fb: number) => (a.length ? a[Math.floor(a.length / 2)] : fb);
    return { w: mid(ws, L.w / 14), h: mid(hs, L.h / 12), facing: ['E'] as Dir[] };
  };

  const addAt = (x: number, y: number) => {
    const t = typical();
    const w = Math.min(t.w, L.w), h = Math.min(t.h, L.h);
    const p: EditPlot = applyScale({
      key: newKey(), label: nextLabel(plots, selected?.label ?? plots[plots.length - 1]?.label),
      x: Math.max(0, Math.min(L.w - w, x - w / 2)), y: Math.max(0, Math.min(L.h - h, y - h / 2)), w, h, pts: null,
      front_ft: selected?.front_ft ?? 0, depth_ft: selected?.depth_ft ?? 0, sqft: selected?.sqft ?? 0,
      facing: [...t.facing], status: 'available', dimSource: selected && selected.sqft > 0 ? 'manual' : 'scale',
    }, scale);
    commit([...plots, p]);
    setSel(p.key);
  };

  const onBackground = (e: RMouseEvent<SVGElement>) => {
    if (drag.current || Date.now() - dragEndedAt.current < 300) return;
    if (adding) { const pt = toSvg(e); addAt(pt.x, pt.y); return; }
    setSel(null);
  };

  const remove = (p: EditPlot) => {
    commit(plots.filter((x) => x.key !== p.key));
    setSel(null);
  };

  const setDims = (p: EditPlot, front: number, depth: number) =>
    patch(p.key, { front_ft: front, depth_ft: depth, sqft: Math.round(front * depth), dimSource: front > 0 && depth > 0 ? 'manual' : 'scale' });

  const setFacing = (p: EditPlot, main: Dir, corner: Dir | '') =>
    patch(p.key, { facing: corner && corner !== main ? [main, corner] : [main] });

  const useAsScale = (p: EditPlot) => {
    const fx = p.facing[0] === 'E' || p.facing[0] === 'W' ? p.depth_ft : p.front_ft;
    const fy = p.facing[0] === 'E' || p.facing[0] === 'W' ? p.front_ft : p.depth_ft;
    if (!(fx > 0 && fy > 0)) return;
    setScale((fx / p.w + fy / p.h) / 2);
  };

  const fs = (p: EditPlot) => Math.max(unit * 0.9, Math.min(unit * 2.2, Math.min(p.w, p.h) * 0.34));

  return (
    <div className="ed">
      <div className="maptools">
        <div className="btns">
          <button type="button" className={`btn ${adding ? 'pri' : ''}`} onClick={() => setAdding((a) => !a)} aria-pressed={adding}>
            {adding ? 'Done adding' : '+ Add plot'}
          </button>
          {adding && <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>Tap the drawing where each new plot goes.</span>}
        </div>
        <div className="zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.6))} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Fit to width"><FitIcon /></button>
          <button type="button" onClick={() => setZoom((z) => Math.min(6, z + 0.6))} aria-label="Zoom in">+</button>
        </div>
      </div>

      <div className="ed-grid">
        <div className="mapwrap ed-canvas">
          <svg ref={svg} className={`map${adding ? ' adding' : ''}`} viewBox={`0 0 ${L.w} ${L.h}`} style={{ width: `${zoom * 100}%` }}
            onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={onBackground}
            role="application" aria-label="Layout editor. Tap a plot to select it, then drag to move it.">
            {imageUrl
              ? <image href={imageUrl} x="0" y="0" width={L.w} height={L.h} preserveAspectRatio="none" />
              : <>
                <rect className="m-land" x="0" y="0" width={L.w} height={L.h} />
                {L.roads.map((r, i) => <rect key={i} className="m-road" x={r.x} y={r.y} width={r.w} height={r.h} />)}
                {(L.diag ?? []).map((d, i) => <line key={i} className="m-roadl" x1={d[0]} y1={d[1]} x2={d[2]} y2={d[3]} strokeWidth={d[4]} />)}
                {L.parks.map((o, i) => <polygon key={i} className="m-park" points={o.pts} />)}
              </>}
            {/* the selected plot is drawn last so it and its resize handle sit on top */}
            {[...plots.filter((p) => p.key !== sel), ...plots.filter((p) => p.key === sel)].map((p) => {
              const on = p.key === sel;
              return (
                <g key={p.key} className={`ed-plot st-${p.status}${on ? ' sel' : ''}${issues.dup.includes(p.label.trim().toUpperCase()) ? ' bad' : ''}`}
                  onPointerDown={(e) => startDrag(e, p, 'move')} onClick={(e) => e.stopPropagation()}>
                  {p.pts ? <polygon className="sh" points={p.pts} /> : <rect className="sh" x={p.x} y={p.y} width={p.w} height={p.h} />}
                  <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={fs(p)}>{p.label}</text>
                  {on && !adding && (
                    <circle className="ed-handle" cx={p.x + p.w} cy={p.y + p.h} r={unit * 1.1}
                      onPointerDown={(e) => startDrag(e, p, 'resize')} />
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="ed-panel card">
          {selected ? (
            <PlotForm key={selected.key} p={selected}
              onLabel={(label) => patch(selected.key, { label })}
              onDims={(f, d) => setDims(selected, f, d)}
              onArea={(a) => patch(selected.key, { sqft: a, dimSource: 'manual' })}
              onFacing={(m, c) => setFacing(selected, m, c)}
              onScale={() => useAsScale(selected)}
              onDelete={() => remove(selected)}
              onClose={() => setSel(null)} />
          ) : (
            <div className="sec">
              <h3>{plots.length} plots · {Math.round(totalSqft).toLocaleString('en-IN')} sq ft</h3>
              <p className="muted">Tap a plot to change its number, size or facing. Tap it again and drag to move it, or drag the round handle to resize it.</p>
              <div className="dl">
                <div className="wide"><span className="lbl">Drawing scale</span>
                  <b>{scale ? `1 unit ≈ ${scale.toFixed(3)} ft` : 'Not set'}</b>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                {scale
                  ? 'Plots without written sizes get their size from this scale.'
                  : 'To size plots that have no written dimensions: select a plot, type its real frontage and depth, then tap "Use as drawing scale".'}
              </p>
              {(issues.dup.length > 0 || issues.noSize.length > 0 || issues.noLabel > 0 || notes.length > 0) && (
                <div className="ed-notes">
                  {issues.dup.length > 0 && <p className="neg">Same number used twice: {issues.dup.join(', ')}</p>}
                  {issues.noLabel > 0 && <p className="neg">{issues.noLabel} plot(s) have no number</p>}
                  {issues.noSize.length > 0 && <p className="neg">No size yet: {issues.noSize.slice(0, 12).join(', ')}{issues.noSize.length > 12 ? ` and ${issues.noSize.length - 12} more` : ''}</p>}
                  {notes.map((n, i) => <p key={i} className="muted">• {n}</p>)}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlotForm({ p, onLabel, onDims, onArea, onFacing, onScale, onDelete, onClose }: {
  p: EditPlot;
  onLabel: (l: string) => void;
  onDims: (front: number, depth: number) => void;
  onArea: (a: number) => void;
  onFacing: (main: Dir, corner: Dir | '') => void;
  onScale: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const sold = p.status !== 'available';
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <div className="sec">
      <div className="card-h" style={{ margin: 0 }}>
        <h3>Plot {p.label || '(no number)'}</h3>
        <button type="button" className="linkbtn" onClick={onClose}>Done</button>
      </div>
      {sold && <p className="hint" style={{ marginTop: 0 }}>{LBL[p.status]} plot. You can fix its position and size, but it cannot be deleted.</p>}
      <form className="f" onSubmit={(e) => e.preventDefault()}>
        <label className="wide">Plot number<input value={p.label} onChange={(e) => onLabel(e.target.value)} /></label>
        <label>Frontage (ft)<input type="number" min="0" step="0.5" value={p.front_ft || ''} onChange={(e) => onDims(num(e.target.value), p.depth_ft)} /></label>
        <label>Depth (ft)<input type="number" min="0" step="0.5" value={p.depth_ft || ''} onChange={(e) => onDims(p.front_ft, num(e.target.value))} /></label>
        <label>Area (sq ft)<input type="number" min="0" value={p.sqft || ''} onChange={(e) => onArea(num(e.target.value))} /></label>
        <label>In cents<input readOnly value={p.sqft ? (p.sqft / SQFT_PER_CENT).toFixed(2) : ''} /></label>
        <label>Facing (road side)
          <select value={p.facing[0]} onChange={(e) => onFacing(e.target.value as Dir, p.facing[1] ?? '')}>
            {DIRS.map((d) => <option key={d} value={d}>{DIR[d]}</option>)}
          </select>
        </label>
        <label>Corner plot, second road
          <select value={p.facing[1] ?? ''} onChange={(e) => onFacing(p.facing[0], e.target.value as Dir | '')}>
            <option value="">Not a corner plot</option>
            {DIRS.filter((d) => d !== p.facing[0]).map((d) => <option key={d} value={d}>{DIR[d]}</option>)}
          </select>
        </label>
        <p className="wide hint" style={{ margin: 0 }}>
          {p.dimSource === 'read' ? 'Size read from the drawing.' : p.dimSource === 'scale' ? 'Size worked out from the drawing scale.' : 'Size entered by hand.'}
        </p>
        <div className="wide btns">
          <button type="button" className="btn sm" onClick={onScale} disabled={!(p.front_ft > 0 && p.depth_ft > 0)}>Use as drawing scale</button>
          <button type="button" className="btn sm ghost danger" onClick={onDelete} disabled={sold}>Delete plot</button>
        </div>
      </form>
    </div>
  );
}
