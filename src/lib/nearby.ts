// Places around a project (schools, hospitals, stations, shops) from OpenStreetMap, for the 3D view.
// Only the project's coordinates leave the app; nothing about buyers or the company.

export type NearbyKind = 'school' | 'college' | 'hospital' | 'station' | 'bus' | 'shop';
export interface NearbyPlace { name: string; kind: NearbyKind; /** metres */ dist: number; /** degrees clockwise from north */ bearing: number }

export const NEARBY_LABEL: Record<NearbyKind, string> = {
  school: 'School', college: 'College', hospital: 'Hospital', station: 'Railway station', bus: 'Bus stand', shop: 'Shopping',
};

const RADIUS = 5000;
const PER_KIND = 3;
const CACHE_DAYS = 7;

function kindOf(t: Record<string, string>): NearbyKind | null {
  if (t.amenity === 'school') return 'school';
  if (t.amenity === 'college' || t.amenity === 'university') return 'college';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.railway === 'station') return 'station';
  if (t.amenity === 'bus_station') return 'bus';
  if (t.shop === 'mall' || t.shop === 'supermarket') return 'shop';
  return null;
}

const rad = (d: number) => (d * Math.PI) / 180;
function distBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const dist = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  return { dist, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

// the public OpenStreetMap query servers are free and often busy (429): try the main one, then mirrors
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
type OsmResult = { elements: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };

async function overpass(query: string): Promise<OsmResult | null> {
  for (const url of SERVERS) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 8000);
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: stop.signal });
      // an overloaded server can answer 200 with a "runtime error" remark and no elements
      const json = res.ok ? await res.json() as OsmResult & { remark?: string } : null;
      if (json && !/error/i.test(json.remark ?? '')) return json;
    } catch { /* busy, slow or offline: next server */ } finally { clearTimeout(timer); }
  }
  return null;
}

/** The nearest few named places of each kind within 5 km, cached on the device for a week. Empty on failure:
    the 3D view simply shows the layout on its own. */
export async function nearbyPlaces(lat: number, lng: number): Promise<NearbyPlace[]> {
  const key = `plotskart-nearby-${lat.toFixed(4)},${lng.toFixed(4)}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; places: NearbyPlace[] } | null;
    if (hit && Date.now() - hit.at < CACHE_DAYS * 864e5) return hit.places;
  } catch { /* storage blocked or old entry */ }

  const around = `(around:${RADIUS},${lat},${lng})`;
  const query = `[out:json][timeout:20];(
    nwr["amenity"~"^(school|college|university|hospital|bus_station)$"]["name"]${around};
    nwr["railway"="station"]["name"]${around};
    nwr["shop"~"^(mall|supermarket)$"]["name"]${around};
  );out center tags 300;`;
  try {
    const json = await overpass(query);
    if (!json) return [];
    const all: NearbyPlace[] = [];
    for (const e of json.elements) {
      const t = e.tags ?? {};
      const kind = kindOf(t);
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
      if (!kind || !t.name || la == null || lo == null) continue;
      all.push({ name: t['name:en'] || t.name, kind, ...distBearing(lat, lng, la, lo) });
    }
    all.sort((a, b) => a.dist - b.dist);
    const seen = new Set<string>(), count = new Map<NearbyKind, number>();
    const places = all.filter((p) => {
      if (seen.has(p.name) || (count.get(p.kind) ?? 0) >= PER_KIND) return false;
      seen.add(p.name);
      count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
      return true;
    });
    // an empty answer may be a hiccup; only remember real results
    if (places.length) try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), places })); } catch { /* storage full or blocked */ }
    return places;
  } catch {
    return []; // offline or the map service is busy
  }
}

export const kmText = (m: number) => (m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`);
