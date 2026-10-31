/* 3D views of a project, shared by the app and the sales site (which loads the same code as a bundle).
   plotScene: the layout drawing becomes ground, roads and parks; every plot rises as a slab in its status colour
   and sold plots get a small house. towerScene: each tower is built floor by floor out of its flats.
   Both fly in once, orbit with mouse or touch, and report a tapped plot or flat by id. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { NearbyKind, NearbyPlace } from './nearby';

export type SceneStatus = 'available' | 'booked' | 'sold';
export type SceneFilter = SceneStatus | 'all';
export interface SceneItem { id: string; label: string; status: SceneStatus }
export interface PlotItem extends SceneItem { geom: { x: number; y: number; w: number; h: number; pts?: string | null } }
export interface FlatItem extends SceneItem { tower: string; floor: number }
export interface LayoutLike {
  w: number; h: number;
  roads: { x: number; y: number; w: number; h: number }[];
  diag?: number[][];
  parks: { pts: string }[];
}

export interface Palette { ground: string; land: string; road: string; park: string; available: string; booked: string; sold: string; house: string; roof: string; label: string; glass: string; slab: string }
const LIGHT: Palette = {
  ground: '#DCE4DC', land: '#E8EEE3', road: '#69757A', park: '#9CC58A', available: '#E2574C', booked: '#F1C33F', sold: '#3FAE63',
  house: '#F6F4EE', roof: '#2C3B44', label: '#14212A', glass: '#CFE0EA', slab: '#F3F5F2',
};
const DARK: Palette = {
  ground: '#141C1E', land: '#1B2622', road: '#3B474B', park: '#2F5A38', available: '#E2574C', booked: '#F1C33F', sold: '#3FAE63',
  house: '#DAD8D0', roof: '#11181C', label: '#F2F5F3', glass: '#5C7480', slab: '#C9CFCB',
};

export interface SceneOptions {
  onPick?: (id: string) => void;
  /** pointer over a plot or flat: id and position inside the element; null when it leaves */
  onHover?: (id: string | null, x: number, y: number) => void;
  dark?: boolean;
  colors?: Partial<Palette>;
  /** slow turn until someone touches it (the sales site) */
  autoRotate?: boolean;
  /** camera flies in from above when the scene opens */
  intro?: boolean;
  /** false: no orbiting or picking, the page scroll drives the camera through setOrbit */
  interactive?: boolean;
  /** fade the distance into this colour (the sales site's dark tiles) */
  fog?: string;
  /** camera distance as a share of the fitted distance */
  zoom?: number;
}

export interface SceneHandle {
  setFilter(f: SceneFilter): void;
  setSelected(id: string | null): void;
  /** new statuses for the same plots or flats (live updates from the team) */
  setStatuses(items: SceneItem[]): void;
  /** 0..1 progress for scroll-driven camera moves on the sales site */
  setOrbit(t: number): void;
  /** on phones the sales site starts with orbiting off, so the page still scrolls, until someone taps to explore */
  setInteractive(on: boolean): void;
  resetView(): void;
  dispose(): void;
  /** plot layouts only: schools, hospitals, stations and shops around the project */
  setNearby?(places: NearbyPlace[]): void;
}

const NEARBY_COLOR: Record<NearbyKind, string> = {
  school: '#4C7BD9', college: '#7A5BD0', hospital: '#E05263', station: '#37474F', bus: '#E8913A', shop: '#2BA59B',
};

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** deterministic random numbers so trees stand in the same place on every visit */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const parsePts = (pts: string) => pts.trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);

