import { useRef, useState, type ChangeEvent } from 'react';
import { useData } from '../data/DataProvider';
import { inr } from '../lib/format';
import { prepareLayoutFile, uploadLayoutImage, useLayoutImageUrl } from '../lib/layoutImage';
import type { Project, UnitType } from '../lib/types';

/** A unit type's floor plan picture (private, shown through a short-lived link). */
export function FloorPlanImg({ type }: { type: UnitType }) {
  const url = useLayoutImageUrl(type.plan_path);
  if (!type.plan_path) return null;
  return url ? <img className="floor-plan" src={url} alt={`Floor plan of ${type.name}`} /> : <p className="hint">Loading floor plan…</p>;
}

/** Unit types of an apartment project with their areas, starting price and floor plan; the owner uploads plans here. */
export function UnitTypesCard({ project, types, flats }: { project: Project; types: UnitType[]; flats: { unit_type_id: string | null; status: string }[] }) {
  const { isOwner, profile, rpc, reload, toast } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const typeId = target.current;
    if (!file || !typeId || !profile?.org_id) return;
    setBusy(typeId);
    try {
      const img = await prepareLayoutFile(file);
      const path = await uploadLayoutImage(profile.org_id, img);
      if (await rpc('set_unit_type_plan', { p_type: typeId, p_path: path }, 'Floor plan saved')) await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not upload the floor plan');
    }
    setBusy(null);
  };

  return (
    <section className="card sec">
      <h2>Unit types and floor plans</h2>
      <input ref={picker} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
      <div className="stack-v">
        {types.map((t) => {
          const mine = flats.filter((f) => f.unit_type_id === t.id);
          return (
            <div key={t.id} className="card" style={{ padding: 14 }}>
              <div className="card-h" style={{ marginBottom: 6 }}>
                <h3>{t.name}</h3>
                <span className="mono muted">{mine.filter((f) => f.status === 'available').length} of {mine.length} available</span>
              </div>
              <div className="dl">
                <div><span className="lbl">Carpet</span><b>{Number(t.carpet_sqft).toLocaleString('en-IN')} ft²</b></div>
                <div><span className="lbl">Built-up</span><b>{Number(t.builtup_sqft).toLocaleString('en-IN')} ft²</b></div>
                <div><span className="lbl">Saleable</span><b>{Number(t.saleable_sqft).toLocaleString('en-IN')} ft²</b></div>
                <div><span className="lbl">Base price</span><b>{inr(t.saleable_sqft * project.sale_rate)}</b></div>
              </div>
              <FloorPlanImg type={t} />
              {isOwner && (
                <div className="btns" style={{ marginTop: 8 }}>
                  <button className="btn sm" disabled={busy === t.id} onClick={() => { target.current = t.id; picker.current?.click(); }}>
                    {busy === t.id ? 'Uploading…' : t.plan_path ? 'Replace floor plan' : 'Add floor plan (photo or PDF)'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
