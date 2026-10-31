import { short } from '../lib/format';

/** Axis label without the rupee sign or trailing zeros: 20 Cr, 2.5 Cr, 40 L, 8k. */
const axis = (v: number) =>
  v >= 1e7 ? `${+(v / 1e7).toFixed(1)} Cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(1)} L` : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

/** Paired monthly bars (money in green, money out red) with a light grid and values on hover. */
export function MonthBars({ data, height = 200 }: { data: { label: string; in: number; out: number }[]; height?: number }) {
  const W = 720, H = height, padL = 64, padB = 26, padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  // a "nice" top for the axis: 1, 2 or 5 times a power of ten
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const top = [1, 2, 5, 10].map((k) => k * p).find((v) => v >= max) ?? max;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / data.length, bw = Math.min(18, slot * 0.32);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Money in and out by month">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={padL - 8} y={y(top * f)} className="axis" textAnchor="end" dominantBaseline="central">{axis(top * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={d.label}>
              <rect x={cx - bw - 1} y={y(d.in)} width={bw} height={Math.max(0, y(0) - y(d.in))} rx="3" className="b-in"><title>{`${d.label}: in ${short(d.in)}`}</title></rect>
              <rect x={cx + 1} y={y(d.out)} width={bw} height={Math.max(0, y(0) - y(d.out))} rx="3" className="b-out"><title>{`${d.label}: out ${short(d.out)}`}</title></rect>
              <text x={cx} y={H - 8} className="axis" textAnchor="middle">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
