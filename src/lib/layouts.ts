import type { Dir, Layout, NewPlot } from './types';

type Raw = { label: string; x: number; y: number; w: number; h: number; facing: Dir; corner?: Dir; pts?: string };

const col = (x: number, w: number, facing: Dir, items: [string, number, number][]): Raw[] =>
  items.map(([label, y1, y2]) => ({ label, x, y: y1, w, h: y2 - y1, facing }));

function polyArea(pts: string) {
  const a = pts.split(' ').map((s) => s.split(',').map(Number));
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const [x1, y1] = a[i], [x2, y2] = a[(i + 1) % a.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// Converts drawing geometry (pixels) into plots with real dimensions in feet.
function toPlots(raw: Raw[], ftPerPxX: number, ftPerPxY: number): NewPlot[] {
  return raw.map((o) => {
    const fx = Math.round(o.w * ftPerPxX * 10) / 10;
    const fy = Math.round(o.h * ftPerPxY * 10) / 10;
    const eastWest = o.facing === 'E' || o.facing === 'W';
    const sqft = Math.round(o.pts ? polyArea(o.pts) * ftPerPxX * ftPerPxY : fx * fy);
    return {
      label: o.label,
      geom: { x: o.x, y: o.y, w: o.w, h: o.h, pts: o.pts ?? null },
      front_ft: eastWest ? fy : fx,
      depth_ft: eastWest ? fx : fy,
      sqft,
      facing: o.corner ? [o.facing, o.corner] : [o.facing],
    };
  });
}

/** The Mauje Jatwada layout from the original drawing, traced to scale (0.6 ft per unit). */
export function jatwadaSample(): { layout: Layout; plots: NewPlot[] } {
  const raw: Raw[] = [
    ...col(10, 62, 'W', [['A1', 30, 115], ['A2', 115, 198], ['A3', 198, 282], ['A4', 282, 405]]),
    ...col(72, 63, 'E', [['A11', 30, 115], ['A10', 115, 155], ['A9', 155, 198], ['A8', 198, 240], ['A7', 240, 282], ['A6', 282, 322], ['A5', 322, 405]]),
    ...col(178, 70, 'W', [['A13', 122, 168], ['A14', 168, 212], ['A15', 212, 255], ['A16', 255, 297], ['A17', 297, 340], ['A18', 340, 405]]),
    ...col(248, 65, 'E', [['A24', 122, 168], ['A23', 168, 212], ['A22', 212, 255], ['A21', 255, 297], ['A20', 297, 340], ['A19', 340, 405]]),
    ...col(358, 102, 'W', [['B4', 215, 258], ['B3', 258, 300], ['B2', 300, 342], ['B1', 342, 405]]),
    ...col(460, 105, 'E', [['B5', 30, 97], ['B6', 97, 160], ['B7', 160, 222], ['B8', 222, 285], ['B9', 285, 345], ['B10', 345, 405]]),
    ...col(648, 67, 'W', [['B18', 30, 75], ['B17', 75, 118], ['B16', 118, 160], ['B15', 160, 202], ['B14', 202, 243], ['B13', 243, 285], ['B12', 285, 325], ['B11', 325, 405]]),
    ...col(715, 60, 'E', [['C9', 30, 75], ['C8', 75, 118], ['C7', 118, 160], ['C6', 160, 202], ['C5', 202, 243], ['C4', 243, 285], ['C3', 285, 325], ['C2', 325, 365], ['C1', 365, 405]]),
    ...col(818, 60, 'W', [['C10', 105, 160], ['C11', 160, 210], ['C12', 210, 252], ['C13', 252, 295], ['C14', 295, 345], ['C15', 345, 405]]),
    ...col(878, 60, 'E', [['C21', 105, 160], ['C20', 160, 210], ['C19', 210, 252], ['C18', 252, 295], ['C17', 295, 345], ['C16', 345, 405]]),
    { label: 'C23', x: 980, y: 105, w: 160, h: 190, facing: 'W', pts: '980,105 1040,105 1140,295 980,295' },
    { label: 'C22', x: 980, y: 295, w: 160, h: 110, facing: 'W' },
    ...col(10, 65, 'W', [['D1', 470, 548], ['D2', 548, 630], ['D3', 630, 712]]),
    ...col(75, 63, 'E', [['D8', 470, 548], ['D7', 548, 590], ['D6', 590, 630], ['D5', 630, 672], ['D4', 672, 712]]),
    ...col(183, 72, 'W', [['D9', 470, 512], ['D10', 512, 555], ['D11', 555, 597], ['D12', 597, 650]]),
    ...col(255, 60, 'E', [['D17', 470, 512], ['D16', 512, 555], ['D15', 555, 597], ['D14', 597, 650]]),
    ...col(200, 115, 'S', [['D13', 650, 712]]),
    ...col(360, 102, 'W', [['D18', 470, 542], ['D19', 542, 585], ['D20', 585, 628]]),
    ...col(462, 103, 'E', [['D22', 470, 542], ['D21', 542, 628]]),
    ...col(648, 69, 'W', [['E1', 470, 540], ['E2', 540, 620], ['E3', 620, 712]]),
    ...col(717, 58, 'E', [['E9', 470, 497], ['E8', 497, 540], ['E7', 540, 580], ['E6', 580, 625], ['E5', 625, 668], ['E4', 668, 712]]),
    ...col(818, 60, 'W', [['E10', 465, 505], ['E11', 505, 545], ['E12', 545, 585], ['E13', 585, 628]]),
    ...col(878, 60, 'E', [['E18', 465, 505], ['E17', 505, 545], ['E16', 545, 585], ['E15', 585, 628]]),
    ...col(838, 100, 'S', [['E14', 628, 690]]),
    ...col(985, 77, 'N', [['E19', 465, 595]]),
    ...col(1062, 108, 'N', [['E20', 465, 595]]),
    ...col(1170, 100, 'E', [['E21', 545, 660]]),
  ];
  const corner: Record<string, Dir> = {
    A4: 'S', A5: 'S', A18: 'S', A19: 'S', B1: 'S', B10: 'S', B11: 'S', C1: 'S', C15: 'S', C16: 'S', C22: 'S',
    D1: 'N', D8: 'N', D9: 'N', D17: 'N', D18: 'N', D22: 'N', E1: 'N', E9: 'N', E10: 'N', E18: 'N', E19: 'W', E21: 'N',
  };
  raw.forEach((p) => { if (corner[p.label]) p.corner = corner[p.label]; });

  const roads = [{ x: 0, y: 405, w: 1280, h: 60 }];
  [[135, 178], [313, 358], [565, 648], [775, 818], [938, 980]].forEach(([a, b]) => roads.push({ x: a, y: 20, w: b - a, h: 385 }));
  [[138, 183], [315, 360], [565, 648], [775, 818], [938, 985]].forEach(([a, b]) => roads.push({ x: a, y: 465, w: b - a, h: 250 }));
  const layout: Layout = {
    w: 1280, h: 720, roads,
    diag: [[1022, 20, 1312, 570, 42]],
    parks: [
      { pts: '178,30 313,30 313,122 178,122', t: ['Open space +', 'Electric DP', '296.5 m²'], cx: 245, cy: 66, dp: [190, 108] },
      { pts: '358,30 460,30 460,215 358,215', t: ['Open space +', 'Electric DP', '338.51 m²'], cx: 409, cy: 120, dp: [392, 44] },
      { pts: '818,30 1000,30 1040,105 818,105', t: ['Open space + Electric DP', '316.57 m²'], cx: 925, cy: 62, dp: [840, 92] },
      { pts: '985,595 1170,595 1170,660 985,660', t: ['Open space + Electric DP', '355.6 m²'], cx: 1060, cy: 622, dp: [1150, 614] },
      { pts: '375,628 565,628 565,712 375,712', t: ['Amenity area'], cx: 470, cy: 670 },
    ],
    labels: [
      { t: '9.00 M WIDE ROAD', x: 300, y: 435 }, { t: '9.00 M WIDE ROAD', x: 860, y: 435 },
      { t: '6 M ROAD', x: 156, y: 240, r: -90 }, { t: '6 M ROAD', x: 160, y: 590, r: -90 },
      { t: '6 M ROAD', x: 335, y: 240, r: -90 }, { t: '6 M ROAD', x: 337, y: 590, r: -90 },
      { t: '12 M WIDE ROAD', x: 606, y: 240, r: -90 }, { t: '12 M WIDE ROAD', x: 606, y: 590, r: -90 },
      { t: '6 M ROAD', x: 796, y: 240, r: -90 }, { t: '6 M ROAD', x: 796, y: 590, r: -90 },
      { t: '6 M ROAD', x: 959, y: 240, r: -90 }, { t: '6 M ROAD', x: 961, y: 590, r: -90 },
      { t: '9.00 M WIDE DP ROAD', x: 1150, y: 250, r: 62 },
    ],
    compass: [1240, 140],
  };
  return { layout, plots: toPlots(raw, 0.6, 0.6) };
}

export type GridSpec = {
  blocks: number;        // number of blocks (A, B, C...), laid out in two rows either side of a main road
  rowsPerBlock: number;  // plots down each side of a block
  frontFt: number;       // frontage on the side road
  depthFt: number;
  mainRoadM: number;
  sideRoadM: number;
};

/** A regular layout: blocks of two plot columns back to back, each column facing its own side road. */
export function gridLayout(s: GridSpec): { layout: Layout; plots: NewPlot[] } {
  const PX = 2; // drawing units per foot
  const pw = s.depthFt * PX, ph = s.frontFt * PX;
  const side = Math.max(20, s.sideRoadM * 3.281 * PX), main = Math.max(24, s.mainRoadM * 3.281 * PX);
  const margin = 20, perRow = Math.ceil(s.blocks / 2), rows = s.blocks > 1 ? 2 : 1;
  const blockW = pw * 2, blockH = ph * s.rowsPerBlock;
  const w = margin * 2 + perRow * blockW + (perRow - 1) * side;
  const h = margin * 2 + rows * blockH + (rows - 1) * main;
  const raw: Raw[] = [];
  const roads: Layout['roads'] = [];
  const labels: Layout['labels'] = [];
  for (let b = 0; b < s.blocks; b++) {
    const letter = String.fromCharCode(65 + b);
    const r = b < perRow ? 0 : 1, c = b % perRow;
    const x0 = margin + c * (blockW + side), y0 = margin + r * (blockH + main);
    let n = 1;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < s.rowsPerBlock; i++) {
        const p: Raw = { label: letter + n++, x: x0 + k * pw, y: y0 + i * ph, w: pw, h: ph, facing: k ? 'E' : 'W' };
        if (rows === 2 && r === 0 && i === s.rowsPerBlock - 1) p.corner = 'S';
        if (rows === 2 && r === 1 && i === 0) p.corner = 'N';
        raw.push(p);
      }
    }
  }
  if (rows === 2) {
    roads.push({ x: 0, y: margin + blockH, w, h: main });
    labels.push({ t: `${s.mainRoadM} M ROAD`, x: w / 2, y: margin + blockH + main / 2 });
  }
  for (let c = 1; c < perRow; c++) {
    const x = margin + c * blockW + (c - 1) * side;
    roads.push({ x, y: 0, w: side, h });
    labels.push({ t: `${s.sideRoadM} M ROAD`, x: x + side / 2, y: margin + blockH / 2, r: -90 });
  }
  return { layout: { w, h, roads, diag: [], parks: [], labels, compass: [w - 22, 22] }, plots: toPlots(raw, 1 / PX, 1 / PX) };
}
