import { useEffect, useState } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { I, tap } from './kit';
import { AMENITIES, DEV_KINDS, growthBp, nowRatePaise, useShowcase, type DevKind } from './showcaseData';

type PriceRow = { year: string; rate: string; note: string };
type DevRow = { name: string; kind: DevKind; km: string; year: string; note: string };

const digits = (s: string) => s.replace(/\D/g, '');
/** "2.5" km → 2500 m, without floating-point surprises */
const kmToM = (s: string) => { const [a, b = ''] = s.split('.'); return s ? Number(a || '0') * 1000 + Number((b + '000').slice(0, 3)) : null; };
/** "8.5" % → 850 basis points */
const pctToBp = (s: string) => { if (!s.trim()) return null; const neg = s.trim().startsWith('-'); const [a, b = ''] = s.replace(/[^\d.]/g, '').split('.'); const v = Number(a || '0') * 100 + Number((b + '00').slice(0, 2)); return neg ? -v : v; };

/** Owner: what the showcase tells buyers about a project. */
export function MShowcaseEdit({ id }: { id: string }) {
  const { projects, isOwner, rpc } = useData();
  const pr = projects.find((p) => p.id === id);
  const { show, prices, devs, loaded } = useShowcase(id);
  const year = new Date().getFullYear();
  const [tagline, setTagline] = useState('');
  const [amen, setAmen] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [growth, setGrowth] = useState('');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [devRows, setDevRows] = useState<DevRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    setTagline(show.tagline);
    setAmen(show.amenities);
    setGrowth(show.growth_bp != null ? String(show.growth_bp / 100) : '');
    setRows(prices.length ? prices.map((p) => ({ year: String(p.year), rate: String(Math.round(p.rate_paise / 100)), note: p.note ?? '' }))
      : [{ year: String(year - 10), rate: '', note: '' }, { year: String(year - 5), rate: '', note: '' }]);
    setDevRows(devs.map((d) => ({ name: d.name, kind: d.kind, km: d.distance_m != null ? String(d.distance_m / 1000) : '', year: d.expected_year ? String(d.expected_year) : '', note: d.note ?? '' })));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pr) return null;
  if (!isOwner) return <div className="m-page"><div className="m-card m-empty"><b>Only the owner can change the showcase</b></div></div>;

  const pricePayload = rows.filter((r) => r.year && r.rate).map((r) => ({ year: Number(r.year), rate_paise: Number(digits(r.rate)) * 100, note: r.note }));
  const auto = growthBp({ tagline: '', amenities: [], growth_bp: null }, pricePayload.map((p) => ({ ...p, note: null })).sort((a, b) => a.year - b.year), nowRatePaise(pr), year);
  const toggle = (a: string) => { tap(); setAmen((all) => (all.includes(a) ? all.filter((x) => x !== a) : [...all, a])); };
  const all = [...AMENITIES.map(([n]) => n), ...amen.filter((a) => !AMENITIES.some(([n]) => n === a))];

  const save = async () => {
    setBusy(true);
    const ok = await rpc('save_showcase', {
      p_project: id,
      p: {
        tagline, amenities: amen, growth_bp: pctToBp(growth),
        prices: pricePayload,
        developments: devRows.filter((d) => d.name.trim()).map((d) => ({ name: d.name, kind: d.kind, distance_m: kmToM(d.km), expected_year: d.year ? Number(d.year) : null, note: d.note })),
      },
    }, 'Showcase saved');
    setBusy(false);
    if (ok) go(`/show/${id}`);
  };

  return (
    <div className="m-page">
      <header className="m-head">
        <button className="m-iconbtn" aria-label="Back" onClick={() => { tap(); go(`/show/${id}`); }}><I n="back" sw={2.4} /></button>
        <div className="t"><small>{pr.name}</small><h1 style={{ fontSize: '1.5rem' }}>Customer showcase</h1></div>
      </header>
      <div className="m-stack">
        <section className="m-card">
          <div className="m-cardhead"><h3>One-line pitch</h3></div>
          <label className="m-field">What makes this project special?<input value={tagline} maxLength={160} onChange={(e) => setTagline(e.target.value)} placeholder="Gated layout 5 minutes from the ring road" /></label>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Amenities</h3><span>{amen.length} picked</span></div>
          <div className="m-pick">
            {all.map((a) => <button key={a} className={amen.includes(a) ? 'on' : ''} onClick={() => toggle(a)}>{AMENITIES.find(([n]) => n === a)?.[1] ?? '✨'} {a}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <label className="m-field" style={{ flex: 1 }}><input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add your own, e.g. Solar street lights" /></label>
            <button className="m-btn sm" disabled={!custom.trim()} onClick={() => { const v = custom.trim(); if (v && !amen.includes(v)) setAmen((x) => [...x, v]); setCustom(''); }}>Add</button>
          </div>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Land rate in past years</h3><span>₹ per ft²</span></div>
          <p className="m-sub m-small" style={{ margin: '-6px 0 12px' }}>From guideline values, old sale deeds or your own past projects. Today's rate (₹{Number(pr.sale_rate).toLocaleString('en-IN')}) comes from the project.</p>
          {rows.map((r, i) => (
            <div key={i} className="m-edrow">
              <label className="m-field" style={{ width: 86 }}>Year<input inputMode="numeric" maxLength={4} value={r.year} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, year: digits(e.target.value) } : y)))} /></label>
              <label className="m-field" style={{ flex: 1 }}>₹ / ft²<input inputMode="numeric" value={r.rate} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, rate: digits(e.target.value) } : y)))} placeholder="0" /></label>
              <button className="m-del" aria-label="Remove this year" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
          <button className="m-btn ghost sm" style={{ marginTop: 10 }} onClick={() => setRows((x) => [...x, { year: '', rate: '', note: '' }])}>+ Add a year</button>
          <label className="m-field" style={{ marginTop: 16 }}>Yearly growth for projections (%)
            <input inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value.replace(/[^\d.-]/g, ''))} placeholder={auto != null ? `Leave blank to use ${(auto / 100).toFixed(1)}% from past prices` : 'e.g. 8'} />
          </label>
        </section>

        <section className="m-card">
          <div className="m-cardhead"><h3>Coming up nearby</h3><span>{devRows.length}</span></div>
          <p className="m-sub m-small" style={{ margin: '-6px 0 12px' }}>Metro lines, IT parks, highways, hospitals: anything that will lift the area. Buyers see the name, type, distance and year.</p>
          {devRows.map((d, i) => {
            const set = (patch: Partial<DevRow>) => setDevRows((x) => x.map((y, k) => (k === i ? { ...y, ...patch } : y)));
            return (
              <div key={i} className="m-card flat" style={{ padding: 12, marginBottom: 10 }}>
                <div className="m-edrow">
                  <label className="m-field" style={{ flex: 1 }}>Name<input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Metro station (Line 2)" /></label>
                  <button className="m-del" aria-label="Remove" onClick={() => setDevRows((x) => x.filter((_, k) => k !== i))}>×</button>
                </div>
                <div className="m-pick" style={{ marginTop: 10 }}>
                  {(Object.keys(DEV_KINDS) as DevKind[]).map((k) => <button key={k} className={d.kind === k ? 'on' : ''} onClick={() => { tap(); set({ kind: k }); }}>{DEV_KINDS[k][0]} {DEV_KINDS[k][1]}</button>)}
                </div>
                <div className="m-edrow" style={{ marginTop: 10 }}>
                  <label className="m-field" style={{ flex: 1 }}>Distance (km)<input inputMode="decimal" value={d.km} onChange={(e) => set({ km: e.target.value.replace(/[^\d.]/g, '') })} placeholder="2.5" /></label>
                  <label className="m-field" style={{ flex: 1 }}>Ready by (year)<input inputMode="numeric" maxLength={4} value={d.year} onChange={(e) => set({ year: digits(e.target.value) })} placeholder={String(year + 2)} /></label>
                </div>
                <label className="m-field" style={{ marginTop: 10 }}>Note (optional)<input value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="Approved in the state budget" /></label>
              </div>
            );
          })}
          <button className="m-btn ghost sm" onClick={() => setDevRows((x) => [...x, { name: '', kind: 'transport', km: '', year: '', note: '' }])}>+ Add a development</button>
        </section>

        <button className="m-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save showcase'}</button>
      </div>
    </div>
  );
}
