// Builds Plotskart_Investor_Plan.pptx from the pricing model's values (model-values.json) and the screenshots in img/.
// Run: node build_deck.js   (pptxgenjs and sharp are loaded from NODE_LIBS)
const path = require('path');
const LIBS = process.env.NODE_LIBS || 'C:/Users/noorm/AppData/Local/Temp/pp-pgtest/node_modules';
const pptxgen = require(`${LIBS}/pptxgenjs`);
const sharp = require(`${LIBS}/sharp`);
const SKILL = 'C:/Users/noorm/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/local-agent-mode-sessions/skills-plugin/a38ea4d4-a3ca-4471-a8df-03c5e3e2cd65/4aa0176a-7c4b-4602-af3c-c640a360fe13/skills/pptx';
const { applyTheme } = require(`${SKILL}/scripts/apply_theme.js`);

const HERE = __dirname;
const IMG = (f) => path.join(HERE, 'img', f);
const OUT = path.join(HERE, '..', 'Plotskart_Investor_Plan.pptx');
const V = require(path.join(HERE, 'model-values.json'));
const v = (sheet, cell) => {
  const x = V[`${sheet.toUpperCase()}!${cell}`];
  if (x === undefined) throw new Error(`missing ${sheet}!${cell}`);
  return x;
};
const col = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// Funding columns: B = Build 1, C = Build 2, D.. = M1..M36
const fcol = (i) => col(1 + i); // i = 0 for Build 1
const row = (r, n = 38) => Array.from({ length: n }, (_, i) => v('Funding', `${fcol(i)}${r}`));

