import { useMemo, useState, type FormEvent } from 'react';
import { UnitTypesCard } from '../components/FloorPlans';
import { PlotMap } from '../components/PlotMap';
import { Scene3D } from '../components/Scene3D';
import { StackingPlan } from '../components/StackingPlan';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { DIR, SQFT_PER_CENT, fmtD, inr, short } from '../lib/format';
import { counts, plotValue, unitWord } from '../lib/plots';
import type { Plot, Status } from '../lib/types';
import { I, Ring, Seg, tap } from './kit';

type Tab = 'layout' | 'list' | 'blocks' | 'info';
const blockOf = (label: string) => label.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? 'Main';
const STATUS: [Status | 'all', string][] = [['all', 'All'], ['available', 'Open'], ['booked', 'Booked'], ['sold', 'Sold']];

/** A project on the phone: its picture (2D, 3D or floors), every plot, blocks, and location and pricing. */
export function MProjectView({ id, tab }: { id: string; tab: Tab }) {
  const { projects, plots, towers, unitTypes, sheetPlot, openPlot, isOwner, canSell, rpc, memberName, toast } = useData();
  const pr = projects.find((p) => p.id === id);
  const mine = useMemo(() => plots.filter((p) => p.project_id === id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })), [plots, id]);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(2.4);
  const [view, setView] = useState<'2d' | '3d'>(() => { try { return localStorage.getItem('plotskart-view') === '3d' ? '3d' : '2d'; } catch { return '2d'; } });
  const pickView = (v: '2d' | '3d') => { setView(v); try { localStorage.setItem('plotskart-view', v); } catch { /* private mode */ } };

  if (!pr) return <div className="m-page"><div className="m-card m-empty"><b>Project not found</b></div></div>;
  const c = counts(mine);
  const apt = pr.kind === 'apartments';
  const myTowers = towers.filter((t) => t.project_id === pr.id);
  const myTypes = unitTypes.filter((t) => t.project_id === pr.id);
  const one = unitWord(pr, 1), many = unitWord(pr);
  const taken = c.total ? (c.sold + c.booked) / c.total : 0;
  const q = query.trim().toLowerCase();
  const shown = mine.filter((p) => (filter === 'all' || p.status === filter) && (!q || p.label.toLowerCase().includes(q) || (p.buyer_name ?? '').toLowerCase().includes(q)));
  const setTab = (t: Tab) => go(`/p/${id}${t === 'layout' ? '' : `/${t}`}`);
  const find = () => {
    const hit = mine.find((p) => p.label.toLowerCase() === q);
    if (hit) openPlot(hit.id); else if (q) toast(`No ${one} ${query} in this project`);
  };

  const filters = (
    <div className="m-chips">
      {STATUS.map(([k, l]) => (
        <button key={k} className={`m-chip${filter === k ? ' on' : ''}`} onClick={() => { tap(); setFilter(k); }}>
          {k !== 'all' && <i className={`m-dot st-${k}`} />}{l}<em>{k === 'all' ? c.total : c[k]}</em>
        </button>
      ))}
    </div>
  );

  return (
    <div className="m-page m-proj-page">
      <header className="m-head">
        <button className="m-iconbtn" aria-label="All projects" onClick={() => { tap(); go('/projects'); }}><I n="back" sw={2.4} /></button>
        <div className="t"><small>{apt ? 'Apartments' : 'Plotted layout'}</small><h1 style={{ fontSize: 'clamp(1.35rem,6vw,1.7rem)' }}>{pr.name}</h1></div>
        <button className="m-iconbtn" aria-label="Show customer" onClick={() => { tap(); go(`/show/${id}`); }}><I n="chat" /></button>
      </header>
      <div className="m-stack">
        <section className="m-hero">
          <div className="m-hero-row">
            <Ring value={taken} size={92} stroke={10}><b>{Math.round(taken * 100)}%</b><span>taken</span></Ring>
            <div className="info">
              <div className="sm" style={{ marginTop: 0 }}>📍 {pr.location}</div>
              <div className="big num" style={{ fontSize: 'clamp(1.3rem,6.5vw,1.7rem)', marginTop: 6 }}>{inr(pr.sale_rate)}<span style={{ fontSize: '.9rem', opacity: .85 }}> / ft²</span></div>
              <div className="sm">{c.total} {many}{pr.approval ? ` · ${pr.approval}` : ''}</div>
            </div>
          </div>
          <div className="hchips">
            <span className="hchip"><i style={{ background: '#7CF2C5' }} />{c.sold} sold</span>
            <span className="hchip"><i style={{ background: '#FFD27A' }} />{c.booked} booked</span>
            <span className="hchip"><i />{c.available} open</span>
          </div>
        </section>

        <Seg value={tab} onChange={setTab} options={[['layout', apt ? 'Towers' : 'Layout'], ['list', 'List'], ['blocks', apt ? 'By tower' : 'Blocks'], ['info', 'Info']]} />

        {tab === 'layout' && <>
          {filters}
          <div className="m-tools">
            <Seg value={view} onChange={pickView} options={[['2d', apt ? 'Floors' : '2D map'], ['3d', '3D']]} />
            {!apt && view === '2d' && (
              <div className="m-zoom">
                <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.6))}>−</button>
                <button aria-label="Fit" onClick={() => setZoom(1)}>⤢</button>
                <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z + 0.6))}>+</button>
              </div>
            )}
          </div>
          <label className="m-field"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()}
            placeholder={apt ? 'Find a flat, e.g. A-101' : 'Find a plot, e.g. B7'} /></label>
          <div className="m-card m-proj-canvas">
            {view === '3d'
              ? <Scene3D project={pr} plots={mine} towers={myTowers} filter={filter} selected={sheetPlot} onPick={openPlot} />
              : apt
                ? <StackingPlan towers={myTowers} flats={mine} types={myTypes} filter={filter} query={query} selected={sheetPlot} onPick={openPlot} />
                : <PlotMap project={pr} plots={mine} filter={filter} zoom={zoom} query={query} selected={sheetPlot} onPick={openPlot} />}
          </div>
          <p className="m-sub m-small" style={{ margin: 0 }}>Tap a {one} for its size, facing, vastu and price. Changes show for the whole team instantly.</p>
          {isOwner && !apt && <button className="m-btn ghost" onClick={() => { tap(); go(`/p/${id}/edit`); }}>Edit layout</button>}
        </>}

        {tab === 'list' && <>
          {filters}
          <label className="m-field"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${one} or buyer`} /></label>
          <section className="m-card" style={{ paddingBlock: 4 }}>
            <div className="m-list">
              {shown.slice(0, 400).map((p) => <UnitRow key={p.id} p={p} value={plotValue(pr, p)} apt={apt} typeName={myTypes.find((t) => t.id === p.unit_type_id)?.name} by={p.sold_by ? memberName(p.sold_by) : null} onOpen={() => { tap(); openPlot(p.id); }} />)}
              {!shown.length && <p className="m-sub m-small" style={{ padding: '14px 0' }}>Nothing matches.</p>}
            </div>
          </section>
        </>}

        {tab === 'blocks' && <Blocks pr={pr} mine={mine} apt={apt} towerName={(t) => myTowers.find((x) => x.id === t)?.name ?? 'Main'} openPlot={openPlot} many={many} />}

        {tab === 'info' && <>
          <section className="m-card">
            <div className="m-cardhead"><h3>Location</h3></div>
            <p style={{ margin: '0 0 12px' }}>{pr.location}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="m-btn sm" href={`https://www.google.com/maps/dir/?api=1&destination=${pr.lat != null && pr.lng != null ? `${pr.lat},${pr.lng}` : encodeURIComponent(pr.location)}`} target="_blank" rel="noopener">Get directions</a>
              <a className="m-btn ghost sm" href={`https://www.google.com/maps/search/?api=1&query=${pr.lat != null && pr.lng != null ? `${pr.lat},${pr.lng}` : encodeURIComponent(pr.location)}`} target="_blank" rel="noopener">Open in Maps</a>
            </div>
            <KV rows={[
              ['Approval', pr.approval || '—'], ['Launched', pr.launched || '—'],
              ['Saleable area', `${mine.reduce((a, p) => a + Number(p.sqft), 0).toLocaleString('en-IN')} ft²`],
              ...(apt ? [['RERA no.', pr.rera_no || '—'], ['Towers', myTowers.map((t) => `${t.name} (${t.floors} floors)`).join(', ') || '—']] as [string, string][]
                : [['In acres', `${(mine.reduce((a, p) => a + Number(p.sqft), 0) / 43560).toFixed(2)} ac`]] as [string, string][]),
              ...(pr.layout?.parks?.length ? [['Open spaces', pr.layout.parks.map((o) => o.t.join(' ')).join('; ')]] as [string, string][] : []),
            ]} />
          </section>
          <Pricing />
          {apt && <div className="m-legacy" style={{ padding: 0 }}><UnitTypesCard project={pr} types={myTypes} flats={mine} /></div>}
        </>}
      </div>
    </div>
  );

  function Pricing() {
    const save = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      await rpc('set_project_rates', { p_project: pr!.id, p_guideline: +d.guideline, p_sale: +d.rate }, 'Rates updated for the whole team');
    };
    return (
      <section className="m-card">
        <div className="m-cardhead"><h3>Pricing</h3><span>changed {fmtD(pr!.rate_updated_at)}</span></div>
        <KV rows={[
          ['Sale price', `${inr(pr!.sale_rate)} / ft²`], ['Guideline value', `${inr(pr!.guideline_rate)} / ft²`],
          ...(apt ? [['Floor rise', `${inr(pr!.floor_rise_paise / 100)} / ft² per floor above ${pr!.floor_rise_from}`], ['Car park', `${inr(pr!.parking_paise / 100)} each`], ['GST', `${pr!.gst_bp / 100}% on top`]] as [string, string][]
            : [['Sale price per cent', inr(pr!.sale_rate * SQFT_PER_CENT)], ['Guideline per cent', inr(pr!.guideline_rate * SQFT_PER_CENT)]] as [string, string][]),
          ['Changed by', memberName(pr!.rate_updated_by)],
        ]} />
        {canSell ? (
          <form onSubmit={save} key={`${pr!.guideline_rate}-${pr!.sale_rate}`} style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="m-field">Sale ₹/ft²<input name="rate" type="number" inputMode="numeric" min="0" step="10" defaultValue={pr!.sale_rate} required /></label>
            <label className="m-field">Guideline ₹/ft²<input name="guideline" type="number" inputMode="numeric" min="0" step="10" defaultValue={pr!.guideline_rate} required /></label>
            <button className="m-btn" style={{ gridColumn: '1 / -1' }}>Save and tell the team</button>
          </form>
        ) : <p className="m-sub m-small" style={{ margin: '12px 0 0' }}>Only the owner and sales team can change rates.</p>}
      </section>
    );
  }
}

