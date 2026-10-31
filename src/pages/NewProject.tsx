import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { LayoutEditor } from '../components/LayoutEditor';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { blankLayout, fromNew, imageLayout, problems, readLayout, toSave, type EditPlot } from '../lib/editPlots';
import { prepareLayoutFile, uploadLayoutImage } from '../lib/layoutImage';
import { gridLayout, jatwadaSample, type GridSpec } from '../lib/layouts';
import type { Layout } from '../lib/types';
import { isNative, pickLayoutPhoto } from '../lib/native';

type Kind = 'photo' | 'grid' | 'blank' | 'sample';
type Stage = 'pick' | 'reading' | 'edit';

export function NewProject() {
  const { isOwner, profile, rpc, reload, toast } = useData();
  const [kind, setKind] = useState<Kind>('photo');
  const [stage, setStage] = useState<Stage>('pick');
  const [layout, setLayout] = useState<Layout | null>(null);
  const [plots, setPlots] = useState<EditPlot[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locating, setLocating] = useState(false);
  const here = () => {
    if (!navigator.geolocation) return toast('This device cannot share its location');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); setLocating(false); },
      () => { setLocating(false); toast('Could not get your location. Check that Plotskart may use it in the phone settings.'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const [location, setLocation] = useState('');
  const [spec, setSpec] = useState<GridSpec>({ blocks: 4, rowsPerBlock: 6, frontFt: 30, depthFt: 40, mainRoadM: 9, sideRoadM: 6 });
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // generated layouts go straight into the editor; changing the inputs starts them again
  useEffect(() => {
    if (kind === 'photo') return;
    const built = kind === 'sample' ? jatwadaSample() : kind === 'grid' ? gridLayout(spec) : { layout: blankLayout(), plots: [] };
    setLayout(built.layout);
    setPlots(built.plots.map(fromNew));
    setImageUrl(null);
    setNotes(kind === 'blank' ? ['Tap "+ Add plot", then tap the drawing to place each plot.'] : []);
    setStage('edit');
    if (kind === 'sample' && !name) setName('Jatwada Greens');
  }, [kind, spec]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOwner || !profile?.org_id) return <p className="empty">Only the owner can add projects.</p>;

  const choose = (k: Kind) => {
    setKind(k);
    setError(null);
    if (k === 'photo') { setStage('pick'); setLayout(null); setPlots([]); setImageUrl(null); setNotes([]); }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await readLayoutFile(file);
  };
  // phone apps: the camera or gallery through Capacitor, then the same path as a picked file
  const fromPhone = async (source: 'camera' | 'photos') => {
    try { const file = await pickLayoutPhoto(source); if (file) await readLayoutFile(file); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not use this photo.'); }
  };
  const readLayoutFile = async (file: File) => {
    setError(null);
    setStage('reading');
    try {
      const img = await prepareLayoutFile(file);
      const path = await uploadLayoutImage(profile.org_id!, img);
      setImageUrl(img.previewUrl);
      setLayout(imageLayout(path, img.w, img.h));
      try {
        const res = await readLayout(path, img.w, img.h);
        setPlots(res.plots);
        if (res.projectName && !name) setName(res.projectName);
        if (res.location && !location) setLocation(res.location);
        setNotes([
          `Found ${res.plots.length} plots. Check each number and size against your drawing before saving.`,
          ...(res.north !== 'up' && res.north !== 'unknown' ? [`North points ${res.north} on this drawing; facings were set using the north arrow.`] : []),
          ...res.warnings,
        ]);
      } catch (err) {
        // the picture is still useful: the owner can place plots on it by hand
        setPlots([]);
        setNotes([`${err instanceof Error ? err.message : 'Automatic reading failed.'} You can still add plots by hand: tap "+ Add plot", then tap each plot on the picture.`]);
      }
      setStage('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use this file.');
      setStage('pick');
    }
  };

  const num = (k: keyof GridSpec) => ({
    value: spec[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setSpec((s) => ({ ...s, [k]: Math.max(1, +e.target.value || 1) })),
  });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!layout) return toast('Add a layout first.');
    if (!plots.length) return toast('Add at least one plot.');
    const issues = problems(plots);
    if (!issues.ok) return toast(issues.dup.length ? `Plot number used twice: ${issues.dup.join(', ')}` : 'Every plot needs a number and a size.');
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    const id = await rpc<string>('create_project', {
      p: {
        name, location, lat: d.lat || null, lng: d.lng || null, approval: d.approval, launched: d.launched,
        guideline_rate: +d.guideline || 0, sale_rate: +d.rate || 0, layout,
      },
      p_plots: plots.map(toSave),
    }, `Project created with ${plots.length} plots`);
    setBusy(false);
    if (id) {
      await reload();
      go(`/p/${id}`);
    }
  };

  const kinds: [Kind, string][] = [['photo', 'Photo or PDF of layout'], ['grid', 'Regular blocks'], ['blank', 'Blank, add plots myself'], ['sample', 'Jatwada sample']];

  return (
    <div className="stack-v">
      <div><button className="back" onClick={() => go('/projects')}>← All projects</button><h1>Add a project</h1>
        <p className="muted" style={{ marginTop: 6 }}>Selling flats in towers? <button className="linkbtn" onClick={() => go('/projects/new/apartments')}>Set up an apartment project →</button></p></div>
      <form className="f" onSubmit={submit}>
        <h3>Project details</h3>
        <label>Project name<input name="name" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Location / address<input name="location" required value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Village, taluka, district" /></label>
        <label>Latitude (for directions and nearby places)<input name="lat" type="number" step="any" placeholder="19.9530" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
        <label>Longitude<input name="lng" type="number" step="any" placeholder="75.2870" value={lng} onChange={(e) => setLng(e.target.value)} /></label>
        <div className="wide"><button type="button" className="btn sm" disabled={locating} onClick={here}>{locating ? 'Finding you…' : 'Use my current location'}</button> <span className="hint">Standing at the site? This fills in the map position, which also shows schools, hospitals and stations around the layout in 3D.</span></div>
        <label>Approval<input name="approval" placeholder="e.g. DTCP / NA order number" /></label>
        <label>Launched<input name="launched" placeholder="e.g. Jan 2026" /></label>
        <label>Guideline value (₹/ft²)<input name="guideline" type="number" min="0" required /></label>
        <label>Sale price (₹/ft²)<input name="rate" type="number" min="0" required /></label>

        <h3>Layout</h3>
        <div className="wide seg">
          {kinds.map(([k, l]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => choose(k)}>{l}</button>)}
        </div>

        {kind === 'photo' && stage === 'pick' && (
          <div className="wide upload">
            <p>Take a clear photo of the layout drawing from straight above, or upload an image or PDF. Plotskart reads the plot numbers, sizes and facing, and draws them on your picture for you to check.</p>
            <div className="btns">
              <button type="button" className="btn pri" onClick={() => (isNative ? fromPhone('camera') : camera.current?.click())}>Take a photo</button>
              {isNative && <button type="button" className="btn" onClick={() => fromPhone('photos')}>Choose from gallery</button>}
              <button type="button" className="btn" onClick={() => picker.current?.click()}>{isNative ? 'Choose a PDF or file' : 'Upload image or PDF'}</button>
            </div>
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
            <input ref={picker} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={onFile} />
            <p className="hint">For PDFs, the first page is used. Lay the paper flat and fit the whole layout in the photo.</p>
            {error && <p className="neg">{error}</p>}
          </div>
        )}
        {kind === 'photo' && stage === 'reading' && (
          <div className="wide upload"><p><b>Reading your layout…</b></p><p className="muted">This usually takes under a minute. Keep this page open.</p></div>
        )}

        {kind === 'grid' && <>
          <label>Blocks (A, B, C…)<input type="number" min="1" max="26" {...num('blocks')} /></label>
          <label>Plots per side of a block<input type="number" min="1" max="40" {...num('rowsPerBlock')} /></label>
          <label>Plot frontage (ft)<input type="number" min="10" {...num('frontFt')} /></label>
          <label>Plot depth (ft)<input type="number" min="10" {...num('depthFt')} /></label>
          <label>Main road (m)<input type="number" min="3" {...num('mainRoadM')} /></label>
          <label>Side roads (m)<input type="number" min="3" {...num('sideRoadM')} /></label>
          <p className="wide hint" style={{ margin: 0 }}>Changing these numbers redraws the blocks and clears edits made below.</p>
        </>}

        {stage === 'edit' && layout && (
          <div className="wide">
            <LayoutEditor layout={layout} imageUrl={imageUrl} plots={plots} onChange={setPlots} notes={notes} />
            {kind === 'photo' && <button type="button" className="linkbtn" style={{ marginTop: 10 }} onClick={() => choose('photo')}>Use a different photo</button>}
          </div>
        )}
        <div className="wide btns"><button className="btn pri" disabled={busy || stage !== 'edit'}>Create project with {plots.length} plots</button></div>
      </form>
    </div>
  );
}
