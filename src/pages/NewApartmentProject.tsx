import { useState, type FormEvent } from 'react';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { DIR, inr } from '../lib/format';
import type { Dir } from '../lib/types';

type TypeRow = { key: string; name: string; bedrooms: string; carpet: string; builtup: string; saleable: string };
type FlatRow = { suffix: string; type: string; facing: Dir; parking: string; plc: string };
type TowerRow = { name: string; floors: string; ground: boolean };

const DIRS: Dir[] = ['E', 'N', 'W', 'S'];
const paise = (rupees: string) => Math.round((Number(rupees) || 0) * 100);
const nextKey = (rows: TypeRow[]) => String.fromCharCode(65 + rows.length);

/** Owner sets up an apartment project: pricing, unit types, one typical floor, and the towers that repeat it. */
export function NewApartmentProject() {
  const { isOwner, rpc, reload } = useData();
  const [types, setTypes] = useState<TypeRow[]>([
    { key: 'A', name: '2 BHK', bedrooms: '2', carpet: '850', builtup: '1000', saleable: '1200' },
    { key: 'B', name: '3 BHK', bedrooms: '3', carpet: '1150', builtup: '1380', saleable: '1650' },
  ]);
  const [flats, setFlats] = useState<FlatRow[]>([
    { suffix: '01', type: 'A', facing: 'E', parking: '1', plc: '0' },
    { suffix: '02', type: 'B', facing: 'N', parking: '2', plc: '0' },
    { suffix: '03', type: 'B', facing: 'W', parking: '2', plc: '0' },
    { suffix: '04', type: 'A', facing: 'S', parking: '1', plc: '0' },
  ]);
  const [towers, setTowers] = useState<TowerRow[]>([{ name: 'A', floors: '10', ground: false }]);
  const [busy, setBusy] = useState(false);

  if (!isOwner) return <p className="empty">Only the owner can add projects.</p>;

  const setType = (i: number, k: keyof TypeRow, v: string) => setTypes((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setFlat = (i: number, k: keyof FlatRow, v: string) => setFlats((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setTower = (i: number, k: keyof TowerRow, v: string | boolean) => setTowers((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const total = towers.reduce((s, t) => s + (Number(t.floors) || 0) * flats.length, 0);
  const first = towers[0];
  const example = first && flats.length
    ? `${first.name.toUpperCase() || 'A'}-${first.ground ? 'G' : '1'}${flats[0].suffix} … ${first.name.toUpperCase() || 'A'}-${(first.ground ? -1 : 0) + (Number(first.floors) || 1)}${flats[flats.length - 1].suffix}`
    : '';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    const id = await rpc<string>('create_apartment_project', {
      p: {
        name: d.name, location: d.location, rera_no: d.rera, approval: d.approval, launched: d.launched,
        sale_rate: +d.rate || 0, guideline_rate: +d.guideline || 0,
        floor_rise_paise: paise(d.rise), floor_rise_from: +d.riseFrom || 1, parking_paise: paise(d.parking),
        gst_bp: Math.round((Number(d.gst) || 0) * 100),
      },
      p_types: types.map((t) => ({ key: t.key, name: t.name, bedrooms: t.bedrooms ? +t.bedrooms : null, carpet_sqft: +t.carpet || 0, builtup_sqft: +t.builtup || 0, saleable_sqft: +t.saleable || 0 })),
      p_towers: towers.map((t) => ({
        name: t.name, floors: +t.floors, first_floor: t.ground ? 0 : 1,
        stack: flats.map((f) => ({ suffix: f.suffix, type: f.type, facing: [f.facing], parking: +f.parking || 0, plc_paise: paise(f.plc) })),
      })),
    }, `Project created with ${total} flats`);
    setBusy(false);
    if (id) { await reload(); go(`/p/${id}`); }
  };

  const cell = { padding: '6px 8px' } as const;
  return (
    <div className="stack-v">
      <div><button className="back" onClick={() => go('/projects/new')}>← Plot layout instead</button><h1>Add an apartment project</h1></div>
      <form className="stack-v" onSubmit={submit}>
        <section className="card">
          <div className="card-h"><h2>Project and pricing</h2></div>
          <div className="f">
            <label>Project name<input name="name" required placeholder="e.g. Skyline Residency" /></label>
            <label>Location<input name="location" placeholder="Area, city" /></label>
            <label>RERA registration no.<input name="rera" placeholder="optional" /></label>
            <label>Approval<input name="approval" placeholder="e.g. DTCP / CMDA" /></label>
            <label>Base rate (₹ per sq ft, saleable)<input name="rate" type="number" min="0" required defaultValue="6000" /></label>
            <label>Guideline value (₹ per sq ft)<input name="guideline" type="number" min="0" defaultValue="4000" /></label>
            <label>Floor rise (₹ per sq ft, each floor)<input name="rise" type="number" min="0" step="1" defaultValue="25" /></label>
            <label>Floor rise starts above floor<input name="riseFrom" type="number" min="0" defaultValue="1" /></label>
            <label>Car park price (₹ each)<input name="parking" type="number" min="0" step="1000" defaultValue="300000" /></label>
            <label>GST shown to buyers (%)<input name="gst" type="number" min="0" max="28" step="0.5" defaultValue="5" /></label>
            <label>Launched<input name="launched" placeholder="e.g. Nov 2026" /></label>
          </div>
        </section>

        <section className="card">
          <div className="card-h"><h2>Unit types</h2><button type="button" className="btn sm" onClick={() => setTypes((r) => [...r, { key: nextKey(r), name: '', bedrooms: '', carpet: '', builtup: '', saleable: '' }])}>+ Add type</button></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Name</th><th>Bedrooms</th><th className="r">Carpet ft²</th><th className="r">Built-up ft²</th><th className="r">Saleable ft²</th><th /></tr></thead>
              <tbody>
                {types.map((t, i) => (
                  <tr key={t.key}>
                    <td style={cell}><input value={t.name} required aria-label="Type name" onChange={(e) => setType(i, 'name', e.target.value)} placeholder="e.g. 2 BHK East" /></td>
                    <td style={cell}><input value={t.bedrooms} type="number" min="0" max="10" aria-label="Bedrooms" onChange={(e) => setType(i, 'bedrooms', e.target.value)} /></td>
                    <td style={cell}><input value={t.carpet} type="number" min="0" aria-label="Carpet area" onChange={(e) => setType(i, 'carpet', e.target.value)} /></td>
                    <td style={cell}><input value={t.builtup} type="number" min="0" aria-label="Built-up area" onChange={(e) => setType(i, 'builtup', e.target.value)} /></td>
                    <td style={cell}><input value={t.saleable} type="number" min="1" required aria-label="Saleable area" onChange={(e) => setType(i, 'saleable', e.target.value)} /></td>
                    <td style={cell}>{types.length > 1 && <button type="button" className="linkbtn" onClick={() => { setTypes((r) => r.filter((_, j) => j !== i)); setFlats((r) => r.map((f) => (f.type === t.key ? { ...f, type: types[0].key === t.key ? types[1].key : types[0].key } : f))); }}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">The price is on the saleable area. You can add a floor plan picture for each type after the project is created.</p>
        </section>

        <section className="card">
          <div className="card-h"><h2>Typical floor</h2><button type="button" className="btn sm" onClick={() => setFlats((r) => [...r, { suffix: String(r.length + 1).padStart(2, '0'), type: types[0].key, facing: 'E', parking: '1', plc: '0' }])}>+ Add flat</button></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Flat no.</th><th>Type</th><th>Facing</th><th className="r">Car parks</th><th className="r">Preferred location charge (₹)</th><th /></tr></thead>
              <tbody>
                {flats.map((f, i) => (
                  <tr key={i}>
                    <td style={cell}><input value={f.suffix} required aria-label="Flat number on the floor" onChange={(e) => setFlat(i, 'suffix', e.target.value)} style={{ width: 70 }} /></td>
                    <td style={cell}><select value={f.type} aria-label="Unit type" onChange={(e) => setFlat(i, 'type', e.target.value)}>{types.map((t) => <option key={t.key} value={t.key}>{t.name || `Type ${t.key}`}</option>)}</select></td>
                    <td style={cell}><select value={f.facing} aria-label="Facing" onChange={(e) => setFlat(i, 'facing', e.target.value)}>{DIRS.map((d) => <option key={d} value={d}>{DIR[d]}</option>)}</select></td>
                    <td style={cell}><input value={f.parking} type="number" min="0" max="5" aria-label="Car parks" onChange={(e) => setFlat(i, 'parking', e.target.value)} style={{ width: 70 }} /></td>
                    <td style={cell}><input value={f.plc} type="number" min="0" step="1000" aria-label="Preferred location charge" onChange={(e) => setFlat(i, 'plc', e.target.value)} /></td>
                    <td style={cell}>{flats.length > 1 && <button type="button" className="linkbtn" onClick={() => setFlats((r) => r.filter((_, j) => j !== i))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Every floor of every tower repeats this layout. Change single flats later from the flat itself.</p>
        </section>

        <section className="card">
          <div className="card-h"><h2>Towers</h2><button type="button" className="btn sm" onClick={() => setTowers((r) => [...r, { name: String.fromCharCode(65 + r.length), floors: r[r.length - 1]?.floors ?? '10', ground: false }])}>+ Add tower</button></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Tower</th><th className="r">Floors with flats</th><th>Flats on ground floor</th><th className="r">Flats</th><th /></tr></thead>
              <tbody>
                {towers.map((t, i) => (
                  <tr key={i}>
                    <td style={cell}><input value={t.name} required maxLength={20} aria-label="Tower name" onChange={(e) => setTower(i, 'name', e.target.value)} style={{ width: 90 }} /></td>
                    <td style={cell}><input value={t.floors} type="number" min="1" max="120" required aria-label="Floors" onChange={(e) => setTower(i, 'floors', e.target.value)} style={{ width: 90 }} /></td>
                    <td style={cell}><input type="checkbox" checked={t.ground} aria-label="Flats start on the ground floor" onChange={(e) => setTower(i, 'ground', e.target.checked)} style={{ width: 'auto' }} /></td>
                    <td className="r" style={cell}>{(Number(t.floors) || 0) * flats.length}</td>
                    <td style={cell}>{towers.length > 1 && <button type="button" className="linkbtn" onClick={() => setTowers((r) => r.filter((_, j) => j !== i))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <p><b>{total} flats</b> in {towers.length} tower{towers.length === 1 ? '' : 's'}{example ? `, numbered ${example}` : ''}.</p>
          <p className="hint">Each flat's price is saleable area × base rate, plus floor rise above the chosen floor, preferred location charge and car parks. For example a {types[0]?.name || 'flat'} on floor 5 at the default rates comes to about {inr((Number(types[0]?.saleable) || 0) * 6000 + 4 * 25 * (Number(types[0]?.saleable) || 0) + 300000)}, plus GST.</p>
          <div className="btns" style={{ marginTop: 12 }}><button className="btn pri" disabled={busy || total === 0 || total > 3000}>Create project</button></div>
        </section>
      </form>
    </div>
  );
}
