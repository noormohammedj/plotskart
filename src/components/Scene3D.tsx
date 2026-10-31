import { useEffect, useRef, useState } from 'react';
import { LBL } from '../lib/format';
import { useLayoutImageUrl } from '../lib/layoutImage';
import type { SceneHandle } from '../lib/scene3d';
import type { Plot, Project, Status, Tower } from '../lib/types';

type Props = {
  project: Project;
  plots: Plot[];
  towers: Tower[];
  filter: Status | 'all';
  selected: string | null;
  onPick: (id: string) => void;
};

const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

/** The project in 3D: plots on the layout, or towers built from their flats. Three.js loads only when opened. */
export function Scene3D({ project, plots, towers, filter, selected, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const apt = project.kind === 'apartments';
  const imageUrl = useLayoutImageUrl(project.layout?.image?.path);
  // rebuild only when the shape of the project changes, not on every status update
  const shapeKey = `${project.id}|${plots.map((p) => p.id).join(',')}|${towers.map((t) => t.id).join(',')}|${imageUrl ?? ''}`;
  const byId = new Map(plots.map((p) => [p.id, p]));

  useEffect(() => {
    let gone = false;
    const el = box.current;
    if (!el) return;
    setReady(false);
    import('../lib/scene3d').then((m) => {
      if (gone) return;
      const opts = { onPick: (id: string) => pickRef.current(id), onHover: (id: string | null, x: number, y: number) => setTip(id ? { id, x, y } : null), dark: isDark() };
      try {
        scene.current = apt
          ? m.towerScene(el, towers.map((t) => ({ id: t.id, name: t.name })), plots.map((p) => ({ id: p.id, label: p.label, status: p.status, tower: p.tower_id ?? '', floor: p.floor ?? 0 })), opts)
          : m.plotScene(el, project.layout, plots.map((p) => ({ id: p.id, label: p.label, status: p.status, geom: p.geom })), imageUrl, opts);
        scene.current.setFilter(filter);
        scene.current.setSelected(selected);
        setReady(true);
      } catch {
        setFailed(true); // no WebGL on this device
      }
    }).catch(() => setFailed(true));
    return () => { gone = true; scene.current?.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey]);

  const statusKey = plots.map((p) => p.status).join('');
  useEffect(() => { scene.current?.setStatuses(plots.map((p) => ({ id: p.id, label: p.label, status: p.status }))); }, [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scene.current?.setFilter(filter); }, [filter]);
  useEffect(() => { scene.current?.setSelected(selected); }, [selected]);

  if (!apt && !project.layout?.w) return <p className="empty">This project has no layout drawing yet.</p>;
  if (failed) return <p className="empty">3D view needs WebGL, which this device or browser has switched off. The 2D view shows the same {apt ? 'flats' : 'plots'}.</p>;
  const tp = tip ? byId.get(tip.id) : null;
  return (
    <div className={`scene3d${ready ? ' on' : ''}`}>
      <div ref={box} className="scene3d-c" role="img" aria-label={`${project.name} in 3D. Use the list or 2D view to pick a ${apt ? 'flat' : 'plot'} with the keyboard.`} />
      {tp && tip && (
        <div className="scene3d-tip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 14}px)` }}>
          <b>{apt ? 'Flat' : 'Plot'} {tp.label}</b><span><i className={`sw s-${tp.status}`} />{LBL[tp.status]} · {Number(tp.sqft).toLocaleString('en-IN')} ft²</span>
        </div>
      )}
      <button className="btn sm scene3d-reset" onClick={() => scene.current?.resetView()}>Reset view</button>
      <p className="scene3d-help">Drag to turn · pinch or scroll to zoom · right-drag to move</p>
    </div>
  );
}
