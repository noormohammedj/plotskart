import type React from 'react';
import type { Plot, Status, Tower, UnitType } from '../lib/types';
import { counts } from '../lib/plots';

type Props = {
  towers: Tower[];
  flats: Plot[];
  types: UnitType[];
  filter: Status | 'all';
  query: string;
  selected: string | null;
  onPick: (id: string) => void;
};

const floorName = (f: number) => (f === 0 ? 'G' : String(f));

/** Apartment towers as a stacking plan: one column of floors per tower, flats colour-coded like plots. */
export function StackingPlan({ towers, flats, types, filter, query, selected, onPick }: Props) {
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const q = query.trim().toLowerCase();
  if (!towers.length) return <p className="empty">This project has no towers yet.</p>;
  return (
    <div className="stack-plan">
      {towers.map((t) => {
        const mine = flats.filter((f) => f.tower_id === t.id);
        const floors = [...new Set(mine.map((f) => f.floor ?? 0))].sort((a, b) => b - a);
        const c = counts(mine);
        return (
          <section key={t.id} className="sp-tower" aria-label={`Tower ${t.name}`}>
            <div className="sp-h"><b>Tower {t.name}</b><span className="mono muted">{c.available} of {c.total} flats available</span></div>
            <div className="sp-grid" role="grid">
              {floors.map((fl, i) => {
                const row = mine.filter((f) => (f.floor ?? 0) === fl).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
                return (
                  // --i: floors rise from the ground up when the plan opens
                  <div key={fl} className="sp-row" role="row" style={{ '--i': floors.length - 1 - i } as React.CSSProperties}>
                    <span className="sp-fl" role="rowheader">{floorName(fl)}</span>
                    {row.map((f) => {
                      const cls = ['sp-u', `st-${f.status}`];
                      if (filter !== 'all' && f.status !== filter) cls.push('dim');
                      if (selected === f.id || (q && f.label.toLowerCase() === q)) cls.push('sel');
                      const type = f.unit_type_id ? typeName.get(f.unit_type_id) : null;
                      return (
                        <button key={f.id} className={cls.join(' ')} role="gridcell" onClick={() => onPick(f.id)}
                          aria-label={`Flat ${f.label}, ${type ?? ''}, ${f.status}`} title={`${f.label} · ${type ?? ''} · ${f.status}`}>
                          <b>{f.label.slice(t.name.length + 1)}</b>{type && <small>{type}</small>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