function inside(pt: [number, number], poly: [number, number][]) {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/** Renderer, camera, lights, orbit, picking and the render loop that both scenes share. */
function stage(el: HTMLElement, opts: SceneOptions) {
  const pal: Palette = { ...(opts.dark ? DARK : LIGHT), ...opts.colors };
  const still = reduceMotion();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  // a turning scene redraws every frame, so it gets fewer pixels than one that only redraws on a tap;
  // phones with few cores or little memory (the cheap Android class) get fewer pixels and plainer shadows
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : opts.autoRotate ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  // the sun never moves relative to the ground, so shadows are drawn again only when something on the ground changes
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = lowEnd ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = opts.dark ? 0.95 : 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  let interactive = opts.interactive !== false;
  canvas.style.touchAction = interactive ? 'none' : 'pan-y';
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = opts.dark ? 0.35 : 0.55;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
  scene.add(new THREE.HemisphereLight(opts.dark ? '#AFC3CC' : '#FFFFFF', opts.dark ? '#0B1012' : '#B9C6BE', opts.dark ? 0.9 : 1.25));
  const sun = new THREE.DirectionalLight('#FFF6E8', opts.dark ? 1.6 : 2.4);
  sun.castShadow = true;
  const big = !lowEnd && Math.min(screen.width, screen.height) > 700;
  sun.shadow.mapSize.set(big ? 2048 : 1024, big ? 2048 : 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.screenSpacePanning = false;
  controls.enabled = interactive;
  controls.autoRotate = !!opts.autoRotate && !still;
  controls.autoRotateSpeed = 0.55;
  controls.addEventListener('start', () => { controls.autoRotate = false; flight = null; });

  // camera poses: home is where the fly-in ends and "reset view" returns to
  let radius = 50;
  const center = new THREE.Vector3();
  let home = { az: 0.6, el: 0.9, dist: 120 };
  const pose = (az: number, elv: number, dist: number) => {
    camera.position.set(center.x + dist * Math.cos(elv) * Math.sin(az), center.y + dist * Math.sin(elv), center.z + dist * Math.cos(elv) * Math.cos(az));
    controls.target.copy(center);
    camera.lookAt(center);
  };
  let flight: { from: typeof home; to: typeof home; t0: number; ms: number } | null = null;

  function frame(r: number, c: THREE.Vector3, h: typeof home) {
    radius = r;
    center.copy(c);
    const fit = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    home = { ...h, dist: fit * h.dist * (opts.zoom ?? 1) };
    controls.minDistance = r * 0.35;
    controls.maxDistance = fit * 2.6;
    const s = r * 1.4;
    sun.position.set(c.x - s * 0.7, c.y + s * 1.3, c.z + s * 0.55);
    sun.target.position.copy(c);
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    if (opts.fog) scene.fog = new THREE.Fog(opts.fog, fit * 0.9, fit * 2.4);
    camera.near = Math.max(0.1, r / 200);
    camera.far = fit * 8;
    camera.updateProjectionMatrix();
    if (opts.intro !== false && !still) {
      const from = { az: home.az - 1.1, el: 1.35, dist: home.dist * 1.9 };
      pose(from.az, from.el, from.dist);
      flight = { from, to: home, t0: performance.now(), ms: 2200 };
    } else pose(home.az, home.el, home.dist);
    dirty = true;
  }

  // picking: tap = pointer went down and up without dragging
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pickables: THREE.Object3D[] = [];
  let hovered: string | null = null;
  const hit = (e: PointerEvent): string | null => {
    const b = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickables, false).find((i) => i.object.visible && !(i.object.userData.dim));
    return (h?.object.userData.id as string) ?? null;
  };
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = interactive ? { x: e.clientX, y: e.clientY } : null; };
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { const id = hit(e); if (id) opts.onPick?.(id); }
    down = null;
  };
  let hoverEvent: PointerEvent | null = null;
  const onMove = (e: PointerEvent) => { if (interactive && e.pointerType === 'mouse') hoverEvent = e; };
  const onLeave = () => { hoverEvent = null; if (hovered) { hovered = null; api.hover(null); opts.onHover?.(null, 0, 0); } };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  let dirty = true, alive = true, visible = true, raf = 0, last = performance.now();
  const size = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(size);
  ro.observe(el);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }, { rootMargin: '120px' });
  io.observe(el);
  size();

  function loop() {
    cancelAnimationFrame(raf);
    if (!alive || !visible) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (flight) {
      const t = Math.min(1, (now - flight.t0) / flight.ms), k = easeInOut(t);
      const a = flight.from, b = flight.to;
      pose(a.az + (b.az - a.az) * k, a.el + (b.el - a.el) * k, a.dist + (b.dist - a.dist) * k);
      if (t >= 1) flight = null;
      dirty = true;
    } else if (controls.enabled || controls.autoRotate) {
      if (controls.update(dt)) dirty = true;
    }
    if (hoverEvent) {
      const e = hoverEvent;
      hoverEvent = null;
      const id = hit(e);
      if (id !== hovered) { hovered = id; api.hover(id); dirty = true; }
      canvas.style.cursor = id ? 'pointer' : 'grab';
      const b = canvas.getBoundingClientRect();
      opts.onHover?.(id, e.clientX - b.left, e.clientY - b.top);
    }
    if (dirty) { renderer.render(scene, camera); dirty = false; }
  }

  const api = {
    pal, scene, renderer, frame,
    hover: (_id: string | null) => {},
    setPickables(list: THREE.Object3D[]) { pickables = list; },
    /** shadows: false when only colours changed (hover, selection) */
    redraw(shadows = true) { if (shadows) renderer.shadowMap.needsUpdate = true; dirty = true; loop(); },
    orbit(t: number) {
      // sales site: scroll position sweeps the camera round and down towards the ground
      flight = null;
      const k = Math.max(0, Math.min(1, t));
      pose(home.az - 0.9 + k * 1.5, home.el + 0.25 - k * 0.45, home.dist * (1.25 - k * 0.4));
      dirty = true;
    },
    interact(on: boolean) {
      interactive = on;
      controls.enabled = on;
      canvas.style.touchAction = on ? 'none' : 'pan-y';
      if (!on) onLeave();
    },
    reset() { flight = { from: currentPose(), to: home, t0: performance.now(), ms: still ? 1 : 900 }; loop(); },
    get radius() { return radius; },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); });
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  function currentPose() {
    const v = camera.position.clone().sub(controls.target);
    const dist = v.length();
    return { az: Math.atan2(v.x, v.z), el: Math.asin(v.y / dist), dist };
  }
  return api;
}