function KV({ rows }: { rows: [string, string][] }) {
  return <div className="m-kv">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>;
}

function UnitRow({ p, value, apt, typeName, by, onOpen }: { p: Plot; value: number; apt: boolean; typeName?: string; by: string | null; onOpen: () => void }) {
  const size = apt ? `${typeName ?? 'Flat'} · floor ${p.floor === 0 ? 'G' : p.floor}` : `${Number(p.sqft).toLocaleString('en-IN')} ft² · ${p.front_ft}×${p.depth_ft}`;
  return (
    <button className="m-row wrap" onClick={onOpen}>
      <span className={`m-badge m-unit st-${p.status}`}>{p.label}</span>
      <div className="body">
        <b>{size}</b>
        <span>{p.status === 'available' ? `${p.facing.map((f) => DIR[f]).join(' & ')} facing` : `${p.buyer_name ?? '—'}${by ? ` · by ${by}` : ''}`}</span>
      </div>
      <div className="end num">{short(value)}<small>{p.status === 'available' ? 'open' : p.status}</small></div>
    </button>
  );
}

function Blocks({ pr, mine, apt, towerName, openPlot, many }: {
  pr: Parameters<typeof plotValue>[0]; mine: Plot[]; apt: boolean; towerName: (id: string | null) => string; openPlot: (id: string) => void; many: string;
}) {
  const groups = new Map<string, Plot[]>();
  mine.forEach((p) => { const g = apt ? towerName(p.tower_id) : blockOf(p.label); groups.set(g, [...(groups.get(g) ?? []), p]); });
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return <>
    {rows.map(([name, ps]) => {
      const bc = counts(ps);
      const sold = ps.filter((p) => p.status !== 'available');
      const value = ps.reduce((s, p) => s + plotValue(pr, p), 0);
      const collected = sold.reduce((s, p) => s + Number(p.paid), 0);
      const due = sold.reduce((s, p) => s + Math.max(0, plotValue(pr, p) - p.paid), 0);
      return (
        <section key={name} className="m-card">
          <div className="m-cardhead"><h3>{apt ? 'Tower' : 'Block'} {name}</h3><span>{bc.total} {many}</span></div>
          <div className="m-stackbar" aria-hidden="true">
            <i style={{ width: `${(bc.sold / bc.total) * 100}%`, background: 'var(--m-mint)' }} />
            <i style={{ width: `${(bc.booked / bc.total) * 100}%`, background: 'var(--m-amber)' }} />
          </div>
          <div className="m-tiles" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 12 }}>
            <MiniStat label="Value" value={short(value)} />
            <MiniStat label="Collected" value={short(collected)} />
            <MiniStat label="Due" value={short(due)} />
          </div>
          {bc.available > 0 && (
            <div className="m-pick" style={{ marginTop: 12 }}>
              {ps.filter((p) => p.status === 'available').slice(0, 16).map((p) => <button key={p.id} onClick={() => { tap(); openPlot(p.id); }}>{p.label}</button>)}
              {bc.available > 16 && <span className="m-sub m-small" style={{ alignSelf: 'center' }}>+{bc.available - 16} more open</span>}
            </div>
          )}
        </section>
      );
    })}
  </>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--m-sunk)', borderRadius: 14, padding: '10px', minWidth: 0 }}>
      <b className="num" style={{ display: 'block', fontWeight: 800, fontSize: '.95rem', overflowWrap: 'anywhere' }}>{value}</b>
      <span style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--m-sub)' }}>{label}</span>
    </div>
  );
}
