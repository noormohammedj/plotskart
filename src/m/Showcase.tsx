import { Share } from '@capacitor/share';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Scene3D } from '../components/Scene3D';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { DIR, short } from '../lib/format';
import { isNative } from '../lib/native';
import { kmText, NEARBY_LABEL, nearbyPlaces, type NearbyKind, type NearbyPlace } from '../lib/nearby';
import { counts, plotValue, unitWord } from '../lib/plots';
import type { Plot, Project } from '../lib/types';
import { I, Ring, tap } from './kit';
import { amenityIcon, DEV_KINDS, grow, growthBp, nowRatePaise, priceNear, useShowcase, type PricePoint } from './showcaseData';

const NEARBY_ICON: Record<NearbyKind, string> = { school: '🏫', college: '🎓', hospital: '🏥', station: '🚉', bus: '🚌', shop: '🛍️' };
const rupees = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const SECTIONS: [string, string][] = [['top', 'Overview'], ['layout', 'Layout'], ['amen', 'Amenities'], ['near', 'Nearby'], ['price', 'Price'], ['coming', 'Coming up'], ['plots', 'Available']];

/** What sales staff and brokers show a buyer: the project, its layout in 3D, amenities, what is around it,
    how the price has moved and where it may go, what is being built nearby, and the plots still open.
    Nothing internal (buyers, commission, costs) appears here. */