/** Status materials kept per object so one can glow (selected or hovered) or fade (filtered out). */
function statusLook(pal: Palette) {
  const cols = { available: new THREE.Color(pal.available), booked: new THREE.Color(pal.booked), sold: new THREE.Color(pal.sold) };
  const base = (s: SceneStatus) => cols[s];
  return function paint(m: THREE.MeshStandardMaterial, s: SceneStatus, state: { dim: boolean; sel: boolean; hover: boolean }) {
    m.color.copy(base(s));
    m.transparent = state.dim;
    m.opacity = state.dim ? 0.16 : 1;
    m.depthWrite = !state.dim;
    m.emissive.copy(base(s));
    m.emissiveIntensity = state.sel ? 0.55 : state.hover ? 0.28 : 0;
  };
}

function label(text: string, color: string, px = 64) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `600 ${px}px "Bricolage Grotesque","Segoe UI",system-ui,sans-serif`;
  c.width = Math.ceil(g.measureText(text).width + px);
  c.height = Math.ceil(px * 1.5);
  g.font = `600 ${px}px "Bricolage Grotesque","Segoe UI",system-ui,sans-serif`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(c.width / c.height, 1, 1);
  return s;
}

/** a nearby place's name on a solid pill with a dot in its colour, readable over the ground and the plots */
function placeTag(text: string, dot: string, dark: boolean, px = 56) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `600 ${px}px "IBM Plex Sans","Segoe UI",system-ui,sans-serif`;
  g.font = font;
  const h = Math.ceil(px * 1.7), pad = px * 0.55, d = px * 0.5;
  c.width = Math.ceil(g.measureText(text).width + pad * 3 + d);
  c.height = h;
  g.fillStyle = dark ? 'rgba(20,28,30,.92)' : 'rgba(255,255,255,.94)';
  g.beginPath();
  g.roundRect(0, 0, c.width, h, h / 2);
  g.fill();
  g.fillStyle = dot;
  g.beginPath();
  g.arc(pad + d / 2, h / 2, d / 2, 0, Math.PI * 2);
  g.fill();
  g.font = font;
  g.fillStyle = dark ? '#F2F5F3' : '#14212A';
  g.textBaseline = 'middle';
  g.fillText(text, pad * 2 + d, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  s.scale.set(c.width / c.height, 1, 1);
  return s;
}

/** low-poly trees as two instanced meshes (trunks and crowns) */
function forest(spots: { x: number; z: number; s: number }[], pal: Palette, dark: boolean) {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 1, 5), new THREE.MeshStandardMaterial({ color: dark ? '#4A3A2E' : '#7A5C43', roughness: 0.9 }), spots.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 0), new THREE.MeshStandardMaterial({ color: dark ? '#2E5B3A' : '#5E9E5A', roughness: 0.8, flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tint = new THREE.Color(), r = rng(7);
  spots.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, 0.5 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    trunk.setMatrixAt(i, m);
    q.setFromEuler(new THREE.Euler(0, r() * 6, 0));
    m.compose(new THREE.Vector3(p.x, 1.25 * p.s, p.z), q, new THREE.Vector3(p.s, p.s * (0.9 + r() * 0.4), p.s));
    crown.setMatrixAt(i, m);
    crown.setColorAt(i, tint.set(pal.park).offsetHSL(0, -0.1, (dark ? -0.08 : -0.14) + r() * 0.08));
    q.identity();
  });
  trunk.castShadow = crown.castShadow = true;
  g.add(trunk, crown);
  return g;
}

