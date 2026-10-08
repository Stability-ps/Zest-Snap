"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMoney } from "@/lib/admin/format";

export type Series = { key: string; label: string; color: string };
/** How values are shown. A name, not a function: server pages can't pass functions to this client component. */
export type ChartFormat = "number" | "money" | "rating";
const FORMATS: Record<ChartFormat, (n: number) => string> = {
  number: (n) => n.toLocaleString("en-US"),
  money: (n) => fmtMoney(n),
  rating: (n) => `${n.toFixed(2)} ★`,
};
type Point = Record<string, string | number | null>;


const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return Math.max(nice * exp, 4);
}

const shortNum = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${+n.toFixed(2)}`);

function dateLabel(d: string, compact = false) {
  const dt = new Date(d + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", compact ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="zadm-legend" style={{ marginBottom: 8 }}>
      {series.map((s) => (
        <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, point, series, format }: { x: number; y: number; point: Point; series: Series[]; format: (n: number) => string }) {
  return (
    <div className="zadm-tip" style={{ left: x, top: y }}>
      <b>{dateLabel(String(point.d))}</b>
      {series.map((s) => (
        <div key={s.key}>
          <i style={{ background: s.color }} />
          {series.length > 1 && <span>{s.label}</span>}
          <strong style={{ marginLeft: "auto", paddingLeft: 10 }}>{point[s.key] === null || point[s.key] === undefined ? "—" : format(Number(point[s.key]))}</strong>
        </div>
      ))}
    </div>
  );
}

function Axes({ w, h, max, data }: { w: number; h: number; max: number; data: Point[] }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((w - PAD.left) / 70))));
  return (
    <>
      <g className="grid">
        {ticks.map((t) => {
          const y = PAD.top + (h - PAD.top - PAD.bottom) * (1 - t);
          return <line key={t} x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} />;
        })}
      </g>
      <g className="axis">
        {ticks.map((t) => {
          const y = PAD.top + (h - PAD.top - PAD.bottom) * (1 - t);
          return <text key={t} x={PAD.left - 8} y={y + 4} textAnchor="end">{shortNum(max * t)}</text>;
        })}
        {data.map((p, i) =>
          i % every === 0 ? (
            <text key={i} x={PAD.left + ((w - PAD.left - PAD.right) * (i + 0.5)) / data.length} y={h - 6} textAnchor="middle">{dateLabel(String(p.d), true)}</text>
          ) : null,
        )}
      </g>
    </>
  );
}

export function LineChart({ data, series, height = 220, format = "number", emptyText = "No activity in this period yet." }: {
  data: Point[];
  series: Series[];
  height?: number;
  format?: ChartFormat;
  emptyText?: string;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(0, ...data.flatMap((p) => series.map((s) => Number(p[s.key]) || 0)))), [data, series]);
  const empty = data.every((p) => series.every((s) => !Number(p[s.key])));
  const iw = Math.max(1, w - PAD.left - PAD.right), ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (iw * (i + 0.5)) / Math.max(1, data.length);
  const y = (v: number) => PAD.top + ih * (1 - v / max);
  return (
    <div>
      <Legend series={series} />
      <div className="zadm-chart" ref={ref} style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor(((e.clientX - r.left - PAD.left) / iw) * data.length);
          setHover(i >= 0 && i < data.length ? i : null);
        }}>
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={`${series.map((s) => s.label).join(", ")} over time`}>
            <Axes w={w} h={height} max={max} data={data} />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="#94a3b8" strokeDasharray="3 3" />}
            {series.map((s) => {
              const pts = data.map((p, i) => (p[s.key] === null || p[s.key] === undefined ? null : `${x(i)},${y(Number(p[s.key]))}`));
              const segments: string[][] = [[]];
              pts.forEach((pt) => (pt ? segments[segments.length - 1].push(pt) : segments.push([])));
              return (
                <g key={s.key}>
                  {segments.filter((seg) => seg.length).map((seg, i) => (
                    <polyline key={i} points={seg.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {data.length <= 45 && data.map((p, i) => p[s.key] === null || p[s.key] === undefined ? null : (
                    <circle key={i} cx={x(i)} cy={y(Number(p[s.key]))} r={hover === i ? 4.5 : 2.5} fill={s.color} stroke="#fff" strokeWidth={hover === i ? 2 : 1} />
                  ))}
                </g>
              );
            })}
          </svg>
        )}
        {empty && w > 0 && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--zadm-muted)", fontSize: 13, fontWeight: 600 }}>{emptyText}</div>}
        {hover !== null && !empty && <Tooltip x={x(hover)} y={Math.min(...series.map((s) => y(Number(data[hover][s.key]) || 0)))} point={data[hover]} series={series} format={FORMATS[format]} />}
      </div>
    </div>
  );
}

/** Stacked columns with a 2px surface gap between segments and rounded data-ends. */
export function BarChart({ data, series, height = 220, format = "number", emptyText = "No activity in this period yet." }: {
  data: Point[];
  series: Series[];
  height?: number;
  format?: ChartFormat;
  emptyText?: string;
}) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((p) => series.reduce((a, s) => a + (Number(p[s.key]) || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const empty = totals.every((t) => !t);
  const iw = Math.max(1, w - PAD.left - PAD.right), ih = height - PAD.top - PAD.bottom;
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(28, band * 0.62));
  return (
    <div>
      <Legend series={series} />
      <div className="zadm-chart" ref={ref} style={{ height }} onMouseLeave={() => setHover(null)}>
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={`${series.map((s) => s.label).join(", ")} per period`}>
            <Axes w={w} h={height} max={max} data={data} />
            {data.map((p, i) => {
              let acc = 0;
              const cx = PAD.left + band * (i + 0.5);
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill={hover === i ? "rgba(148,163,184,0.12)" : "transparent"} />
                  {series.map((s, si) => {
                    const v = Number(p[s.key]) || 0;
                    if (!v) return null;
                    const h = (v / max) * ih;
                    const top = PAD.top + ih - ((acc + v) / max) * ih;
                    acc += v;
                    const isTop = series.slice(si + 1).every((n) => !Number(p[n.key]));
                    const gap = si > 0 ? 2 : 0;
                    return (
                      <rect key={s.key} x={cx - bw / 2} y={top} width={bw} height={Math.max(1, h - gap)} rx={isTop ? Math.min(4, bw / 2) : 0} fill={s.color} />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
        {empty && w > 0 && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--zadm-muted)", fontSize: 13, fontWeight: 600 }}>{emptyText}</div>}
        {hover !== null && !empty && (
          <Tooltip x={PAD.left + band * (hover + 0.5)} y={PAD.top + ih - (totals[hover] / max) * ih} point={data[hover]} series={series} format={FORMATS[format]} />
        )}
      </div>
    </div>
  );
}
