import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { LayoutEditor } from '../components/LayoutEditor';
import { useData } from '../data/DataProvider';
import { go } from '../data/route';
import { fromPlot, imageLayout, problems, toSave, type EditPlot } from '../lib/editPlots';
import { prepareLayoutFile, uploadLayoutImage, useLayoutImageUrl } from '../lib/layoutImage';
import type { Layout } from '../lib/types';
import { isNative, pickLayoutPhoto } from '../lib/native';

/** Owner screen to add, move, resize, renumber and remove plots of an existing project. */
export function EditLayout({ id }: { id: string }) {
  const { projects, plots: all, isOwner, profile, rpc, reload, toast } = useData();
  const pr = projects.find((p) => p.id === id);
  const initial = useMemo(() => all.filter((p) => p.project_id === id).map(fromPlot), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [plots, setPlots] = useState<EditPlot[]>(initial);
  const [layout, setLayout] = useState<Layout | null>(pr?.layout ?? null);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const storedUrl = useLayoutImageUrl(localImage ? null : layout?.image?.path);

  if (!isOwner) return <p className="empty">Only the owner can change layouts.</p>;
  if (!pr || !layout) return <p className="empty">Project not found.</p>;

  const changed = JSON.stringify(plots.map(toSave)) !== JSON.stringify(initial.map(toSave)) || layout !== pr.layout;

  const replacePicture = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await applyPicture(file);
  };
  const fromPhone = async (source: 'camera' | 'photos') => {
    try { const file = await pickLayoutPhoto(source); if (file) await applyPicture(file); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not use this photo.'); }
  };
  const applyPicture = async (file: File) => {
    if (!profile?.org_id) return;
    try {
      const img = await prepareLayoutFile(file);
      const path = await uploadLayoutImage(profile.org_id, img);
      // keep plots where they are relative to the old drawing size
      const sx = img.w / layout.w, sy = img.h / layout.h;
      setPlots((ps) => ps.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy, w: p.w * sx, h: p.h * sy, pts: null })));
      setLayout(imageLayout(path, img.w, img.h));
      setLocalImage(img.previewUrl);
      toast('Picture replaced. Check plot positions, then save.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not use this file.');
    }
  };

  const save = async () => {
    const issues = problems(plots);
    if (!issues.ok) return toast(issues.dup.length ? `Plot number used twice: ${issues.dup.join(', ')}` : 'Every plot needs a number and a size.');
    setBusy(true);
    const n = await rpc<number>('save_layout', { p_project: pr.id, p_layout: layout, p_plots: plots.map(toSave) });
    setBusy(false);
    if (n !== null) {
      toast(`Layout saved: ${n} plots. Team notified.`);
      await reload();
      go(`/p/${pr.id}`);
    }
  };

  return (
    <div className="stack-v">
      <div>
        <button className="back" onClick={() => go(`/p/${pr.id}`)}>← {pr.name}</button>
        <div className="phead">
          <div><h1>Edit layout</h1><p>Add, move, resize or renumber plots. Booked and sold plots keep their customer and payments.</p></div>
          <div className="btns">
            {isNative && <button className="btn" onClick={() => fromPhone('camera')}>Take a photo</button>}
            {isNative && <button className="btn" onClick={() => fromPhone('photos')}>From gallery</button>}
            <button className="btn" onClick={() => picker.current?.click()}>{isNative ? 'Choose a file' : layout.image ? 'Replace picture' : 'Add layout picture'}</button>
            <input ref={picker} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={replacePicture} />
            <button className="btn pri" disabled={busy || !changed} onClick={save}>Save layout</button>
          </div>
        </div>
      </div>
      <LayoutEditor layout={layout} imageUrl={localImage ?? storedUrl} plots={plots} onChange={setPlots} />
    </div>
  );
}