// ---- number formats (Indian)
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const lakh = (n, d = 1) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(d)} L` : Math.round(a).toLocaleString('en-IN');
  return (n < 0 ? '–₹' : '₹') + s;
};

// ---- model figures
const F = {
  ask: v('Funding', 'B74'), burn: v('Funding', 'B75'), runway0: v('Funding', 'B76'),
  leftReal: v('Funding', 'B77'), leftSlow: v('Funding', 'B78'), x36: v('Funding', 'B79'),
  one: v('Funding', 'B57'), build: v('Funding', 'B58'),
};
const SC = ['B', 'C', 'D'].map((c) => ({
  peak: v('Funding', `${c}59`), pos: v('Funding', `${c}60`), pay: v('Funding', `${c}61`),
  rev: [v('Funding', `${c}62`), v('Funding', `${c}63`), v('Funding', `${c}64`)],
  pro: [v('Funding', `${c}65`), v('Funding', `${c}66`), v('Funding', `${c}67`)],
  cash36: v('Funding', `${c}68`), cos36: v('Funding', `${c}69`), mrr36: v('Funding', `${c}70`),
}));
const ROWS = { ideal: { at: 8, ab: 9, rev: 12, cost: 13, net: 14, cum: 15, tr: 17 }, real: { at: 25, ab: 26, rev: 29, cost: 30, net: 31, cum: 32, tr: 34 }, slow: { rev: 46, net: 48, cum: 49, tr: 51 } };
const MC = (r) => v('Monthly Cost', `B${r}`);
const fixedLines = [
  ['Founder / CEO', MC(14)], ['Marketing team', MC(17)], ['Sales team', MC(16)], ['Support team', MC(15)], ['Ads', MC(18)],
  ['Shared workspace (4 seats)', MC(12)], ['CA and accountant', MC(13)],
  ['Hosting, database, tools', MC(6) + MC(7) + MC(8) + MC(9) + MC(10) + MC(11)],
  ['Contingency (10%)', MC(20) - MC(19)],
];
const fixedTotal = MC(20);
const PR = (c, r) => v('Pricing', `${c}${r}`);
const teamVar = PR('C', 16) + PR('C', 17) + PR('C', 18);
const team = { setup: PR('C', 49), month: PR('C', 50), ai: PR('C', 16), msg: PR('C', 17), infra: PR('C', 18), oh: PR('C', 19), cost: PR('C', 20), margin: PR('C', 51), derived: PR('C', 31), derivedSetup: PR('C', 30) };
const contribution = team.month * (1 - 0.02) - teamVar;
const lean = (MC(6) + MC(7) + MC(8) + MC(9) + MC(10) + MC(11) + MC(12) + MC(13) + 100000 + MC(15) + 70000 + 60000 + 20000) * 1.1;
const SU = (r) => v('Startup Costs', `D${r}`);
const startup = [['Office and team setup', SU(45)], ['App work still to build', SU(27)], ['Launch dinners and brand kit', SU(50)], ['Company and legal', SU(13)], ['Vendor accounts and first credits', SU(38)], ['Miscellaneous (10%)', SU(53)]];
const startupTotal = SU(54);

// investor illustration: half of each month's profit paid out after payback, investor holds 60%
function payout(r, share = 0.6, part = 0.5, upTo = 38) {
  const net = row(r.net, upTo), cum = row(r.cum, upTo);
  let paid = 0;
  for (let i = 0; i < upTo; i++) if (cum[i] >= 0 && net[i] > 0) paid += net[i] * part * share;
  return paid;
}
const payIdeal24 = payout(ROWS.ideal, 0.6, 0.5, 26), payIdeal36 = payout(ROWS.ideal), payReal36 = payout(ROWS.real);

// ---- theme
const THEME = {
  name: 'Plotskart',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: { dk1: '14212A', lt1: 'FFFFFF', dk2: '3B4B53', lt2: 'EEF2EF', accent1: '3FAE63', accent2: 'F1C33F', accent3: 'E2574C', accent4: '1F6F8B', accent5: '62737A', accent6: 'B9C7CB', hlink: '1F6F8B', folHlink: '62737A' },
};
const HEX = THEME.colors;

(async () => {
  const dims = {};
  for (const f of require('fs').readdirSync(path.join(HERE, 'img'))) {
    const m = await sharp(IMG(f)).metadata();
    dims[f] = m.width / m.height;
  }
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = 'Plotskart investor plan';
  pres.author = 'Plotskart';
  const C = pres.SchemeColor;
  const W = 13.333;

  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: C.background1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.42, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: C.text1, fontFace: THEME.headFontFace, valign: 'top', align: 'left', margin: 0 }, text: '' } },
      { text: { text: 'Plotskart · Investor plan · October 2026', options: { x: 0.6, y: 6.95, w: 6, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
    ],
    slideNumber: { x: 12.1, y: 6.95, w: 0.6, h: 0.3, fontSize: 10, color: C.accent5, align: 'right' },
  });
  pres.defineSlideMaster({
    title: 'DARK',
    background: { color: C.text1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.42, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: C.background1, fontFace: THEME.headFontFace, valign: 'top', align: 'left', margin: 0 }, text: '' } },
      { text: { text: 'Plotskart · Investor plan · October 2026', options: { x: 0.6, y: 6.95, w: 6, h: 0.3, fontSize: 10, color: C.accent6, margin: 0 } } },
    ],
    slideNumber: { x: 12.1, y: 6.95, w: 0.6, h: 0.3, fontSize: 10, color: C.accent6, align: 'right' },
  });
  pres.defineSlideMaster({ title: 'COVER', background: { color: C.text1 }, objects: [] });

  // ---- helpers
  let n = 0;
  const id = (s) => `${s}-${++n}`;
  const text = (s, t, o) => s.addText(t, { isTextBox: true, margin: 0, fontSize: 15, color: C.text1, valign: 'top', objectName: id('text'), ...o });
  const chips = (s, x, y, size = 0.16) => ['accent1', 'accent2', 'accent3'].forEach((k, i) =>
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + i * (size + 0.06), y, w: size, h: size, rectRadius: 0.03, fill: { color: C[k] }, line: { color: C[k] }, objectName: id('chip') }));
  const kicker = (s, t, dark = false) => { chips(s, 0.6, 0.18); text(s, t.toUpperCase(), { x: 1.3, y: 0.12, w: 9, h: 0.28, fontSize: 11, bold: true, charSpacing: 2, color: dark ? C.accent6 : C.accent5 }); };
  const card = (s, x, y, w, h, fill = C.background2) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: fill }, objectName: id('card') });
  function img(s, f, x, y, w, h, o = {}) {
    const ar = dims[f];
    let iw = w, ih = w / ar;
    if (ih > h) { ih = h; iw = h * ar; }
    const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
    if (o.frame !== false) s.addShape(pres.shapes.RECTANGLE, { x: ix, y: iy, w: iw, h: ih, fill: { color: C.background1 }, line: { color: 'D3DCD8', width: 0.75 }, shadow: { type: 'outer', color: '14212A', opacity: 0.18, blur: 8, offset: 2, angle: 90 }, objectName: id('frame') });
    s.addImage({ path: IMG(f), x: ix, y: iy, w: iw, h: ih, altText: o.alt || f, objectName: id('img') });
    return { x: ix, y: iy, w: iw, h: ih };
  }
  const stat = (s, x, y, w, big, label, color = C.text1, dark = false) => {
    text(s, big, { x, y, w, h: 0.75, fontSize: 36, bold: true, color, fontFace: THEME.headFontFace });
    text(s, label, { x, y: y + 0.78, w, h: 0.6, fontSize: 13, color: dark ? C.accent6 : C.text2 });
  };
  const bullets = (s, items, o) => s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, paraSpaceAfter: 6 } })), { isTextBox: true, margin: 0, fontSize: 15, color: C.text1, valign: 'top', objectName: id('list'), ...o });
  const chartText = { catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', dataLabelFontFace: '+mn-lt', legendFontFace: '+mn-lt', titleFontFace: '+mn-lt', catAxisLabelColor: '3B4B53', valAxisLabelColor: '62737A', catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, dataLabelFontSize: 10, legendFontSize: 11, valGridLine: { color: 'E3EAE6', size: 0.75 }, catGridLine: { style: 'none' } };
  const add = (master, section) => pres.addSlide({ masterName: master, sectionTitle: section });

  // =========================================================== 1. Cover
  pres.addSection({ title: 'Summary' });
  let s = add('COVER', 'Summary');
  chips(s, 0.6, 0.75, 0.3);
  text(s, 'Plotskart', { x: 1.75, y: 0.66, w: 5, h: 0.5, fontSize: 24, bold: true, color: C.background1, fontFace: THEME.headFontFace });
  text(s, 'Every plot.\nEvery rupee.\nIn your pocket.', { x: 0.6, y: 1.55, w: 6.2, h: 2.2, fontSize: 40, bold: true, color: C.background1, fontFace: THEME.headFontFace });
  text(s, 'Investor plan: what it costs, what we need, and when the money comes back', { x: 0.6, y: 3.95, w: 5.8, h: 0.9, fontSize: 18, color: C.accent6 });
  text(s, `Ask ${lakh(F.ask, 0)} · ideal case needs ${lakh(SC[0].peak)} · investment back by ${SC[0].pay}`, { x: 0.6, y: 5.0, w: 6, h: 0.4, fontSize: 15, bold: true, color: C.accent2 });
  text(s, 'Coimbatore · Chennai · Madurai · Dindigul   |   October 2026', { x: 0.6, y: 6.75, w: 7, h: 0.3, fontSize: 11, color: C.accent6 });
  img(s, 'site-top.jpg', 6.9, 1.2, 6.0, 4.9, { alt: 'Plotskart sales website home page' });

  // =========================================================== 2. The ask
  s = add('CONTENT', 'Summary');
  kicker(s, 'The ask in one slide');
  s.addText(`Raise ${lakh(F.ask, 0)}. Use ${lakh(SC[0].peak)}. Back by ${SC[0].pay}`, { placeholder: 'title' });
  const statsAsk = [
    [lakh(F.ask, 0), 'committed by the investor (ideal need + 3 months of fixed costs as buffer)', C.text1],
    [lakh(SC[0].peak), 'actually drawn in the ideal case: startup costs, 2 build months, month 1', C.accent4],
    [SC[0].pos, 'first month with a profit; from here the business pays its own way', C.accent1],
    [SC[0].pay, 'every rupee invested has come back as profit (ideal case)', C.accent1],
  ];
  statsAsk.forEach(([b, l, c], i) => { card(s, 0.6 + i * 3.1, 1.55, 2.85, 2.1); stat(s, 0.85 + i * 3.1, 1.75, 2.45, b, l, c); });
  text(s, 'If sales come slower', { x: 0.6, y: 4.0, w: 6, h: 0.4, fontSize: 18, bold: true });
  s.addTable([
    [{ text: 'Case', options: { bold: true } }, { text: 'Money needed', options: { bold: true } }, { text: 'Self-funding from', options: { bold: true } }, { text: 'Investment back', options: { bold: true } }, { text: 'Cash generated by M36', options: { bold: true } }],
    ['Ideal: 20 Team + 2 Business sales a month', lakh(SC[0].peak), SC[0].pos, SC[0].pay, lakh(SC[0].cash36)],
    ['Realistic: ramps to the same by month 7', lakh(SC[1].peak), SC[1].pos, SC[1].pay, lakh(SC[1].cash36)],
    ['Slow: half the sales', lakh(SC[2].peak), SC[2].pos, SC[2].pay, lakh(SC[2].cash36)],
  ], { x: 0.6, y: 4.45, w: 12.1, colW: [4.3, 1.9, 1.9, 1.9, 2.1], fontSize: 13, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, rowH: 0.42, objectName: id('table') });
  s.addNotes(`The investor commits ${lakh(F.ask, 0)} but only ${lakh(SC[0].peak)} is drawn in the ideal case. The rest is a reserve, released only if sales are slower. ${lakh(F.ask, 0)} covers the realistic case with ${lakh(F.leftReal)} to spare.`);

  // =========================================================== 3. Problem
  pres.addSection({ title: 'Product' });
  s = add('CONTENT', 'Product');
  kicker(s, 'The problem');
  s.addText('Layout owners run crores of sales on paper, Excel and WhatsApp', { placeholder: 'title' });
  img(s, 'jatwada-drawing.jpg', 7.2, 1.5, 5.5, 5.1, { alt: 'A real printed layout drawing' });
  const probs = [
    ['Which plot is free?', 'The printed layout is marked by pen. Sales staff and brokers call the office to check, and two people book the same plot.'],
    ['Who still owes money?', 'Instalments sit in a notebook or Excel. Dues and registration dates slip, and nobody reminds the buyer.'],
    ['Is the project making money?', 'Land, approvals, roads, broker commission and salaries are spread across bank, cash and memory. Profit is a guess.'],
  ];
  probs.forEach(([h, b], i) => {
    s.addShape(pres.shapes.OVAL, { x: 0.6, y: 1.65 + i * 1.65, w: 0.5, h: 0.5, fill: { color: [C.accent3, C.accent2, C.accent1][i] }, line: { color: C.background1 }, objectName: id('dot') });
    text(s, String(i + 1), { x: 0.6, y: 1.72 + i * 1.65, w: 0.5, h: 0.4, fontSize: 16, bold: true, align: 'center', color: i === 1 ? C.text1 : C.background1 });
    text(s, h, { x: 1.35, y: 1.6 + i * 1.65, w: 5.5, h: 0.4, fontSize: 18, bold: true });
    text(s, b, { x: 1.35, y: 2.02 + i * 1.65, w: 5.5, h: 1.0, fontSize: 15, color: C.text2 });
  });

  // =========================================================== 4. AI layout reader
  s = add('DARK', 'Product');
  kicker(s, 'What makes us different', true);
  s.addText('Photo of the drawing in, live colour-coded layout out in 90 seconds', { placeholder: 'title' });
  img(s, 'site-ai.jpg', 5.0, 1.55, 7.7, 4.85, { frame: false, alt: 'AI layout reader section of the website' });
  [['107/107', 'plot numbers read on a real drawing'], ['96%', 'boxes placed right first time'], ['~90 s', 'photo to live map']].forEach(([b, l], i) => stat(s, 0.6, 1.65 + i * 1.55, 4.1, b, l, [C.accent2, C.accent1, C.background1][i], true));
  text(s, 'No competitor reads a layout drawing. Everyone else makes the owner type every plot in.', { x: 0.6, y: 6.25, w: 4.2, h: 0.6, fontSize: 13, color: C.accent6 });

  // =========================================================== 5. Live layout + plot
  s = add('CONTENT', 'Product');
  kicker(s, 'Product tour · sales');
  s.addText('Every plot live for the whole team, with size, facing, vastu and price', { placeholder: 'title' });
  img(s, 'layout.jpg', 0.6, 1.55, 6.0, 4.4, { alt: 'Live colour-coded layout' });
  img(s, 'plot-sheet.jpg', 6.75, 1.55, 6.0, 4.4, { alt: 'Plot details with customer and payments' });
  text(s, 'Green sold, yellow booked, red available. Book or sell from a phone; everyone sees it at once.', { x: 0.6, y: 6.1, w: 6.0, h: 0.6, fontSize: 14, color: C.text2 });
  text(s, 'Each plot: sq ft and cents, road facing, vastu, guideline value, sale price, customer, instalments.', { x: 6.75, y: 6.1, w: 6.0, h: 0.6, fontSize: 14, color: C.text2 });

  // =========================================================== 6. Money
  s = add('CONTENT', 'Product');
  kicker(s, 'Product tour · money');
  s.addText('Project profit, bank and cash, and reports the owner can trust', { placeholder: 'title' });
  img(s, 'finance.jpg', 0.6, 1.55, 3.95, 3.3, { alt: 'Finance by project' });
  img(s, 'bank.jpg', 4.7, 1.55, 3.95, 3.3, { alt: 'Bank and cash accounts' });
  img(s, 'reports.jpg', 8.8, 1.55, 3.95, 3.3, { alt: 'Reports with cash flow chart' });
  [['Profit per project', 'Land, approvals, roads, marketing, commissions and salaries against what buyers paid.'], ['Every rupee in a ledger', 'Bank, credit and cash accounts. Payments, expenses and transfers post themselves.'], ['Reports by Indian FY', 'Month, year or lifetime: cash flow, overdue buyers, team return on cost.']].forEach(([h, b], i) => {
    text(s, h, { x: 0.6 + i * 4.1, y: 5.05, w: 3.95, h: 0.4, fontSize: 16, bold: true });
    text(s, b, { x: 0.6 + i * 4.1, y: 5.45, w: 3.95, h: 1.0, fontSize: 14, color: C.text2 });
  });

  // =========================================================== 7. Team
  s = add('CONTENT', 'Product');
  kicker(s, 'Product tour · team');
  s.addText('Commissions, leaderboard and reminders keep the team selling', { placeholder: 'title' });
  img(s, 'team.jpg', 0.6, 1.55, 3.95, 3.3, { alt: 'Team with commissions and salaries' });
  img(s, 'activity.jpg', 4.7, 1.55, 3.95, 3.3, { alt: 'Team leaderboard and live activity' });
  img(s, 'reminders.jpg', 8.8, 1.55, 3.95, 3.3, { alt: 'Payment and registration reminders' });
  [['Commission your way', 'A % of the sale or ₹ per sq ft, per person. Earned on sale, tracked until paid.'], ['Monthly leaderboard', 'Who booked and sold the most, live. Owners see effort and return per person.'], ['Nothing slips', 'Registration alerts 2 days ahead, payment reminders before each due date, to team and buyer.']].forEach(([h, b], i) => {
    text(s, h, { x: 0.6 + i * 4.1, y: 5.05, w: 3.95, h: 0.4, fontSize: 16, bold: true });
    text(s, b, { x: 0.6 + i * 4.1, y: 5.45, w: 3.95, h: 1.0, fontSize: 14, color: C.text2 });
  });

  // =========================================================== 8. More screens
  s = add('CONTENT', 'Product');
  kicker(s, 'Product tour · everything else');
  s.addText('Receipts, instalments, assets and a layout editor are already built', { placeholder: 'title' });
  [['editor.jpg', 'Layout editor: fix any plot the AI read'], ['blocks.jpg', 'Block-wise view of a project'], ['receipt.jpg', 'Numbered receipt, rupees in words'], ['assets.jpg', 'Company assets and their value'], ['home-dark.jpg', 'Owner home in dark mode'], ['demo-login.jpg', 'One-click live demo for every role']].forEach(([f, cap], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.6 + Math.floor(i / 3) * 2.62;
    img(s, f, x, y, 3.95, 2.1, { alt: cap });
    text(s, cap, { x, y: y + 2.17, w: 3.95, h: 0.35, fontSize: 13, color: C.text2, align: 'center' });
  });

  // =========================================================== 9. Mobile
  s = add('DARK', 'Product');
  kicker(s, 'On the phone', true);
  s.addText('Built for the site visit: Android, iPhone and any browser', { placeholder: 'title' });
  ['m-home.jpg', 'm-layout.jpg', 'm-plot.jpg', 'm-activity.jpg', 'm-reminders.jpg', 'm-finance.jpg'].forEach((f, i) => img(s, f, 0.6 + i * 2.05, 1.6, 1.85, 4.3, { alt: f.replace('.jpg', '') }));
  text(s, 'Sales staff carry a ₹15,000 tablet or their own phone and show buyers the live layout at the site. Owners and accountants work from the office computer. One login per person, four roles.', { x: 0.6, y: 6.1, w: 12.1, h: 0.6, fontSize: 14, color: C.accent6 });

  // =========================================================== 10. Website + demo
  s = add('CONTENT', 'Product');
  kicker(s, 'Already live');
  s.addText('Sales website, pricing and a live demo anyone can try today', { placeholder: 'title' });
  img(s, 'site-features.jpg', 0.6, 1.5, 3.95, 2.5, { alt: 'Website features section' });
  img(s, 'site-money.jpg', 4.7, 1.5, 3.95, 2.5, { alt: 'Website accounts section' });
  img(s, 'site-pricing.jpg', 8.8, 1.5, 3.95, 2.5, { alt: 'Website pricing section' });
  img(s, 'site-demo.jpg', 0.6, 4.2, 3.95, 2.5, { alt: 'Website demo section' });
  card(s, 4.7, 4.2, 8.05, 2.5);
  bullets(s, [
    'plotskart.in: the sales site with plans, launch offer and an enquiry form that alerts us by email',
    'plotskart-n2r.netlify.app/?demo: a private sample company per visitor, in any of the four roles',
    'The app, database, AI reader, reminders and accounts are built. What is left is billing, store releases and WhatsApp/SMS approvals',
  ], { x: 4.95, y: 4.4, w: 7.6, h: 2.2, fontSize: 14 });

  // =========================================================== 11. Competitors
  pres.addSection({ title: 'Market' });
  s = add('CONTENT', 'Market');
  kicker(s, 'Competitor analysis');
  s.addText('Big CRMs and ERPs serve large builders; layout owners make do with Excel', { placeholder: 'title' });
  const hd = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text1 } } });
  const us = (t) => ({ text: t, options: { bold: true, fill: { color: 'E3F3E8' } } });
  s.addTable([
    [hd('Who'), hd('What they have'), hd('What they miss for layout owners'), hd('Price')],
    ['Excel, paper layout, WhatsApp, Tally', 'Free, familiar', 'No live plot status, no reminders, no project profit; errors and double bookings', 'Free'],
    ['Kylas (sales CRM)', 'Leads, pipeline, WhatsApp add-on, unlimited users', 'No plot inventory or layout map, no instalments or project accounts', '₹12,999/mo flat; WhatsApp +₹3,500/mo'],
    ['LeadSquared (CRM)', 'Lead capture, portal integrations, automation', 'Built for big sales teams; 20-user minimum; implementation fees', '₹2,500–6,500 per user/mo; ₹85k–4L setup'],
    ['Sell.Do (real-estate CRM)', 'Leads, inventory (IRIS), bookings, channel partners', 'Apartment-builder focus, 5-user minimum, quote-only pricing', 'Quote; ~$35 per user/mo'],
    ['Farvision / real-estate ERPs', 'Land, legal, construction, sales, accounts (350+ builders)', 'Heavy ERP, months to implement, desktop-first, no AI layout reading', 'Quote; lakhs per year'],
    ['Local custom plot apps', 'A layout map built for one promoter', 'One-off build, no updates or support, no accounts', '₹1–5 L one-time'],
    [us('Plotskart'), us('AI layout from a photo, live map, bookings, instalments, receipts, reminders, commissions, ledger, project P&L'), us('Lead capture from portals and Tamil language still to come'), us(`${inr(team.month)}/mo for 15 users`)],
  ], { x: 0.6, y: 1.65, w: 12.1, colW: [2.6, 3.6, 3.9, 2.0], fontSize: 12, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, valign: 'middle', objectName: id('table') });
  text(s, 'Sources: kylas.io; LeadSquared partner and competitor pages; Sell.Do pricing terms; Capterra (Farvision); vendor listings. Prices are as published or quoted by third parties, October 2026.', { x: 0.6, y: 6.55, w: 12.1, h: 0.35, fontSize: 10, color: C.accent5 });

  // =========================================================== 12. Where we win
  s = add('CONTENT', 'Market');
  kicker(s, 'What we have that they miss');
  s.addText('Made for plotted layouts, priced for a 15-person team', { placeholder: 'title' });
  [
    ['AI reads the layout', 'A photo or PDF becomes the live map in about 90 seconds. Competitors need every plot typed in.', C.accent2],
    ['Plot-first, not lead-first', 'Sq ft and cents, road facing, vastu, guideline value and customer-specific prices on every plot.', C.accent1],
    ['Money end to end', 'Instalments, numbered receipts, bank and cash ledger, expenses, commissions, salaries and project P&L.', C.accent4],
    ['Buyers are reminded', 'WhatsApp + SMS for bookings, instalments and registration dates, included in the plan.', C.accent3],
    ['Live for the whole team', 'Owner, sales, brokers and accountant see one picture with the right permissions, on phone or computer.', C.accent1],
    ['Fraction of the price', `${inr(team.month)} a month for 15 users is about ${inr(team.month / 15)} per user, against ₹867–6,500 per user elsewhere.`, C.accent2],
  ].forEach(([h, b, c], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.7 + Math.floor(i / 3) * 2.45;
    card(s, x, y, 3.95, 2.1);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.25, y: y + 0.28, w: 0.36, h: 0.36, rectRadius: 0.06, fill: { color: c }, line: { color: c }, objectName: id('chip') });
    text(s, h, { x: x + 0.8, y: y + 0.25, w: 3.0, h: 0.45, fontSize: 17, bold: true });
    text(s, b, { x: x + 0.25, y: y + 0.85, w: 3.5, h: 1.4, fontSize: 14, color: C.text2 });
  });

  // =========================================================== 13. Pricing
  s = add('CONTENT', 'Market');
  kicker(s, 'Pricing');
  s.addText('Three plans, launch offer at one-third of the regular price', { placeholder: 'title' });
  const plansP = [
    ['Starter', '3 logins · 2 projects', PR('B', 49), PR('B', 50)],
    ['Team', '15 logins · 7 projects', PR('C', 49), PR('C', 50)],
    ['Business', 'Own brand · 30 logins · 15 projects', PR('D', 49), PR('D', 50)],
  ];
  plansP.forEach(([name, who, setup, month], i) => {
    const x = 0.6 + i * 2.85, best = i === 1;
    card(s, x, 1.55, 2.65, 3.6, best ? C.text1 : C.background2);
    const fg = best ? C.background1 : C.text1, mu = best ? C.accent6 : C.text2;
    text(s, name, { x: x + 0.25, y: 1.75, w: 2.2, h: 0.4, fontSize: 20, bold: true, color: fg });
    text(s, who, { x: x + 0.25, y: 2.15, w: 2.2, h: 0.55, fontSize: 12, color: mu });
    text(s, [{ text: inr(month * 3) + '/mo', options: { strike: 'sngStrike', fontSize: 13, color: mu } }], { x: x + 0.25, y: 2.75, w: 2.2, h: 0.3 });
    text(s, inr(month), { x: x + 0.25, y: 3.05, w: 2.2, h: 0.6, fontSize: 30, bold: true, color: best ? C.accent2 : fg, fontFace: THEME.headFontFace });
    text(s, 'a month', { x: x + 0.25, y: 3.65, w: 2.2, h: 0.3, fontSize: 12, color: mu });
    text(s, [{ text: `+ ${inr(setup)} setup  `, options: { bold: true, color: fg } }, { text: inr(setup * 3), options: { strike: 'sngStrike', color: mu } }], { x: x + 0.25, y: 4.05, w: 2.3, h: 0.35, fontSize: 13 });
    text(s, `Yearly ${inr(month * 10)} (2 months free)`, { x: x + 0.25, y: 4.5, w: 2.3, h: 0.5, fontSize: 12, color: mu });
  });
  s.addChart(pres.charts.BAR, [{ name: '₹ per user per month', labels: ['Plotskart Team', 'Kylas', 'LeadSquared (from)', 'Sell.Do (from)'], values: [Math.round(team.month / 15), Math.round(12999 / 15), 2500, Math.round(34.99 * 96)] }], {
    x: 9.2, y: 1.45, w: 3.55, h: 3.8, barDir: 'bar', chartColors: ['3FAE63'], showTitle: true, title: '₹ per user per month, 15 users', titleFontSize: 12, titleColor: '14212A', showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '₹#,##0', valAxisHidden: true, showLegend: false, catAxisOrientation: 'maxMin', ...chartText, objectName: id('chart'),
  });
  card(s, 0.6, 5.4, 12.15, 1.15);
  text(s, [
    { text: 'Why these prices: ', options: { bold: true } },
    { text: `each is the cost of serving a customer plus a share of the office, founder and support, divided by (1 − 30% margin). With 22 sales a month the cost-based Team price is now ${inr(team.derived)} a month and ${inr(team.derivedSetup)} setup; we launch at ${inr(team.month)} and ${inr(team.setup)} (${Math.round(team.margin * 100)}% margin) to win the first customers, and can move up after the launch offer. All prices exclude 18% GST.` },
  ], { x: 0.85, y: 5.55, w: 11.7, h: 1.1, fontSize: 13, color: C.text1 });

  // =========================================================== 14. Unit economics
  pres.addSection({ title: 'Costs' });
  s = add('CONTENT', 'Costs');
  kicker(s, 'Unit economics · one Team customer');
  s.addText(`Each Team customer pays ${inr(team.month)} a month and costs ${inr(teamVar)} to serve`, { placeholder: 'title' });
  s.addChart(pres.charts.BAR, [{ name: '₹ a month', labels: ['AI layout reads (15)', 'WhatsApp + SMS (1,120 each)', 'Database and hosting', 'Share of office, founder, support', 'Left as margin (before card fee)'], values: [team.ai, team.msg, team.infra, team.oh, team.month - team.cost].map(Math.round) }], {
    x: 0.6, y: 1.5, w: 7.2, h: 4.6, barDir: 'bar', chartColors: ['F1C33F', '1F6F8B', '62737A', 'B9C7CB', '3FAE63'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '₹#,##0', valAxisHidden: true, showLegend: false, catAxisOrientation: 'maxMin', showTitle: true, title: `Where the ${inr(team.month)} a month goes`, titleFontSize: 12, titleColor: '14212A', ...chartText, objectName: id('chart'),
  });
  [[inr(contribution), 'left each month after the costs of serving one customer and the card fee'], [inr(team.setup), 'setup fee, paid once; covers sales, marketing and onboarding'], [`${Math.ceil(fixedTotal / contribution)}`, `paying Team customers cover all fixed costs (${lakh(fixedTotal)} a month) without any setup fees`]].forEach(([b, l], i) => {
    card(s, 8.1, 1.5 + i * 1.6, 4.65, 1.45);
    stat(s, 8.35, 1.6 + i * 1.6, 4.2, b, l, [C.accent1, C.accent4, C.text1][i]);
  });

  // =========================================================== 15. Monthly costs
  s = add('CONTENT', 'Costs');
  kicker(s, 'Operating costs after launch');
  s.addText(`${lakh(fixedTotal)} a month to run the business, people first`, { placeholder: 'title' });
  s.addChart(pres.charts.BAR, [{ name: '₹ lakh a month', labels: fixedLines.map((x) => x[0]), values: fixedLines.map((x) => +(x[1] / 1e5).toFixed(2)) }], {
    x: 0.6, y: 1.5, w: 7.6, h: 5.2, barDir: 'bar', chartColors: ['1F6F8B'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '"₹"0.00" L"', valAxisHidden: true, showLegend: false, catAxisOrientation: 'maxMin', ...chartText, objectName: id('chart'),
  });
  card(s, 8.5, 1.5, 4.25, 5.2);
  text(s, 'What is in it', { x: 8.75, y: 1.7, w: 3.8, h: 0.4, fontSize: 17, bold: true });
  bullets(s, [
    'Shared workspace in Coimbatore: 4 seats at ₹8,000, power and internet included',
    'CA and accountant ₹10,000: ROC filings, GST returns, TDS and books',
    'Founder / CEO ₹2 L from launch; nothing during the 2 build months',
    'Supabase, hosting, email, app stores and tools under ₹10,000 at this size',
    'AI reads, WhatsApp and SMS grow with customers and are costed per customer',
  ], { x: 8.75, y: 2.2, w: 3.85, h: 4.3, fontSize: 14 });

  // =========================================================== 16. Startup costs
  s = add('CONTENT', 'Costs');
  kicker(s, 'One-time startup costs');
  s.addText(`${lakh(startupTotal)} once, before launch`, { placeholder: 'title' });
  s.addChart(pres.charts.BAR, [{ name: '₹ lakh', labels: startup.map((x) => x[0]), values: startup.map((x) => +(x[1] / 1e5).toFixed(2)) }], {
    x: 0.6, y: 1.5, w: 5.6, h: 5.2, barDir: 'bar', chartColors: ['F1C33F'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '"₹"0.00" L"', valAxisHidden: true, showLegend: false, catAxisOrientation: 'maxMin', ...chartText, objectName: id('chart'),
  });
  const SCI = (r) => v('Startup Costs', `D${r}`);
  s.addTable([
    [{ text: 'Item', options: { bold: true } }, { text: '₹', options: { bold: true, align: 'right' } }],
    ['App work left: billing, sign-up, store releases, WhatsApp/SMS approvals, phone sign-in, testing (60 days × ₹6,000)', { text: inr(SCI(16) + SCI(17) + SCI(18) + SCI(19) + SCI(20) + SCI(21) + SCI(22) + SCI(23) + SCI(24)), options: { align: 'right' } }],
    ['Security test ₹60,000 · Mac for iPhone builds ₹1,00,000', { text: inr(SCI(25) + SCI(26)), options: { align: 'right' } }],
    ['Launch dinners: Coimbatore, Chennai, Madurai, Dindigul (4 × ₹50,000) + brand kit', { text: inr(SU(50)), options: { align: 'right' } }],
    ['4 sales tablets ₹60,000 · 3 basic laptops ₹90,000 · hiring ₹40,000 · workspace deposit ₹32,000', { text: inr(SU(45)), options: { align: 'right' } }],
    ['Pvt Ltd registration, trademark (2 classes), terms and privacy policy', { text: inr(SU(13)), options: { align: 'right' } }],
    ['Apple and Google accounts, SMS DLT, first WhatsApp/SMS/AI credits, domains', { text: inr(SU(38)), options: { align: 'right' } }],
    ['Miscellaneous and contingency (10%)', { text: inr(SU(53)), options: { align: 'right' } }],
    [{ text: 'Total', options: { bold: true } }, { text: inr(startupTotal), options: { bold: true, align: 'right' } }],
  ], { x: 6.5, y: 1.5, w: 6.25, colW: [4.95, 1.3], fontSize: 12, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, valign: 'middle', objectName: id('table') });

  // =========================================================== 17. Go to market
  pres.addSection({ title: 'Plan' });
  s = add('CONTENT', 'Plan');
  kicker(s, 'Go-to-market');
  s.addText('Launch in four cities with dinners for layout owners, then 22 sales a month', { placeholder: 'title' });
  ['Coimbatore', 'Madurai', 'Dindigul', 'Chennai'].forEach((c, i) => {
    const x = 0.6 + i * 3.05;
    card(s, x, 1.55, 2.85, 1.65, i === 0 ? C.text1 : C.background2);
    text(s, c, { x: x + 0.25, y: 1.75, w: 2.4, h: 0.45, fontSize: 20, bold: true, color: i === 0 ? C.background1 : C.text1 });
    text(s, i === 0 ? 'Home base, first dinner in launch week' : `Dinner in launch month ${i === 3 ? '2' : '1'}`, { x: x + 0.25, y: 2.25, w: 2.4, h: 0.8, fontSize: 13, color: i === 0 ? C.accent6 : C.text2 });
  });
  const steps = [
    ['Build (2 months)', 'Finish billing and store releases, get WhatsApp and SMS approved, register the company, hire the team.'],
    ['Launch dinners', '40–60 layout owners per city see their own layout go live from a photo, on the spot.'],
    ['Field sales', '4 sales staff with tablets visit sites; brokers and surveyors refer owners for a commission.'],
    ['Steady state', '20 Team + 2 Business sales a month; support loads every layout within 48 hours.'],
  ];
  steps.forEach(([h, b], i) => {
    const x = 0.6 + i * 3.05;
    s.addShape(pres.shapes.OVAL, { x, y: 3.55, w: 0.5, h: 0.5, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: id('dot') });
    text(s, String(i + 1), { x, y: 3.62, w: 0.5, h: 0.4, fontSize: 16, bold: true, align: 'center', color: C.background1 });
    if (i < 3) s.addShape(pres.shapes.LINE, { x: x + 0.6, y: 3.8, w: 2.35, h: 0, line: { color: 'B9C7CB', width: 1.5, dashType: 'dash' }, objectName: id('line') });
    text(s, h, { x, y: 4.2, w: 2.85, h: 0.4, fontSize: 16, bold: true });
    text(s, b, { x, y: 4.6, w: 2.85, h: 1.6, fontSize: 14, color: C.text2 });
  });
  text(s, 'Launch dinners are budgeted at ₹50,000 per city (₹25,000–50,000 range). 5% of customers are assumed to choose the yearly plan.', { x: 0.6, y: 6.35, w: 12.1, h: 0.4, fontSize: 12, color: C.accent5 });

  // =========================================================== 18. Projection
  s = add('CONTENT', 'Plan');
  kicker(s, 'Ideal case · 36 months');
  s.addText(`Revenue passes costs in ${SC[0].pos}; ${lakh(SC[0].rev[0])} in year 1`, { placeholder: 'title' });
  const months = Array.from({ length: 38 }, (_, i) => (i < 2 ? `B${i + 1}` : `M${i - 1}`));
  s.addChart(pres.charts.LINE, [
    { name: 'Revenue', labels: months, values: row(ROWS.ideal.rev).map((x) => +(x / 1e5).toFixed(1)) },
    { name: 'Costs', labels: months, values: row(ROWS.ideal.cost).map((x) => +(x / 1e5).toFixed(1)) },
  ], { x: 0.6, y: 1.5, w: 7.9, h: 5.2, chartColors: ['3FAE63', 'E2574C'], lineSize: 2.5, lineDataSymbol: 'none', showLegend: true, legendPos: 't', showTitle: true, title: '₹ lakh a month (B = build months)', titleFontSize: 12, titleColor: '14212A', valAxisLabelFormatCode: '0', catAxisLabelFrequency: 3, ...chartText, objectName: id('chart') });
  s.addTable([
    [{ text: '', options: {} }, { text: 'Year 1', options: { bold: true, align: 'right' } }, { text: 'Year 2', options: { bold: true, align: 'right' } }, { text: 'Year 3', options: { bold: true, align: 'right' } }],
    ['Revenue', ...SC[0].rev.map((x) => ({ text: lakh(x), options: { align: 'right' } }))],
    ['Profit', ...SC[0].pro.map((x) => ({ text: lakh(x), options: { align: 'right', bold: true, color: x < 0 ? C.accent3 : C.accent1 } }))],
  ], { x: 8.8, y: 1.6, w: 3.95, colW: [1.1, 0.95, 0.95, 0.95], fontSize: 12, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, objectName: id('table') });
  text(s, 'Year 1 profit is after the one-time costs and the two build months.', { x: 8.8, y: 2.95, w: 3.95, h: 0.5, fontSize: 11, color: C.accent5 });
  [[`${SC[0].cos36}`, 'paying companies by month 36'], [lakh(SC[0].mrr36), 'subscription revenue a month by month 36']].forEach(([b, l], i) => { card(s, 8.8, 3.65 + i * 1.55, 3.95, 1.4); stat(s, 9.05, 3.75 + i * 1.55, 3.6, b, l, C.accent4); });

  // =========================================================== 19. Funding schedule
  pres.addSection({ title: 'Investment' });
  s = add('CONTENT', 'Investment');
  kicker(s, 'Which month needs how much');
  s.addText('Money is drawn only until the business funds itself', { placeholder: 'title' });
  const trI = row(ROWS.ideal.tr, 9), trR = row(ROWS.real.tr, 9);
  s.addChart(pres.charts.BAR, [
    { name: 'Ideal', labels: months.slice(0, 9), values: trI.map((x) => +(x / 1e5).toFixed(1)) },
    { name: 'Realistic ramp', labels: months.slice(0, 9), values: trR.map((x) => +(x / 1e5).toFixed(1)) },
  ], { x: 0.6, y: 1.5, w: 7.6, h: 5.2, barDir: 'col', barGrouping: 'clustered', chartColors: ['3FAE63', 'F1C33F'], showLegend: true, legendPos: 't', showTitle: true, title: '₹ lakh drawn each month', titleFontSize: 12, titleColor: '14212A', valAxisLabelFormatCode: '0', ...chartText, objectName: id('chart') });
  const sched = [[{ text: 'Month', options: { bold: true } }, { text: 'Ideal', options: { bold: true, align: 'right' } }, { text: 'Realistic', options: { bold: true, align: 'right' } }]];
  for (let i = 0; i < 9; i++) if (trI[i] > 0 || trR[i] > 0) sched.push([i === 0 ? 'Build 1 (incl. one-time)' : months[i].replace('B2', 'Build 2'), { text: trI[i] > 0 ? lakh(trI[i], 2) : '–', options: { align: 'right' } }, { text: trR[i] > 0 ? lakh(trR[i], 2) : '–', options: { align: 'right' } }]);
  sched.push([{ text: 'Total', options: { bold: true } }, { text: lakh(SC[0].peak, 2), options: { bold: true, align: 'right' } }, { text: lakh(SC[1].peak, 2), options: { bold: true, align: 'right' } }]);
  s.addTable(sched, { x: 8.5, y: 1.5, w: 4.25, colW: [1.95, 1.15, 1.15], fontSize: 11, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, rowH: 0.3, objectName: id('table') });

  // =========================================================== 20. ROI and structure
  s = add('CONTENT', 'Investment');
  kicker(s, 'Return of investment');
  s.addText(`Investment earned back by ${SC[0].pay} (ideal) or ${SC[1].pay} (realistic)`, { placeholder: 'title' });
  s.addChart(pres.charts.LINE, [
    { name: 'Ideal', labels: months, values: row(ROWS.ideal.cum).map((x) => +(x / 1e5).toFixed(1)) },
    { name: 'Realistic', labels: months, values: row(ROWS.real.cum).map((x) => +(x / 1e5).toFixed(1)) },
    { name: 'Slow', labels: months, values: row(ROWS.slow.cum).map((x) => +(x / 1e5).toFixed(1)) },
  ], { x: 0.6, y: 1.5, w: 6.6, h: 5.2, chartColors: ['3FAE63', 'F1C33F', 'E2574C'], lineSize: 2.5, lineDataSymbol: 'none', showLegend: true, legendPos: 't', showTitle: true, title: 'Cash position before investor money, ₹ lakh (above 0 = paid back)', titleFontSize: 12, titleColor: '14212A', valAxisLabelFormatCode: '0', catAxisLabelFrequency: 3, ...chartText, objectName: id('chart') });
  card(s, 7.5, 1.5, 5.25, 5.2);
  text(s, 'How the partnership could work', { x: 7.75, y: 1.7, w: 4.8, h: 0.4, fontSize: 17, bold: true });
  bullets(s, [
    'One Pvt Ltd company with both of you as directors',
    'Investor brings the capital as share capital, drawn month by month as above; the unused reserve stays with the investor',
    'CEO brings the product, technology and daily operations: sweat equity that vests over 4 years, plus salary from launch',
    `Example: investor 60%, CEO 40%. From payback, half of each month's profit is paid out and half kept for growth. The investor then receives about ${lakh(payIdeal24)} by month 24 and ${lakh(payIdeal36)} by month 36 (ideal), or ${lakh(payReal36)} by month 36 (realistic)`,
    'Have a CA draft the shareholder agreement; dividends are taxed in the investor’s hands',
  ], { x: 7.75, y: 2.15, w: 4.8, h: 4.45, fontSize: 13 });

  // =========================================================== 21. Best case to succeed
  pres.addSection({ title: 'Risks' });
  s = add('CONTENT', 'Risks');
  kicker(s, 'Best case to succeed');
  s.addText('What has to go right, and how we will know by month 3', { placeholder: 'title' });
  [
    ['First 20 customers from the launch dinners', 'Show each owner their own layout going live from a photo. Offer the launch price only that week.'],
    ['Layouts live within 48 hours', 'Support loads every project with the AI reader, so customers see value before the first bill.'],
    ['Referral partners', 'Brokers, surveyors and DTCP consultants earn a share of the setup fee for every owner they bring.'],
    ['Stickiness from money features', 'Once instalments, receipts and the ledger run in Plotskart, customers rarely leave.'],
  ].forEach(([h, b], i) => {
    const y = 1.55 + i * 1.25;
    s.addShape(pres.shapes.OVAL, { x: 0.6, y: y + 0.05, w: 0.45, h: 0.45, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: id('dot') });
    text(s, '✓', { x: 0.6, y: y + 0.1, w: 0.45, h: 0.35, fontSize: 15, bold: true, align: 'center', color: C.background1 });
    text(s, h, { x: 1.25, y, w: 6.0, h: 0.4, fontSize: 17, bold: true });
    text(s, b, { x: 1.25, y: y + 0.42, w: 6.0, h: 0.7, fontSize: 14, color: C.text2 });
  });
  card(s, 7.7, 1.55, 5.05, 5.1, C.text1);
  text(s, 'Milestones (ideal case)', { x: 7.95, y: 1.75, w: 4.6, h: 0.4, fontSize: 17, bold: true, color: C.background1 });
  const at = row(ROWS.ideal.at), ab = row(ROWS.ideal.ab);
  const mon = (m) => m.replace(/^M/, 'Month ');
  [[`Month 1`, '22 customers, 4 cities launched'], [mon(SC[0].pos), 'first profitable month'], [`Month 3`, `${at[4] + ab[4]} paying customers`], [mon(SC[0].pay), 'investment earned back'], ['Month 12', `${at[13] + ab[13]} paying customers`], ['Month 36', `${SC[0].cos36} customers, ${lakh(SC[0].mrr36)} a month`]].forEach(([m, t], i) => {
    text(s, m, { x: 7.95, y: 2.3 + i * 0.68, w: 1.5, h: 0.4, fontSize: 15, bold: true, color: C.accent2 });
    text(s, t, { x: 9.5, y: 2.3 + i * 0.68, w: 3.1, h: 0.5, fontSize: 14, color: C.background1 });
  });

  // =========================================================== 22. Fallback
  s = add('CONTENT', 'Risks');
  kicker(s, 'Fallback plan');
  s.addText('If sales are slow, a lean team breaks even at half the size', { placeholder: 'title' });
  card(s, 0.6, 1.55, 3.9, 4.5, 'FBE4E2');
  text(s, 'Warning signs', { x: 0.85, y: 1.75, w: 3.4, h: 0.4, fontSize: 17, bold: true, color: C.accent3 });
  bullets(s, ['Fewer than 40 paying customers by month 3', 'Bank balance below 3 months of fixed costs', 'More than 5% of customers leaving a month', 'Launch dinners converting under 10%'], { x: 0.85, y: 2.25, w: 3.45, h: 4.2, fontSize: 14 });
  card(s, 4.7, 1.55, 4.0, 4.5);
  text(s, 'What we do, in order', { x: 4.95, y: 1.75, w: 3.5, h: 0.4, fontSize: 17, bold: true });
  s.addText([
    'Cut ads to ₹20,000 and marketing to ₹60,000; focus on Coimbatore and Madurai',
    'Pay sales mostly on commission (₹70,000 base)',
    'Founder salary halved to ₹1 L',
    'Push the yearly plan (2 months free) to bring cash forward',
    'Sell services: loading old layouts and payment history, branded apps',
  ].map((t, i, a) => ({ text: t, options: { bullet: { type: 'number' }, breakLine: i < a.length - 1, paraSpaceAfter: 6 } })), { isTextBox: true, x: 4.95, y: 2.25, w: 3.55, h: 4.3, fontSize: 14, color: C.text1, valign: 'top', margin: 0, objectName: id('list') });
  card(s, 8.9, 1.55, 3.85, 4.5, 'E3F3E8');
  text(s, 'Why we can recover', { x: 9.15, y: 1.75, w: 3.4, h: 0.4, fontSize: 17, bold: true, color: C.accent1 });
  stat(s, 9.15, 2.25, 3.4, `${Math.ceil(lean / contribution)}`, `paying Team customers cover the lean costs (${lakh(lean)} a month), against ${Math.ceil(fixedTotal / contribution)} at full costs`, C.text1);
  text(s, `Every customer pays more than it costs to serve, so a smaller team is still profitable. The product is built and the money is drawn monthly, so the most at risk early is the ${lakh(F.one + F.build)} spent before launch.`, { x: 9.15, y: 3.85, w: 3.4, h: 2.6, fontSize: 13, color: C.text2 });

  // =========================================================== 23. Other revenue
  pres.addSection({ title: 'Growth' });
  s = add('CONTENT', 'Growth');
  kicker(s, 'Other revenue streams');
  s.addText('More ways to earn from the same customers and their buyers', { placeholder: 'title' });
  [
    ['Usage top-ups', 'Extra AI layout reads at ₹99 and reminders at ₹1 each.'],
    ['Done-for-you setup', 'Load old layouts, bookings and payment history: ₹5,000–15,000 per project.'],
    ['Project microsite', 'A public live layout for buyers with an enquiry form: ₹1,999 per project a month.'],
    ['Lead generation', 'Run Facebook and Google campaigns for promoters for 15% of their ad spend.'],
    ['Collections', 'UPI payment links on every instalment reminder, sharing the gateway fee.'],
    ['Partner referrals', 'Home loans, legal and registration, surveyors and vastu consultants pay for referrals.'],
    ['Print from the live map', 'Layout brochures, hoardings and site boards designed from the live layout.'],
    ['Branded apps', 'Custom builds for larger developers from ₹3.5 L, plus a yearly maintenance fee.'],
  ].forEach(([h, b], i) => {
    const x = 0.6 + (i % 4) * 3.05, y = 1.7 + Math.floor(i / 4) * 2.5;
    card(s, x, y, 2.85, 2.25);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.25, y: y + 0.27, w: 0.3, h: 0.3, rectRadius: 0.05, fill: { color: [C.accent1, C.accent2, C.accent3, C.accent4][i % 4] }, line: { color: C.background2 }, objectName: id('chip') });
    text(s, h, { x: x + 0.7, y: y + 0.2, w: 2.0, h: 0.45, fontSize: 16, bold: true });
    text(s, b, { x: x + 0.25, y: y + 0.8, w: 2.4, h: 1.45, fontSize: 14, color: C.text2 });
  });

  // =========================================================== 24. Next steps
  s = add('DARK', 'Growth');
  kicker(s, 'Next steps', true);
  s.addText('The next 90 days', { placeholder: 'title' });
  [
    ['Week 1–2', 'Agree the partnership terms; register the Pvt Ltd; open the bank account; file the trademark and DPIIT recognition.'],
    ['Week 2–8', 'Build billing and sign-up; release on Play Store and App Store; WhatsApp templates and SMS DLT approved; hire sales, marketing and support.'],
    ['Week 8–10', 'Launch dinners in Coimbatore, Madurai and Dindigul; first 22 customers live within 48 hours each.'],
    ['Week 10–13', 'Chennai launch; referral partners signed; review the month-3 warning signs and adjust.'],
  ].forEach(([w, t], i) => {
    const x = 0.6 + i * 3.05;
    card(s, x, 1.6, 2.85, 2.9, '1E2F3A');
    text(s, w, { x: x + 0.25, y: 1.8, w: 2.4, h: 0.45, fontSize: 18, bold: true, color: C.accent2 });
    text(s, t, { x: x + 0.25, y: 2.35, w: 2.4, h: 2.8, fontSize: 14, color: C.background1 });
  });
  text(s, `Ask: ${lakh(F.ask, 0)} committed, drawn monthly. Ideal case uses ${lakh(SC[0].peak)}, self-funding from ${SC[0].pos}, investment back by ${SC[0].pay}.`, { x: 0.6, y: 5.65, w: 12.1, h: 0.5, fontSize: 18, bold: true, color: C.background1 });
  text(s, 'Figures come from Plotskart_Pricing_Model.xlsx; every assumption there can be changed and the plan recalculates.', { x: 0.6, y: 6.2, w: 12.1, h: 0.4, fontSize: 12, color: C.accent6 });

  // =========================================================== 25. Assumptions
  pres.addSection({ title: 'Appendix' });
  s = add('CONTENT', 'Appendix');
  kicker(s, 'Appendix');
  s.addText('Key assumptions behind the numbers', { placeholder: 'title' });
  const A = (r) => v('Assumptions', `B${r}`);
  s.addTable([
    [{ text: 'Assumption', options: { bold: true } }, { text: 'Value', options: { bold: true } }, { text: 'Assumption', options: { bold: true } }, { text: 'Value', options: { bold: true } }],
    ['Sales a month (ideal)', '20 Team + 2 Business', 'Customers paying yearly', '5% (10 months for 12)'],
    ['Team size per customer', '10–15 users, costed at 15', 'Projects per customer', '6–7, costed at 7'],
    ['Customers leaving a month', '2%', 'Build months before launch', '2, no founder salary'],
    ['AI layout read', '$0.34 (₹33), 15 a month', 'WhatsApp / SMS', '₹0.145 / ₹0.22 + 18% GST'],
    ['Supabase', 'Pro $25 + compute, scales per 50 customers', 'Exchange rate', '₹96 per $'],
    ['Sales / marketing / support', '₹1 L / ₹1.5 L / ₹60,000 a month', 'Ads', '₹60,000 a month'],
    ['Workspace', '4 seats × ₹8,000', 'CA and accountant', '₹10,000 a month'],
    ['Founder / CEO', '₹2 L a month from launch', 'Contingency', '10% on all costs'],
    ['Payment gateway', '2% of collections', 'Sales incentive', '5% of setup fees'],
    ['Taxes', 'GST and income tax pass through, not modelled', 'Prices', 'As published on the sales site'],
  ], { x: 0.6, y: 1.55, w: 12.1, colW: [2.45, 3.6, 2.45, 3.6], fontSize: 12, color: C.text1, fontFace: THEME.bodyFontFace, border: { type: 'solid', pt: 0.75, color: 'D3DCD8' }, fill: { color: C.background1 }, rowH: 0.38, valign: 'middle', objectName: id('table') });
  text(s, 'Sources: supabase.com/pricing; AiSensy (WhatsApp utility rate); MSG91; Infobip and Fast2SMS (DLT fee); taxaj.com and agileregulatory.com (company registration); IP India fee guides (trademark); measured AI cost on a real 107-plot drawing.', { x: 0.6, y: 6.3, w: 12.1, h: 0.5, fontSize: 10, color: C.accent5 });

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT, 'ask', F.ask, 'ideal', SC[0].peak, SC[0].pos, SC[0].pay, 'payouts', Math.round(payIdeal24), Math.round(payIdeal36), Math.round(payReal36), 'lean', Math.round(lean), Math.ceil(lean / contribution), Math.ceil(fixedTotal / contribution));
})().catch((e) => { console.error(e); process.exit(1); });