export function plotScene(el: HTMLElement, layout: LayoutLike, plots: PlotItem[], imageUrl: string | null, opts: SceneOptions = {}): SceneHandle {
  const st = stage(el, opts);
  const { pal, scene } = st;
  const paint = statusLook(pal);
  const k = 100 / Math.max(layout.w, layout.h); // layout units -> world units
  const X = (x: number) => (x - layout.w / 2) * k, Z = (y: number) => (y - layout.h / 2) * k;
  const W = layout.w * k, D = layout.h * k;

  // ground, the layout's own land, and the drawing on it when one was uploaded
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(W, D) * 1.6, 64), new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  const landMat = new THREE.MeshStandardMaterial({ color: pal.land, roughness: 0.95 });
  const land = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.3, D + 1), landMat);
  land.position.y = -0.15;
  land.receiveShadow = true;
  scene.add(ground, land);
  if (imageUrl) {
    new THREE.TextureLoader().load(imageUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = st.renderer.capabilities.getMaxAnisotropy();
      const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: t, roughness: 1, transparent: true, opacity: 0.92 }));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.005;
      top.receiveShadow = true;
      scene.add(top);
      st.redraw();
    });
  }

  const roadMat = new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.85 });
  for (const r of layout.roads) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.w * k, 0.06, r.h * k), roadMat);
    m.position.set(X(r.x + r.w / 2), 0.03, Z(r.y + r.h / 2));
    m.receiveShadow = true;
    scene.add(m);
  }
  for (const d of layout.diag ?? []) {
    const [x1, y1, x2, y2, wd = 20] = d;
    const len = Math.hypot(x2 - x1, y2 - y1) * k;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, wd * k), roadMat);
    m.position.set(X((x1 + x2) / 2), 0.031, Z((y1 + y2) / 2));
    m.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
    m.receiveShadow = true;
    scene.add(m);
  }

  const shapeOf = (poly: [number, number][], inset: number) => {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const sh = new THREE.Shape();
    poly.forEach(([x, y], i) => {
      const px = X(x + (cx - x) * inset), pz = Z(y + (cy - y) * inset);
      if (i) sh.lineTo(px, -pz); else sh.moveTo(px, -pz);
    });
    return sh;
  };
  const slab = (poly: [number, number][], h: number, inset: number, mat: THREE.Material) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(poly, inset), { depth: h, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = m.receiveShadow = true;
    return m;
  };

  // parks: a green pad with trees, plus a ring of trees round the site
  const parkMat = new THREE.MeshStandardMaterial({ color: pal.park, roughness: 0.95 });
  const r = rng(11);
  const spots: { x: number; z: number; s: number }[] = [];
  for (const p of layout.parks) {
    const poly = parsePts(p.pts);
    scene.add(slab(poly, 0.12, 0, parkMat));
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const n = Math.min(60, Math.round(((x1 - x0) * (y1 - y0) * k * k) / 9));
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const pt: [number, number] = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
      if (inside(pt, poly)) { spots.push({ x: X(pt[0]), z: Z(pt[1]), s: 0.7 + r() * 0.5 }); i++; }
    }
  }
  // a belt of trees just outside the site boundary
  const belt = Math.round((W + D) / 1.1);
  for (let i = 0; i < belt; i++) {
    const t = r() * 2 * (W + D), out = 2 + r() * 7;
    let px: number, pz: number;
    if (t < W) { px = t - W / 2; pz = -D / 2 - out; }
    else if (t < W + D) { px = W / 2 + out; pz = t - W - D / 2; }
    else if (t < 2 * W + D) { px = t - W - D - W / 2; pz = D / 2 + out; }
    else { px = -W / 2 - out; pz = t - 2 * W - D - D / 2; }
    spots.push({ x: px, z: pz, s: 0.9 + r() * 1.1 });
  }
  scene.add(forest(spots, pal, !!opts.dark));

  // plots, with a house on each sold plot
  const SLAB = 0.32;
  const houseMat = new THREE.MeshStandardMaterial({ color: pal.house, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.6, flatShading: true });
  type Entry = { item: PlotItem; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; house: THREE.Group | null; cx: number; cz: number; size: number };
  const byId = new Map<string, Entry>();
  const pick: THREE.Object3D[] = [];
  for (const p of plots) {
    const g = p.geom;
    const poly: [number, number][] = g.pts ? parsePts(g.pts) : [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    const inset = Math.min(0.14, 2.2 / Math.max(6, Math.min(g.w, g.h)));
    const mesh = slab(poly, SLAB, inset, mat);
    mesh.userData.id = p.id;
    scene.add(mesh);
    pick.push(mesh);
    const cx = X(poly.reduce((s, q) => s + q[0], 0) / poly.length), cz = Z(poly.reduce((s, q) => s + q[1], 0) / poly.length);
    byId.set(p.id, { item: p, mesh, mat, house: null, cx, cz, size: Math.min(g.w, g.h) * k });
  }
  st.setPickables(pick);

  const house = (e: Entry) => {
    const s = e.size * 0.56, hgt = s * 0.62;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, hgt, s * 0.9), houseMat);
    body.position.y = SLAB + hgt / 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(s * 0.78, s * 0.42, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = SLAB + hgt + s * 0.21;
    roof.scale.z = 0.9;
    body.castShadow = body.receiveShadow = roof.castShadow = true;
    body.userData.id = roof.userData.id = e.item.id;
    grp.add(body, roof);
    grp.position.set(e.cx, 0, e.cz);
    return grp;
  };

  // plot numbers: one transparent sheet just above the slabs. It is redrawn only when the filter hides or shows
  // plots (status changes keep it: white numbers with a dark edge read on every colour, and sit clear of the house)
  const labels = (() => {
    const scale = Math.min(2048, Math.max(1024, Math.max(layout.w, layout.h) * 1.8)) / Math.max(layout.w, layout.h);
    const c = document.createElement('canvas');
    c.width = Math.round(layout.w * scale);
    c.height = Math.round(layout.h * scale);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = st.renderer.capabilities.getMaxAnisotropy();
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = SLAB + 0.05;
    sheet.renderOrder = 2;
    scene.add(sheet);
    let drawn = '';
    return () => {
      const key = [...byId.values()].map((e) => (e.mesh.userData.dim ? 0 : 1)).join('');
      if (key === drawn) return;
      drawn = key;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.fillStyle = '#FFFFFF';
      g.strokeStyle = 'rgba(13,26,19,.55)';
      for (const e of byId.values()) {
        const p = e.item.geom;
        if (e.mesh.userData.dim) continue;
        const fs = Math.max(7, Math.min(15, Math.min(p.w, p.h) * 0.26)) * scale;
        g.font = `600 ${fs}px "IBM Plex Sans","Segoe UI",system-ui,sans-serif`;
        g.lineWidth = fs * 0.22;
        const lx = (p.pts ? p.x + p.w * 0.4 : p.x + p.w / 2) * scale;
        const ly = (p.y + p.h * 0.84) * scale;
        g.strokeText(e.item.label, lx, ly);
        g.fillText(e.item.label, lx, ly);
      }
      tex.needsUpdate = true;
    };
  })();

  let filter: SceneFilter = 'all', selected: string | null = null, hovered: string | null = null;
  // hover and selection only change colours: cheap, no new labels or shadows
  const glow = () => {
    for (const e of byId.values()) paint(e.mat, e.item.status, { dim: !!e.mesh.userData.dim, sel: selected === e.item.id, hover: hovered === e.item.id });
    st.redraw(false);
  };
  const refresh = () => {
    for (const e of byId.values()) {
      const dim = filter !== 'all' && e.item.status !== filter;
      e.mesh.userData.dim = dim;
      paint(e.mat, e.item.status, { dim, sel: selected === e.item.id, hover: hovered === e.item.id });
      const wantHouse = e.item.status === 'sold' && !dim;
      if (wantHouse && !e.house) { e.house = house(e); scene.add(e.house); }
      if (e.house) e.house.visible = wantHouse;
    }
    st.setPickables([...pick, ...[...byId.values()].flatMap((e) => (e.house?.visible ? e.house.children : []))]);
    labels();
    st.redraw();
  };
  st.hover = (id) => { hovered = id; glow(); };
  refresh();
  st.frame(Math.hypot(W, D) / 2, new THREE.Vector3(0, 0, D * 0.06), { az: 0.5, el: 0.9, dist: 1.08 });

  // places around the project: a pin per place on a ring outside the layout, in its real compass direction
  // (north is up on every drawing, so -z), nearer places closer in; the distance is in the label
  const around = new THREE.Group();
  scene.add(around);
  const pinGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 8), headGeo = new THREE.SphereGeometry(1.4, 16, 12);
  const setNearby = (places: NearbyPlace[]) => {
    for (const o of [...around.children]) {
      o.traverse((x) => { const m = (x as THREE.Mesh | THREE.Sprite).material as THREE.MeshStandardMaterial | undefined; m?.map?.dispose(); m?.dispose(); });
      around.remove(o);
    }
    // just outside the layout's edge in that direction, so the pins stay in the opening view; farther = a bit further out
    const S = Math.max(W, D);
    for (const p of places) {
      const b = THREE.MathUtils.degToRad(p.bearing), sx = Math.sin(b), sz = -Math.cos(b);
      const edge = Math.min(Math.abs(sx) > 1e-6 ? W / 2 / Math.abs(sx) : Infinity, Math.abs(sz) > 1e-6 ? D / 2 / Math.abs(sz) : Infinity);
      const r = edge + S * 0.06 + S * 0.2 * Math.sqrt(Math.min(1, p.dist / 5000));
      const x = r * sx, z = r * sz;
      const mat = new THREE.MeshStandardMaterial({ color: NEARBY_COLOR[p.kind], roughness: 0.5 });
      const pin = new THREE.Group();
      const stem = new THREE.Mesh(pinGeo, mat);
      stem.scale.y = 5;
      stem.position.y = 2.5;
      const head = new THREE.Mesh(headGeo, mat);
      head.position.y = 6;
      head.castShadow = true;
      const tag = placeTag(`${p.name} · ${p.dist < 1000 ? `${Math.round(p.dist / 50) * 50} m` : `${(p.dist / 1000).toFixed(1)} km`}`, NEARBY_COLOR[p.kind], !!opts.dark);
      tag.scale.multiplyScalar(4.2);
      tag.position.y = 10.5;
      pin.add(stem, head, tag);
      pin.position.set(x, 0, z);
      around.add(pin);
    }
    st.redraw();
  };

  return {
    setNearby,
    setFilter(f) { filter = f; refresh(); },
    setSelected(id) { selected = id; glow(); },
    setStatuses(items) {
      let changed = false;
      for (const i of items) { const e = byId.get(i.id); if (e && e.item.status !== i.status) { e.item = { ...e.item, status: i.status }; changed = true; } }
      if (changed) refresh();
    },
    setOrbit: st.orbit,
    setInteractive: st.interact,
    resetView: st.reset,
    dispose: st.dispose,
  };
}