export function MShowcase({ id }: { id: string }) {
  const { projects, plots, towers, isOwner, openPlot, toast } = useData();
  const pr = projects.find((p) => p.id === id);
  const { show, prices, devs, loaded } = useShowcase(id);
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [active, setActive] = useState('top');
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!pr || pr.lat == null || pr.lng == null) { setPlaces([]); return; }
    let gone = false;
    nearbyPlaces(Number(pr.lat), Number(pr.lng)).then((p) => { if (!gone) setPlaces(p); });
    return () => { gone = true; };
  }, [pr]);

  // highlight the section being looked at
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (v) setActive(v.target.getAttribute('data-sec') ?? 'top');
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [loaded, places, pr?.id]);

  // keep the highlighted chip in view as the page scrolls
  useEffect(() => { document.querySelector(`.m-show-nav [data-k="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [active]);
  const mine = useMemo(() => plots.filter((p) => p.project_id === id), [plots, id]);
  if (!pr) return <div className="m-page"><div className="m-card m-empty"><b>Project not found</b></div></div>;
  const c = counts(mine);
  const avail = mine.filter((p) => p.status === 'available').sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  const values = avail.map((p) => plotValue(pr, p));
  const from = values.length ? Math.min(...values) : 0;
  const sec = (k: string) => ({ 'data-sec': k, ref: (el: HTMLElement | null) => { refs.current[k] = el; } });
  const jump = (k: string) => { tap(); refs.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const share = async () => {
    tap();
    const text = shareText(pr, show.tagline, show.amenities, places ?? [], devs, from, avail.length);
    try {
      if (isNative) await Share.share({ title: pr.name, text });
      else if (navigator.share) await navigator.share({ title: pr.name, text });
      else { await navigator.clipboard.writeText(text); toast('Copied. Paste it into WhatsApp.'); }
    } catch { /* closed the share sheet */ }
  };

  return (
    <div className="m-show">
      <header className="m-show-top">
        <button className="m-iconbtn" aria-label="Close" onClick={() => { tap(); go('/projects'); }}><I n="back" sw={2.4} /></button>
        <b>{pr.name}</b>
        {isOwner && <button className="m-iconbtn" aria-label="Edit showcase" onClick={() => { tap(); go(`/show/${id}/edit`); }}><I n="tag" /></button>}
        <button className="m-iconbtn" aria-label="Share with customer" onClick={share}><I n="chat" /></button>
      </header>
      <nav className="m-show-nav m-chips" aria-label="Sections">
        {SECTIONS.map(([k, l]) => <button key={k} data-k={k} className={`m-chip${active === k ? ' on' : ''}`} onClick={() => jump(k)}>{l}</button>)}
      </nav>

      <div className="m-show-body m-stack">
        <section {...sec('top')} className="m-hero m-show-cover">
          <div className="lab">{pr.kind === 'apartments' ? 'Apartments' : 'Plotted layout'}{pr.approval ? ` · ${pr.approval}` : ''}</div>
          <h1>{pr.name}</h1>
          <p className="sm">📍 {pr.location}</p>
          {show.tagline && <p className="m-show-tag">“{show.tagline}”</p>}
          <div className="m-hero-row" style={{ marginTop: 18 }}>
            <Ring value={c.total ? (c.sold + c.booked) / c.total : 0} size={96} stroke={11}>
              <b>{c.total ? Math.round(((c.sold + c.booked) / c.total) * 100) : 0}%</b><span>taken</span>
            </Ring>
            <div className="info">
              <div className="sm">Starting from</div>
              <div className="big num">{from ? short(from) : '—'}</div>
              <div className="sm">₹{Number(pr.sale_rate).toLocaleString('en-IN')} per ft² · {c.available} of {c.total} {unitWord(pr, c.total)} open</div>
            </div>
          </div>
          {c.available > 0 && c.available <= Math.max(5, c.total * 0.15) && <div className="m-show-urgent">🔥 Only {c.available} {unitWord(pr, c.available)} left</div>}
        </section>

        <section {...sec('layout')}>
          <SecHead title="The layout" sub={`${c.available} open · ${c.booked} booked · ${c.sold} sold`} />
          <div className="m-card m-show-3d">
            <Scene3D project={pr} plots={mine} towers={towers.filter((t) => t.project_id === id)} filter="all" selected={null} onPick={openPlot} />
            <div className="m-legend"><span><i style={{ background: '#E2574C' }} />Open</span><span><i style={{ background: '#F1C33F' }} />Booked</span><span><i style={{ background: '#3FAE63' }} />Sold</span></div>
          </div>
        </section>

        <section {...sec('amen')}>
          <SecHead title="Amenities" sub={show.amenities.length ? `${show.amenities.length} included` : ''} />
          {show.amenities.length ? (
            <div className="m-amen">
              {show.amenities.map((a) => <div key={a} className="m-amen-i"><span>{amenityIcon(a)}</span>{a}</div>)}
            </div>
          ) : <Empty owner={isOwner} id={id} text="No amenities listed yet." />}
        </section>

        <section {...sec('near')}>
          <SecHead title="What's nearby" sub={places?.length ? 'within 5 km' : ''} />
          <div className="m-card" style={{ paddingBlock: 6 }}>
            {places == null ? <p className="m-sub m-small" style={{ padding: '12px 0' }}>Finding schools, hospitals and stations…</p>
              : pr.lat == null ? <p className="m-sub m-small" style={{ padding: '12px 0' }}>Add the site's map position to the project to show what is nearby.</p>
                : !places.length ? <p className="m-sub m-small" style={{ padding: '12px 0' }}>The map service is busy. Try again in a minute.</p>
                  : <div className="m-list">
                    {places.map((p) => (
                      <div key={p.name} className="m-row" style={{ cursor: 'default' }}>
                        <span className="m-badge t-sky" style={{ fontSize: '1.1rem' }}>{NEARBY_ICON[p.kind]}</span>
                        <div className="body"><b>{p.name}</b><span>{NEARBY_LABEL[p.kind]}</span></div>
                        <div className="end">{kmText(p.dist)}</div>
                      </div>
                    ))}
                  </div>}
            {places?.length ? <p className="m-sub" style={{ fontSize: '.7rem', margin: '4px 0 8px' }}>Straight-line distance · map data © OpenStreetMap</p> : null}
          </div>
        </section>

        <section {...sec('price')}>
          <SecHead title="Price journey" sub="per ft²" />
          <PriceJourney pr={pr} prices={prices} overrideBp={show.growth_bp} sample={medianSqft(avail.length ? avail : mine)} owner={isOwner} id={id} />
        </section>

        <section {...sec('coming')}>
          <SecHead title="Coming up nearby" sub={devs.length ? `${devs.length} development${devs.length === 1 ? '' : 's'}` : ''} />
          {devs.length ? (
            <div className="m-devs">
              {devs.map((d, i) => (
                <div key={i} className="m-dev">
                  <span className="ic">{DEV_KINDS[d.kind]?.[0] ?? '📍'}</span>
                  <div className="body">
                    <b>{d.name}</b>
                    <span>{[DEV_KINDS[d.kind]?.[1], d.distance_m != null ? kmText(d.distance_m) + ' away' : null].filter(Boolean).join(' · ')}</span>
                    {d.note && <p>{d.note}</p>}
                  </div>
                  {d.expected_year && <span className="yr">{d.expected_year <= new Date().getFullYear() ? 'Open' : d.expected_year}</span>}
                </div>
              ))}
            </div>
          ) : <Empty owner={isOwner} id={id} text="No upcoming developments added yet." />}
        </section>

        <section {...sec('plots')}>
          <SecHead title={`Open ${unitWord(pr)}`} sub={`${avail.length} available`} />
          <div className="m-card" style={{ paddingBlock: 6 }}>
            {avail.length ? <div className="m-list">
              {avail.slice(0, 60).map((p) => <PlotRow key={p.id} pr={pr} p={p} onOpen={() => { tap(); openPlot(p.id); }} />)}
            </div> : <div className="m-empty"><div className="art">🎉</div><b>Sold out</b>Every {unitWord(pr, 1)} here is booked or sold.</div>}
          </div>
        </section>

        <button className="m-btn" onClick={share}>Share with the customer on WhatsApp</button>
        {isOwner && <button className="m-btn ghost" onClick={() => { tap(); go(`/broadcast/${id}`); }}>📣 Announce to all customers who agreed to offers</button>}
        <p className="m-sub" style={{ fontSize: '.72rem', textAlign: 'center' }}>Projections are estimates from past prices, not a promise of future value.</p>
      </div>
    </div>
  );
}

function SecHead({ title, sub }: { title: string; sub?: string }) {
  return <div className="m-sec" style={{ marginBottom: 10 }}><h2>{title}</h2>{sub && <span className="m-sub m-small">{sub}</span>}</div>;
}

function Empty({ owner, id, text }: { owner: boolean; id: string; text: string }) {
  return (
    <div className="m-card flat m-small" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
      <span className="m-sub">{text}</span>
      {owner && <button className="m-btn sm" onClick={() => { tap(); go(`/show/${id}/edit`); }}>Add</button>}
    </div>
  );
}

function PlotRow({ pr, p, onOpen }: { pr: Project; p: Plot; onOpen: () => void }) {
  const facing = p.facing.map((f) => DIR[f]).join(' & ');
  return (
    <button className="m-row wrap" onClick={onOpen}>
      <span className="m-badge t-red" style={{ fontWeight: 800, fontSize: '.78rem' }}>{p.label}</span>
      <div className="body">
        <b>{Number(p.sqft).toLocaleString('en-IN')} ft²{pr.kind !== 'apartments' && p.front_ft ? ` · ${p.front_ft}×${p.depth_ft}` : ''}</b>
        <span>{facing ? `${facing} facing` : ''}{p.facing.length > 1 ? ' · corner' : ''}</span>
      </div>
      <div className="end num">{short(plotValue(pr, p))}</div>
    </button>
  );
}

const medianSqft = (list: Plot[]) => {
  const s = list.map((p) => Math.round(Number(p.sqft))).filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 1200;
};

/** Past prices, today's rate and a projection, drawn as one line; the future part dashed. */
function PriceJourney({ pr, prices, overrideBp, sample, owner, id }: { pr: Project; prices: PricePoint[]; overrideBp: number | null; sample: number; owner: boolean; id: string }) {
  const year = new Date().getFullYear();
  const now = nowRatePaise(pr);
  const bp = growthBp({ tagline: '', amenities: [], growth_bp: overrideBp }, prices, now, year);
  const ago10 = priceNear(prices, year - 10), ago5 = priceNear(prices, year - 5);
  if (!now) return <Empty owner={owner} id={id} text="Set the project's sale rate first." />;

  const past = prices.filter((p) => p.year < year);
  const line: { year: number; v: number; future?: boolean }[] = [...past.map((p) => ({ year: p.year, v: p.rate_paise })), { year, v: now }];
  if (bp != null) for (const n of [4, 10]) line.push({ year: year + n, v: grow(now, bp, n), future: true });
  const y0 = Math.min(...line.map((p) => p.year)), y1 = Math.max(...line.map((p) => p.year));
  const vMax = Math.max(...line.map((p) => p.v)) * 1.08;
  const W = 340, H = 170, padX = 18, padT = 26, padB = 26;
  const x = (yr: number) => padX + ((yr - y0) / Math.max(1, y1 - y0)) * (W - padX * 2);
  const y = (v: number) => padT + (1 - v / vMax) * (H - padT - padB);
  const solid = line.filter((p) => !p.future);
  const dashed = line.filter((p) => p.future || p.year === year);
  const path = (pts: typeof line) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.year).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = solid.length > 1 ? `${path(solid)} L${x(year)},${H - padB} L${x(solid[0].year)},${H - padB} Z` : '';

  const cards: [string, string, number | null, boolean?][] = [
    ['10 years ago', ago10 ? String(ago10.year) : '', ago10?.rate_paise ?? null],
    ['5 years ago', ago5 ? String(ago5.year) : '', ago5?.rate_paise ?? null],
    ['Today', String(year), now],
    ['In 4 years', String(year + 4), bp != null ? grow(now, bp, 4) : null, true],
    ['In 10 years', String(year + 10), bp != null ? grow(now, bp, 10) : null, true],
  ];
  const sqftBig = BigInt(sample);
  // whole rupees for a plot of the sample size: paise × sq ft ÷ 100
  const plotAt = (ratePaise: number) => Number((BigInt(ratePaise) * sqftBig) / 100n);

  return (
    <div className="m-card">
      {past.length === 0 && bp == null ? (
        <Empty owner={owner} id={id} text="Add past land rates to show how prices have moved." />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="m-price-svg" role="img" aria-label="Land rate per square foot over the years">
          <defs>
            <linearGradient id="pj-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--m-rose)" stopOpacity=".28" /><stop offset="1" stopColor="var(--m-rose)" stopOpacity="0" /></linearGradient>
            <linearGradient id="pj-line" x1="0" x2="1"><stop offset="0" stopColor="var(--m-violet)" /><stop offset="1" stopColor="var(--m-rose)" /></linearGradient>
          </defs>
          {area && <path d={area} fill="url(#pj-fill)" />}
          {solid.length > 1 && <path d={path(solid)} className="pj-draw" fill="none" stroke="url(#pj-line)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />}
          {dashed.length > 1 && <path d={path(dashed)} fill="none" stroke="var(--m-mint)" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" className="pj-fade" />}
          {line.map((p) => (
            <g key={p.year} className="pj-fade">
              <circle cx={x(p.year)} cy={y(p.v)} r={p.year === year ? 6 : 4.5} fill={p.future ? 'var(--m-mint)' : p.year === year ? 'var(--m-rose)' : 'var(--m-violet)'} stroke="var(--m-card)" strokeWidth="2" />
              <text x={x(p.year)} y={y(p.v) - 11} textAnchor="middle" className="pj-v">{rupees(p.v)}</text>
              <text x={x(p.year)} y={H - 8} textAnchor="middle" className="pj-y">{p.year}</text>
            </g>
          ))}
        </svg>
      )}
      <div className="m-pj-cards">
        {cards.filter(([, , v]) => v != null).map(([l, yr, v, fut]) => (
          <div key={l} className={`m-pj-c${fut ? ' fut' : ''}${l === 'Today' ? ' now' : ''}`}>
            <span>{l}{yr && l !== 'Today' ? ` · ${yr}` : ''}</span>
            <b className="num">{rupees(v!)}</b>
            <small>{short(plotAt(v!))} for {sample.toLocaleString('en-IN')} ft²</small>
          </div>
        ))}
      </div>
      {bp != null && (
        <p className="m-small" style={{ margin: '12px 0 0' }}>
          {overrideBp != null ? 'Projected' : 'Past growth averages'} <b style={{ color: bp >= 0 ? 'var(--m-mint)' : 'var(--m-red)' }}>{(bp / 100).toFixed(1)}% a year</b>
          {ago10 ? `; the rate is ${(now / ago10.rate_paise).toFixed(1)}× what it was in ${ago10.year}` : ''}.
        </p>
      )}
    </div>
  );
}

function shareText(pr: Project, tagline: string, amenities: string[], places: NearbyPlace[], devs: { name: string; expected_year: number | null; distance_m: number | null }[], from: number, open: number) {
  const lines = [
    `*${pr.name}*`, `📍 ${pr.location}`, tagline ? `“${tagline}”` : '',
    '', `${pr.kind === 'apartments' ? 'Flats' : 'Plots'} from ${short(from)} (₹${Number(pr.sale_rate).toLocaleString('en-IN')}/ft²) · ${open} available`,
    pr.approval ? `✅ ${pr.approval}` : '',
    amenities.length ? `\n*Amenities:* ${amenities.slice(0, 10).join(', ')}` : '',
    places.length ? `\n*Nearby:* ${places.slice(0, 6).map((p) => `${p.name} (${kmText(p.dist)})`).join(', ')}` : '',
    devs.length ? `\n*Coming up:* ${devs.slice(0, 5).map((d) => `${d.name}${d.expected_year ? ` (${d.expected_year})` : ''}`).join(', ')}` : '',
    pr.lat != null && pr.lng != null ? `\n🗺️ https://maps.google.com/?q=${pr.lat},${pr.lng}` : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
