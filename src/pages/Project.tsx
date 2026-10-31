import { useMemo, useState, type FormEvent } from 'react';
import { UnitTypesCard } from '../components/FloorPlans';
import { PlotMap } from '../components/PlotMap';
import { Scene3D } from '../components/Scene3D';
import { StackingPlan } from '../components/StackingPlan';
import { Pill, StackBar } from '../components/ui';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { DIR, LBL, SQFT_PER_CENT, fmtD, inr, short } from '../lib/format';
import { counts, plotValue, unitWord } from '../lib/plots';
import type { Status } from '../lib/types';
import { FitIcon } from '../components/ui';

type Tab = 'layout' | 'list' | 'blocks' | 'info';

/** Block name from a plot number: "A12" -> "A", "B-4" -> "B", "17" -> "Main". */
const blockOf = (label: string) => label.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? 'Main';

export function ProjectPage({ id, tab }: { id: string; tab: Tab }) {
  const { projects, plots, towers, unitTypes, sheetPlot, openPlot, canSell, isOwner, rpc, memberName, toast } = useData();
  const pr = projects.find((p) => p.id === id);
  const mine = useMemo(() => plots.filter((p) => p.project_id === id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [plots, id]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [zoom, setZoom] = useState(() => (window.innerWidth < 700 ? 2.6 : 1));
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'2d' | '3d'>(() => { try { return localStorage.getItem('plotskart-view') === '3d' ? '3d' : '2d'; } catch { return '2d'; } });
  const pickView = (v: '2d' | '3d') => { setView(v); try { localStorage.setItem('plotskart-view', v); } catch { /* private mode */ } };

  if (!pr) return <p className="empty">Project not found.</p>;
  const c = counts(mine);
  const apt = pr.kind === 'apartments';
  const myTowers = towers.filter((t) => t.project_id === pr.id);
  const myTypes = unitTypes.filter((t) => t.project_id === pr.id);
  const typeName = (tid: string | null) => myTypes.find((t) => t.id === tid)?.name ?? '—';
  const towerName = (tid: string | null) => myTowers.find((t) => t.id === tid)?.name ?? 'Main';
  const one = unitWord(pr, 1), many = unitWord(pr);
  const One = one[0].toUpperCase() + one.slice(1);

  const chip = (k: Status | 'all', label: string) => (
    <button key={k} className={`chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
      {k !== 'all' && <i className={`sw s-${k}`} />}{label} <span className="n">{k === 'all' ? c.total : c[k]}</span>
    </button>
  );
  const chips = <div className="chips">{chip('all', 'All')}{chip('available', 'Available')}{chip('booked', 'Booked')}{chip('sold', 'Sold')}</div>;

  const saveRates = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await rpc('set_project_rates', { p_project: pr.id, p_guideline: +d.guideline, p_sale: +d.rate }, 'Rates updated for the whole team');
  };

  let body;
  if (tab === 'layout') {
    body = (
      <>
        <div className="maptools">
          {chips}
          <div className="tools-r">
            <div className="seg sm" role="group" aria-label="View">
              <button className={view === '2d' ? 'on' : ''} aria-pressed={view === '2d'} onClick={() => pickView('2d')}>{apt ? 'Floors' : '2D'}</button>
              <button className={view === '3d' ? 'on' : ''} aria-pressed={view === '3d'} onClick={() => pickView('3d')}>3D</button>
            </div>
            <input type="search" placeholder={apt ? 'Flat, e.g. A-101' : 'Find plot, e.g. B7'} aria-label={`Find ${one}`} value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const hit = mine.find((p) => p.label.toLowerCase() === query.trim().toLowerCase());
                if (hit) openPlot(hit.id); else toast(`No ${one} ${query} in this project`);
              }} />
            {!apt && view === '2d' && <div className="zoom">
              <button onClick={() => setZoom((z) => Math.max(1, z - 0.6))} aria-label="Zoom out">−</button>
              <button onClick={() => setZoom(1)} aria-label="Fit to width"><FitIcon /></button>
              <button onClick={() => setZoom((z) => Math.min(5, z + 0.6))} aria-label="Zoom in">+</button>
            </div>}
            {isOwner && !apt && <button className="btn sm" onClick={() => go(`/p/${id}/edit`)}>Edit layout</button>}
          </div>
        </div>
        {view === '3d'
          ? <Scene3D project={pr} plots={mine} towers={myTowers} filter={filter} selected={sheetPlot} onPick={openPlot} />
          : apt
          ? <StackingPlan towers={myTowers} flats={mine} types={myTypes} filter={filter} query={query} selected={sheetPlot} onPick={openPlot} />
          : <PlotMap project={pr} plots={mine} filter={filter} zoom={zoom} query={query} selected={sheetPlot} onPick={openPlot} />}
        <p className="hint">{apt
          ? 'Each tower is shown top floor first. Tap a flat for its type, areas, floor plan and price. Red is available, yellow is booked, green is sold.'
          : 'Tap a plot for its size, facing, vastu notes and price. Red is available, yellow is booked, green is sold.'} Changes appear for the whole team instantly.</p>
      </>
    );
  } else if (tab === 'list') {
    const rows = mine.filter((p) => filter === 'all' || p.status === filter);
    body = (
      <>
        {chips}
        <div className="tbl-wrap">
          <table>
            <thead>{apt
              ? <tr><th>Flat</th><th>Status</th><th>Type</th><th className="r">Floor</th><th className="r">Saleable ft²</th><th>Facing</th><th className="r">Price</th><th>Buyer</th><th>By</th></tr>
              : <tr><th>Plot</th><th>Status</th><th className="r">Sq ft</th><th className="r">Cents</th><th>Size (ft)</th><th>Facing</th><th className="r">Price</th><th>Buyer</th><th>By</th></tr>}</thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="click" onClick={() => openPlot(p.id)}>
                  <td className="mono"><b>{p.label}</b></td>
                  <td><Pill status={p.status} /></td>
                  {apt ? <>
                    <td>{typeName(p.unit_type_id)}</td>
                    <td className="r">{p.floor === 0 ? 'G' : p.floor}</td>
                    <td className="r">{Number(p.sqft).toLocaleString('en-IN')}</td>
                  </> : <>
                    <td className="r">{Number(p.sqft).toLocaleString('en-IN')}</td>
                    <td className="r">{(p.sqft / SQFT_PER_CENT).toFixed(2)}</td>
                    <td className="mono">{p.front_ft} × {p.depth_ft}</td>
                  </>}
                  <td>{p.facing.map((f) => DIR[f]).join(' + ')}</td>
                  <td className="r">{short(plotValue(pr, p))}</td>
                  <td>{p.buyer_name ?? '—'}</td>
                  <td>{p.sold_by ? memberName(p.sold_by) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  } else if (tab === 'blocks') {
    const blocks = new Map<string, typeof mine>();
    const groupOf = (p: (typeof mine)[number]) => (apt ? towerName(p.tower_id) : blockOf(p.label));
    mine.forEach((p) => blocks.set(groupOf(p), [...(blocks.get(groupOf(p)) ?? []), p]));
    const rows = [...blocks].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([name, ps]) => {
      const bc = counts(ps);
      const sold = ps.filter((p) => p.status !== 'available');
      return { name, ps, bc, sqft: ps.reduce((s, p) => s + Number(p.sqft), 0), value: ps.reduce((s, p) => s + plotValue(pr, p), 0),
        collected: sold.reduce((s, p) => s + Number(p.paid), 0), due: sold.reduce((s, p) => s + Math.max(0, plotValue(pr, p) - p.paid), 0) };
    });
    body = (
      <div className="blocks">
        {rows.map((r) => (
          <article key={r.name} className="card block-card">
            <div className="card-h" style={{ marginBottom: 8 }}><h2>{apt ? 'Tower' : 'Block'} {r.name}</h2><span className="mono muted">{r.bc.total} {many} · {r.sqft.toLocaleString('en-IN')} ft²</span></div>
            <StackBar c={r.bc} />
            <div className="cnts" style={{ marginTop: 10 }}>
              <div><b>{r.bc.sold}</b><span><i className="sw s-sold" />Sold</span></div>
              <div><b>{r.bc.booked}</b><span><i className="sw s-booked" />Booked</span></div>
              <div><b>{r.bc.available}</b><span><i className="sw s-available" />Available</span></div>
            </div>
            <div className="money">
              <div><span>{apt ? 'Tower' : 'Block'} value</span><b>{short(r.value)}</b></div>
              <div><span>Collected</span><b>{short(r.collected)}</b></div>
              <div><span>Due</span><b>{short(r.due)}</b></div>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {r.ps.filter((p) => p.status === 'available').slice(0, 12).map((p) => <button key={p.id} className="chip" onClick={() => openPlot(p.id)}>{p.label}</button>)}
              {r.bc.available > 12 && <span className="muted">+{r.bc.available - 12} more available</span>}
            </div>
          </article>
        ))}
      </div>
    );
  } else {
    const q = pr.lat != null && pr.lng != null ? `${pr.lat},${pr.lng}` : encodeURIComponent(pr.location);
    const totSq = mine.reduce((a, p) => a + Number(p.sqft), 0);
    body = (
      <div className="grid2">
        <section className="card sec">
          <h2>Location</h2>
          <p>{pr.location}</p>
          {pr.lat != null && pr.lng != null && <p className="mono muted">{pr.lat.toFixed(4)}° N, {pr.lng.toFixed(4)}° E</p>}
          <div className="btns">
            <a className="btn pri" href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener">Get directions</a>
            <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noopener">Open in Google Maps</a>
          </div>
          <div className="dl">
            <div><span className="lbl">Approval</span><b>{pr.approval || '—'}</b></div>
            <div><span className="lbl">Launched</span><b>{pr.launched || '—'}</b></div>
            <div><span className="lbl">Saleable area</span><b>{totSq.toLocaleString('en-IN')} ft²</b></div>
            {apt ? <>
              <div><span className="lbl">RERA no.</span><b>{pr.rera_no || '—'}</b></div>
              <div><span className="lbl">Towers</span><b>{myTowers.map((t) => `${t.name} (${t.floors} floors)`).join(', ') || '—'}</b></div>
            </> : <div><span className="lbl">In cents / acres</span><b>{(totSq / SQFT_PER_CENT).toFixed(1)} c · {(totSq / 43560).toFixed(2)} ac</b></div>}
            {pr.layout?.parks?.length > 0 && <div className="wide"><span className="lbl">Open spaces & utilities</span><b>{pr.layout.parks.map((o) => o.t.join(' ')).join('; ')}</b></div>}
          </div>
        </section>
        <section className="card sec">
          <h2>Pricing</h2>
          <div className="dl">
            <div><span className="lbl">Guideline value</span><b>{inr(pr.guideline_rate)} / ft²</b></div>
            <div><span className="lbl">Sale price</span><b>{inr(pr.sale_rate)} / ft²</b></div>
            {apt ? <>
              <div><span className="lbl">Floor rise</span><b>{inr(pr.floor_rise_paise / 100)} / ft² per floor above floor {pr.floor_rise_from}</b></div>
              <div><span className="lbl">Car park</span><b>{inr(pr.parking_paise / 100)} each</b></div>
              <div><span className="lbl">GST</span><b>{pr.gst_bp / 100}% on top</b></div>
            </> : <>
              <div><span className="lbl">Guideline per cent</span><b>{inr(pr.guideline_rate * SQFT_PER_CENT)}</b></div>
              <div><span className="lbl">Sale price per cent</span><b>{inr(pr.sale_rate * SQFT_PER_CENT)}</b></div>
            </>}
            <div className="wide"><span className="lbl">Last changed</span><b>{memberName(pr.rate_updated_by)} · {fmtD(pr.rate_updated_at)}</b></div>
          </div>
          {canSell ? (
            <form className="f" onSubmit={saveRates} key={`${pr.guideline_rate}-${pr.sale_rate}`}>
              <h3>Update rates</h3>
              <label>Guideline value (₹/ft²)<input name="guideline" type="number" min="0" step="10" defaultValue={pr.guideline_rate} required /></label>
              <label>Sale price (₹/ft²)<input name="rate" type="number" min="0" step="10" defaultValue={pr.sale_rate} required /></label>
              <div className="wide btns"><button className="btn pri">Save and notify team</button></div>
            </form>
          ) : <p className="muted">Only the owner and sales team can change rates.</p>}
        </section>
        {apt && <UnitTypesCard project={pr} types={myTypes} flats={mine} />}
      </div>
    );
  }

  return (
    <div className="stack-v">
      <div>
        <button className="back" onClick={() => go('/projects')}>← All projects</button>
        <div className="phead">
          <div><h1>{pr.name}</h1><p>{pr.location}</p></div>
          <div style={{ minWidth: 220, flex: '0 1 320px' }}>
            <StackBar c={c} />
            <p className="hint mono">{c.sold} {LBL.sold.toLowerCase()} · {c.booked} booked · {c.available} available</p>
          </div>
        </div>
      </div>
      <div className="seg" role="tablist">
        {([['layout', apt ? 'Towers' : 'Layout', ''], ['list', `${One} list`, '/list'], ['blocks', apt ? 'By tower' : 'Blocks', '/blocks'], ['info', apt ? 'Details, pricing & floor plans' : 'Location & pricing', '/info']] as const).map(([k, l, suffix]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(`/p/${id}${suffix}`)}>{l}</button>
        ))}
      </div>
      {body}
    </div>
  );
}