export function towerScene(el: HTMLElement, towers: { id: string; name: string }[], flats: FlatItem[], opts: SceneOptions = {}): SceneHandle {
  const st = stage(el, opts);
  const { pal, scene } = st;
  const paint = statusLook(pal);
  const FW = 3.1, FD = 2.9, FH = 1.05, CORE = 1.3, GAP = 0.14, PODIUM = 0.5, SPACING = 7;

  type Entry = { item: FlatItem; mat: THREE.MeshStandardMaterial; mesh: THREE.Mesh };
  const byId = new Map<string, Entry>();
  const pick: THREE.Object3D[] = [];
  const slabMat = new THREE.MeshStandardMaterial({ color: pal.slab, roughness: 0.6 });
  const coreMat = new THREE.MeshStandardMaterial({ color: opts.dark ? '#3A474B' : '#D5DBD7', roughness: 0.8 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: opts.dark ? '#253034' : '#C9D2CC', roughness: 0.9 });

  // lay towers out left to right, each a double-loaded block: half the flats in front, half behind the core
  const plans = towers.map((t) => {
    const mine = flats.filter((f) => f.tower === t.id);
    const floors = [...new Set(mine.map((f) => f.floor))].sort((a, b) => a - b);
    const per = Math.max(1, ...floors.map((fl) => mine.filter((f) => f.floor === fl).length));
    const cols = Math.ceil(per / 2);
    return { t, mine, floors, cols, w: cols * FW, d: FD * 2 + CORE };
  });
  const total = plans.reduce((s, p) => s + p.w, 0) + SPACING * Math.max(0, plans.length - 1);
  let x = -total / 2, tallest = 0;
  for (const p of plans) {
    const ox = x + p.w / 2;
    x += p.w + SPACING;
    const height = PODIUM + p.floors.length * FH;
    tallest = Math.max(tallest, height);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(p.w + 2.4, PODIUM, p.d + 2.4), plinthMat);
    plinth.position.set(ox, PODIUM / 2, 0);
    plinth.receiveShadow = plinth.castShadow = true;
    const core = new THREE.Mesh(new THREE.BoxGeometry(p.w - 0.2, p.floors.length * FH + 0.6, CORE), coreMat);
    core.position.set(ox, PODIUM + (p.floors.length * FH + 0.6) / 2, 0);
    core.castShadow = true;
    scene.add(plinth, core);
    p.floors.forEach((fl, i) => {
      const y = PODIUM + i * FH;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.3, 0.1, p.d + 0.3), slabMat);
      slab.position.set(ox, y + FH, 0);
      slab.castShadow = slab.receiveShadow = true;
      scene.add(slab);
      const row = p.mine.filter((f) => f.floor === fl).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      row.forEach((f, j) => {
        const back = j >= p.cols, c = back ? row.length - 1 - j : j;
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.05 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(FW - GAP, FH - 0.1 - GAP, FD - GAP), mat);
        m.position.set(ox - p.w / 2 + FW * (c + 0.5), y + (FH - 0.1) / 2 + 0.05, (back ? -1 : 1) * (CORE / 2 + FD / 2));
        m.castShadow = m.receiveShadow = true;
        m.userData.id = f.id;
        scene.add(m);
        pick.push(m);
        byId.set(f.id, { item: f, mat, mesh: m });
      });
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.35, 0.7, CORE + 0.8), coreMat);
    roof.position.set(ox, height + 0.1 + 0.35, 0);
    roof.castShadow = true;
    const name = label(p.t.name, pal.label);
    name.scale.multiplyScalar(1.6);
    name.position.set(ox, height + 2.2, 0);
    scene.add(roof, name);
  }
  st.setPickables(pick);

  const span = Math.max(total, 14);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 1.6, 64), new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(span + 8, 0.1, 22), new THREE.MeshStandardMaterial({ color: pal.park, roughness: 0.95 }));
  lawn.position.y = 0.05;
  lawn.receiveShadow = true;
  const drive = new THREE.Mesh(new THREE.BoxGeometry(span + 8, 0.12, 2.6), new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.85 }));
  drive.position.set(0, 0.06, 8.2);
  drive.receiveShadow = true;
  scene.add(ground, lawn, drive);
  const r = rng(5), spots: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < Math.round(span / 1.6); i++) {
    spots.push({ x: -span / 2 - 3 + r() * (span + 6), z: 10.4 + r() * 1.2, s: 0.8 + r() * 0.5 });
    spots.push({ x: -span / 2 - 3 + r() * (span + 6), z: -8 - r() * 3, s: 0.9 + r() * 0.7 });
  }
  scene.add(forest(spots, pal, !!opts.dark));

  let filter: SceneFilter = 'all', selected: string | null = null, hovered: string | null = null;
  const refresh = () => {
    for (const e of byId.values()) {
      const dim = filter !== 'all' && e.item.status !== filter;
      e.mesh.userData.dim = dim;
      paint(e.mat, e.item.status, { dim, sel: selected === e.item.id, hover: hovered === e.item.id });
    }
    st.redraw(false);
  };
  st.hover = (id) => { hovered = id; refresh(); };
  refresh();
  const h = Math.max(tallest, 6);
  st.frame(Math.hypot(span, h, 10) / 2, new THREE.Vector3(0, h * 0.36, 2), { az: 0.55, el: 0.3, dist: 1.2 });

  return {
    setFilter(f) { filter = f; refresh(); },
    setSelected(id) { selected = id; refresh(); },
    setStatuses(items) { for (const i of items) { const e = byId.get(i.id); if (e) e.item = { ...e.item, status: i.status }; } refresh(); },
    setOrbit: st.orbit,
    setInteractive: st.interact,
    resetView: st.reset,
    dispose: st.dispose,
  };
}
