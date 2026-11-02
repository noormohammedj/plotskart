import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isNative } from '../lib/native';

/** A light tap under the finger on phones; nothing in browsers. */
export const tap = () => { if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); };
export const cheer = () => { if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {}); };

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts up to `value` (ease-out) whenever it changes. */
export function useCount(value: number, ms = 900) {
  const [v, setV] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

export function Count({ value, fmt = (n) => Math.round(n).toLocaleString('en-IN') }: { value: number; fmt?: (n: number) => string }) {
  return <>{fmt(useCount(value))}</>;
}

/** Progress ring (0..1). Starts empty and fills on mount, like a cycle ring. */
export function Ring({ value, size = 120, stroke = 12, color = '#fff', track, children }: {
  value: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value)))); return () => cancelAnimationFrame(t); }, [value]);
  return (
    <div className="m-ring" style={{ width: size, height: size, color: track ?? color }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="arc" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke={color}
          strokeDasharray={c} strokeDashoffset={c * (1 - shown)} />
      </svg>
      {children && <div className="mid">{children}</div>}
    </div>
  );
}

const AV_COLORS = ['#F2557A', '#7C5CFA', '#16A97F', '#E9970F', '#2E90E6', '#D9469B', '#0FA3B1', '#8A63D2'];
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
export const avColor = (id: string) => AV_COLORS[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV_COLORS.length];

export function Avatar({ id, name, size = 40, crowned }: { id: string; name: string; size?: number; crowned?: boolean }) {
  return (
    <span className={`m-av${crowned ? ' ring' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38, background: avColor(id) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Segmented control with a sliding knob. */
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex(([k]) => k === value));
  return (
    <div className="m-seg" role="tablist">
      <span className="knob" style={{ width: `calc((100% - 8px) / ${options.length})`, transform: `translateX(${i * 100}%)` }} />
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={k === value} className={k === value ? 'on' : ''} onClick={() => { tap(); onChange(k); }}>{l}</button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true"><div className="grab" />{children}</div>
    </>
  );
}

export function Confetti() {
  const colors = ['#F2557A', '#7C5CFA', '#FFB547', '#16A97F', '#2E90E6'];
  return (
    <div className="m-confetti" aria-hidden="true">
      {Array.from({ length: 26 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 9) * 0.08}s` }} />
      ))}
    </div>
  );
}

const P = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  bell: <path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" />,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 5l7 7-7 7" />,
  coin: <><circle cx="12" cy="12" r="8" /><path d="M9.5 9h5M9.5 12h5M12 9c2 0 2 6-1 6l3 3" /></>,
  bank: <path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 9h15" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  stamp: <><path d="M8 14h8l1 4H7zM10 14V9a2 2 0 1 1 4 0v5" /><path d="M5 21h14" /></>,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" />,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.7-1.6-4.8-3.8-5.6" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".8" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  out: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10" />,
  chat: <path d="M4 19l1.5-4A7.5 7.5 0 1 1 9 18.5z" />,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
};
export type IconKey = keyof typeof P;
export const I = ({ n, sw = 2 }: { n: IconKey; sw?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>
);

export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || 'there';
