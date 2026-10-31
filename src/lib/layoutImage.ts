import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const MAX_SIDE = 2400; // sharp enough to read plot numbers, small enough to upload on mobile data

export type PreparedImage = { blob: Blob; w: number; h: number; previewUrl: string };

function toJpeg(source: CanvasImageSource, sw: number, sh: number): Promise<PreparedImage> {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // PDFs and PNGs with transparency would otherwise turn black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve({ blob, w, h, previewUrl: URL.createObjectURL(blob) }) : reject(new Error('Could not read this picture'))), 'image/jpeg', 0.88));
}

async function pdfFirstPage(file: File): Promise<PreparedImage> {
  // loaded on demand so the main app stays small
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return toJpeg(canvas, canvas.width, canvas.height);
}

/** Turns a camera photo, image file or PDF (first page) into a JPEG ready to upload. */
export async function prepareLayoutFile(file: File): Promise<PreparedImage> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return pdfFirstPage(file);
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo, an image file or a PDF.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return toJpeg(bmp, bmp.width, bmp.height);
}

export async function uploadLayoutImage(orgId: string, img: PreparedImage) {
  const path = `${orgId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('layouts').upload(path, img.blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return path;
}

const urlCache = new Map<string, { url: string; exp: number }>();

/** Short-lived link to a private layout picture (cached so maps don't refetch on every render). */
export function useLayoutImageUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => {
    const c = path ? urlCache.get(path) : null;
    return c && c.exp > Date.now() ? c.url : null;
  });
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    const c = urlCache.get(path);
    if (c && c.exp > Date.now()) { setUrl(c.url); return; }
    let live = true;
    supabase.storage.from('layouts').createSignedUrl(path, 3600).then(({ data }) => {
      if (!data?.signedUrl || !live) return;
      urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
      setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [path]);
  return url;
}
