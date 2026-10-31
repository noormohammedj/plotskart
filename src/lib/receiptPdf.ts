/* Phone apps: the payment receipt as a one-page PDF, opened in the phone's share sheet (WhatsApp first for most
   people). The page is drawn on a canvas with the app's own fonts, so ₹ and Indian names print correctly, then
   placed in an A4 PDF. Loaded only when someone shares a receipt. */
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type ReceiptRow = [label: string, value: string];
export interface ReceiptData {
  no: string;
  date: string;
  org: string;
  project: string;
  buyer: string;
  amount: string;
  words: string;
  rows: ReceiptRow[];
  recordedBy: string;
}

const W = 1240, H = 1754, M = 96; // A4 at 150 dpi
const INK = '#14212A', MUTED = '#566870', LINE = '#D2DBD7';

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function draw(r: ReceiptData) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const display = (px: number) => `700 ${px}px "Bricolage Grotesque","IBM Plex Sans",sans-serif`;
  const body = (px: number, w = 400) => `${w} ${px}px "IBM Plex Sans","Segoe UI",sans-serif`;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';

  // header: the Plotskart mark, company and project; receipt number and date on the right
  const tile = (x: number, y: number, col: string) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, 26, 26, 6); g.fill(); };
  g.fillStyle = INK; g.beginPath(); g.roundRect(M, M, 84, 84, 18); g.fill();
  tile(M + 15, M + 15, '#3FAE63'); tile(M + 43, M + 15, '#F1C33F'); tile(M + 15, M + 43, '#E2574C'); tile(M + 43, M + 43, '#EEF2EF');
  g.fillStyle = INK; g.font = display(44); g.fillText(r.org, M + 112, M + 40, 620);
  g.fillStyle = MUTED; g.font = body(26); g.fillText(r.project, M + 112, M + 80, 620);
  g.textAlign = 'right';
  g.fillStyle = MUTED; g.font = body(24, 500); g.fillText('Receipt', W - M, M + 20);
  g.fillStyle = INK; g.font = body(34, 600); g.fillText(r.no, W - M, M + 60);
  g.fillStyle = MUTED; g.font = body(26); g.fillText(r.date, W - M, M + 96);
  g.textAlign = 'left';
  g.fillStyle = INK; g.fillRect(M, M + 130, W - 2 * M, 4);

  // amount
  let y = M + 220;
  g.fillStyle = INK; g.font = body(30); g.fillText('Received with thanks from', M, y);
  const lead = g.measureText('Received with thanks from ').width;
  g.font = body(30, 600); g.fillText(r.buyer, M + lead, y, W - 2 * M - lead);
  g.font = body(30); g.fillText('the sum of', M, y + 46);
  g.font = display(104); g.fillText(r.amount, M, y + 170);
  g.fillStyle = MUTED; g.font = `italic ${body(28)}`;
  for (const line of wrap(g, r.words, W - 2 * M)) { g.fillText(line, M, y + 226); y += 40; }

  // details, two columns
  y += 290;
  const colW = (W - 2 * M) / 2;
  r.rows.forEach(([label, value], i) => {
    const wide = i === r.rows.length - 1 && r.rows.length % 2 === 1;
    const x = M + (wide ? 0 : (i % 2) * colW);
    const rowY = y + Math.floor(i / 2) * 120;
    g.fillStyle = LINE; g.fillRect(x, rowY - 44, wide ? W - 2 * M : colW - 24, 2);
    g.fillStyle = MUTED; g.font = body(24, 500); g.fillText(label, x, rowY);
    g.fillStyle = INK; g.font = body(32, 600); g.fillText(value, x, rowY + 46, (wide ? W - 2 * M : colW - 24));
  });

  // footer
  g.fillStyle = MUTED; g.font = body(24); g.fillText(`Recorded by ${r.recordedBy} in Plotskart`, M, H - M - 10);
  g.textAlign = 'center';
  g.fillStyle = INK; g.fillRect(W - M - 330, H - M - 60, 330, 2);
  g.font = body(26); g.fillText('Authorised signatory', W - M - 165, H - M - 10);
  return c;
}

/** Makes the PDF and opens the share sheet. Resolves false if the person closed the sheet without sharing. */
export async function shareReceiptPdf(r: ReceiptData): Promise<boolean> {
  await document.fonts.ready;
  const png = draw(r).toDataURL('image/png');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.addImage(png, 'PNG', 0, 0, 595.28, 841.89);
  pdf.setProperties({ title: `Payment receipt ${r.no}`, creator: 'Plotskart' });
  const data = pdf.output('datauristring').split(',')[1];
  const file = await Filesystem.writeFile({ path: `Receipt-${r.no}.pdf`, data, directory: Directory.Cache });
  try {
    await Share.share({ title: `Payment receipt ${r.no}`, text: `Payment receipt ${r.no} from ${r.org}`, files: [file.uri], dialogTitle: 'Send receipt' });
    return true;
  } catch {
    return false; // share sheet closed
  }
}
