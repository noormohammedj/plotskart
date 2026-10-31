/* Sales-site bundle (built to website/assets/site3d.js by `npm run build:site3d`): the same 3D views as the app,
   filled with the sample Jatwada layout and a two-tower apartment project. The page finds each scene on its
   element as `el.scene3d` and listens for `scene3d:pick` and `scene3d:change` events. */
import { jatwadaSample } from './lib/layouts';
import { plotScene, towerScene, type FlatItem, type PlotItem, type SceneHandle, type SceneStatus } from './lib/scene3d';

type Host = HTMLElement & { scene3d?: SceneHandle };

// the same mix every visit: about half sold, a fifth booked
const statusOf = (label: string): SceneStatus => {
  let h = 7;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const k = h % 10;
  return k < 5 ? 'sold' : k < 7 ? 'booked' : 'available';
};

// the dark tiles of the sales site: ground melts into the page
const night = { fog: '#0B1418', colors: { ground: '#0E191E' } };

const NAMES = ['Ravi', 'Priya', 'Imran', 'Arjun', 'Suresh', 'Meena'];

function plots(el: Host) {
  const { layout, plots: raw } = jatwadaSample();
  const items: (PlotItem & { sqft: number })[] = raw.map((p, i) => ({ id: String(i), label: p.label, status: statusOf(p.label), geom: p.geom, sqft: p.sqft }));
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fire = (type: string, detail: unknown) => el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  const scene = plotScene(el, layout, items, null, {
    dark: el.dataset.dark === '1',
    ...night,
    autoRotate: true,
    zoom: 0.86,
    interactive: !coarse,
    onPick: (id) => { const p = items[+id]; scene.setSelected(id); fire('scene3d:pick', { label: p.label, status: p.status, sqft: p.sqft }); },
  });
  el.scene3d = scene;
  // "live" mode: a plot is booked or sold every few seconds, like a real team at work
  if (el.dataset.live === '1' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let n = 0;
    setInterval(() => {
      if (document.hidden) return;
      const open = items.filter((p) => p.status !== 'sold');
      const p = open[(n * 7919) % open.length];
      const was = p.status;
      p.status = was === 'available' ? 'booked' : 'sold';
      scene.setStatuses(items);
      fire('scene3d:change', { label: p.label, status: p.status, who: NAMES[n % NAMES.length], counts: counts(items) });
      n++;
      // keep the layout from filling up: reopen one sold plot now and then
      if (n % 5 === 0) { const s = items.filter((q) => q.status === 'sold'); s[(n * 31) % s.length].status = 'available'; }
    }, 3400);
  }
  fire('scene3d:change', { counts: counts(items) });
}

function counts(items: { status: SceneStatus }[]) {
  return { sold: items.filter((p) => p.status === 'sold').length, booked: items.filter((p) => p.status === 'booked').length, available: items.filter((p) => p.status === 'available').length };
}

function towers(el: Host) {
  const flats: FlatItem[] = [];
  for (const [t, floors] of [['A', 14], ['B', 10]] as const) {
    for (let f = 1; f <= floors; f++) for (let u = 1; u <= 4; u++) {
      const label = `${t}-${f}${String(u).padStart(2, '0')}`;
      flats.push({ id: label, label, tower: t, floor: f, status: statusOf(label + 'x') });
    }
  }
  el.scene3d = towerScene(el, [{ id: 'A', name: 'Tower A' }, { id: 'B', name: 'Tower B' }], flats, {
    dark: el.dataset.dark === '1',
    ...night,
    interactive: false,
    intro: false,
  });
}

function mount(el: Host) {
  try {
    if (el.dataset.scene === 'plots') plots(el);
    else if (el.dataset.scene === 'towers') towers(el);
    el.classList.add('ready');
  } catch {
    el.classList.add('no3d'); // no WebGL: the page keeps its picture
  }
}

// build each scene shortly before it scrolls into view
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  io.unobserve(e.target);
  mount(e.target as Host);
}), { rootMargin: '400px' });
document.querySelectorAll<HTMLElement>('[data-scene]').forEach((el) => io.observe(el));
