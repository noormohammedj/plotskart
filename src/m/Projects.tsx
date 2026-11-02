import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { ProjectPreview } from '../components/ProjectPreview';
import { counts, unitWord } from '../lib/plots';
import { I, Ring, tap } from './kit';

export function MProjects() {
  const { projects, plots, towers, isOwner } = useData();
  return (
    <div className="m-page">
      <header className="m-head"><div className="t"><small>{projects.length} project{projects.length === 1 ? '' : 's'}</small><h1>Projects</h1></div></header>
      <div className="m-stack">
        {projects.length === 0 && (
          <div className="m-card m-empty"><div className="art">🗺️</div><b>No projects yet</b>{isOwner ? 'Tap + to add your first layout from a photo or PDF.' : 'Projects appear here once the owner adds them.'}</div>
        )}
        {projects.map((pr) => {
          const mine = plots.filter((p) => p.project_id === pr.id);
          const c = counts(mine);
          const sold = c.total ? (c.sold + c.booked) / c.total : 0;
          return (
            <div key={pr.id} className="m-proj">
            <button className="m-proj-main" onClick={() => { tap(); go(`/p/${pr.id}`); }}>
              <div className="pic">
                <ProjectPreview project={pr} plots={mine} towers={towers.filter((t) => t.project_id === pr.id)} />
                <span className="kind">{pr.kind === 'apartments' ? 'Apartments' : 'Plotted layout'}</span>
                <span className="pct"><Ring value={sold} size={46} stroke={5} color="var(--m-rose)" track="var(--m-faint)"><b style={{ fontSize: '.72rem', color: 'var(--m-ink)' }}>{Math.round(sold * 100)}%</b></Ring></span>
              </div>
              <div className="info">
                <h3>{pr.name}</h3>
                <div className="loc">{pr.location}</div>
                <div className="m-stackbar" aria-hidden="true">
                  <i style={{ width: `${(c.sold / Math.max(1, c.total)) * 100}%`, background: 'var(--m-mint)' }} />
                  <i style={{ width: `${(c.booked / Math.max(1, c.total)) * 100}%`, background: 'var(--m-amber)', animationDelay: '.1s' }} />
                </div>
                <div className="nums">
                  <span><b>{c.available}</b>available</span><span><b>{c.booked}</b>booked</span><span><b>{c.sold}</b>sold</span>
                  <span style={{ marginLeft: 'auto' }}><b>₹{Number(pr.sale_rate).toLocaleString('en-IN')}</b>/ft²</span>
                </div>
                <div className="m-sub m-small" style={{ marginTop: 6 }}>{c.total} {unitWord(pr, c.total)}</div>
              </div>
            </button>
            <button className="m-present" onClick={() => { tap(); go(`/show/${pr.id}`); }}>▶ Show customer</button>
            </div>
          );
        })}
      </div>
      {isOwner && <button className="m-fab" aria-label="Add a project" onClick={() => { tap(); go('/projects/new'); }}><I n="plus" sw={2.6} /></button>}
    </div>
  );
}
