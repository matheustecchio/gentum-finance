import { useId, useRef, useState } from "react";
import { FlowTooltip, type FlowSelection } from "./FlowTooltip";
import { formatMoney } from "../accounts/money";
import { position } from "./Overview";
import type { Row } from "./client";

export interface Bucket { start: string; end: string }
export function rangeLabel(start: string, end: string) {
  const f = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return f.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}
export function bucketLabel(bucket: Bucket, grouping: string, today: string) {
  const start = new Date(`${bucket.start}T00:00:00Z`);
  const f = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IE", { ...options, timeZone: "UTC" }).format(start);
  let label = grouping === "month" ? f({ month: "long", year: "numeric" })
    : grouping === "year" ? f({ year: "numeric" })
    : grouping === "week" ? new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${bucket.end}T00:00:00Z`))
    : grouping === "quarter" ? `K${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`
    : grouping === "halfYear" ? `S${Math.floor(start.getUTCMonth() / 6) + 1} ${start.getUTCFullYear()}`
    : grouping === "all" ? "All history"
    : grouping === "custom" && bucket.start === bucket.end ? f({ day: "numeric", month: "short" })
    : rangeLabel(bucket.start, bucket.end);
  if (bucket.end === today && grouping !== "custom" && grouping !== "all") label += " · current";
  return label;
}
export function CashFlowChart({ rows, currency, buckets, selected, grouping, today, width, onSelect }: {
  rows: Row[]; currency: string; buckets: Bucket[]; selected: string; grouping: string; today: string; width: number; onSelect: (bucket: Bucket) => void;
}) {
  const entries = buckets.map(b => rows.find(r => r.month === b.start && r.currency === currency) ?? { month: b.start, income: "0", expense: "0", net: "0" });
  const values = entries.flatMap(r => [BigInt(r.income), BigInt(r.expense), BigInt(r.net)]);
  const high = values.reduce((a, b) => a > b ? a : b, 0n);
  const low = values.reduce((a, b) => a < b ? a : b, 0n);
  const zero = 180 - position(0n, low, high, 155);
  const slot = width / Math.max(1, buckets.length);
  const bars = useRef(new Map<string, SVGRectElement>());
  const [inspection, setInspection] = useState<FlowSelection>();
  const id = useId();
  const series = ["income", "expense", "net"] as const;
  function inspect(index: number, key: typeof series[number]) {
    const element = bars.current.get(`${index}:${key}`);
    if (element) setInspection({ element, series: key, value: formatMoney(entries[index][key], currency) });
  }
  return <div className="currency-flow">
    <h3>{currency}</h3>
    <svg width={width} height={240} viewBox={`0 0 ${width} 240`} role="group" aria-label={`Cash flow in ${currency}`}>
      <line x1="8" x2={width - 8} y1={zero} y2={zero} className="zero-line" />
      {buckets.map((bucket, i) => <g key={bucket.start} className={`flow-period ${selected === bucket.start ? "is-selected" : "is-muted"}`} role="button" tabIndex={0}
        aria-label={`Select ${rangeLabel(bucket.start, bucket.end)} in ${currency}`} aria-pressed={selected === bucket.start}
        onClick={e => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const nearest = Math.max(0, Math.min(2, Math.round((x - slot / 2) / 27) + 1));
          if (e.detail > 0) inspect(i, series[nearest]);
          onSelect(bucket);
        }}
        onFocus={e => { e.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" }); inspect(i, "net"); }}
        onBlur={() => setInspection(undefined)}
        onPointerMove={e => { if (e.pointerType === "mouse" && e.buttons === 0) {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const centers = [slot / 2 - 27, slot / 2, slot / 2 + 27];
          const nearest = centers.reduce((best, center, j) => Math.abs(x - center) < Math.abs(x - centers[best]) ? j : best, 0);
          inspect(i, series[nearest]);
        } }}
        onPointerLeave={() => setInspection(undefined)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(bucket); } else if (e.key === "Escape") setInspection(undefined);
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const index = series.indexOf(inspection?.series || "net"); inspect(i, series[(index + (e.key === "ArrowUp" ? 2 : 1)) % 3]); } }}>
        {series.map((key, j) => {
          const value = BigInt(entries[i][key]);
          const y = 180 - position(value, low, high, 155);
          return <rect key={key} ref={element => { if (element) bars.current.set(`${i}:${key}`, element); else bars.current.delete(`${i}:${key}`); }}
            x={i * slot + slot / 2 - 36 + j * 27} y={Math.min(y, zero)} width={18} height={value === 0n ? 2 : Math.max(2, Math.abs(y - zero))} rx={3}
            className={`flow-${key} period-bar`} aria-hidden="true" />;
        })}
        <rect className="period-hit" x={i * slot + 2} y="4" width={slot - 4} height="232" rx="6" fill="transparent" />
        <text x={i * slot + slot / 2} y="214" textAnchor="middle">{bucketLabel(bucket, grouping, today).replace(" · current", "")}</text>
        {bucketLabel(bucket, grouping, today).includes(" · current") && <text className="period-current" x={i * slot + slot / 2} y="232" textAnchor="middle">Through today</text>}
      </g>)}
    </svg>
    {inspection && <FlowTooltip selection={inspection} id={id} layoutKey={`${low}:${high}:${width}`} />}
    <table className="chart-amounts" aria-label={`Cash flow amounts in ${currency}`}><thead><tr><th>Period</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead><tbody>{entries.map((r, i) => <tr key={r.month}><th>{rangeLabel(buckets[i].start, buckets[i].end)}</th>{series.map(key => <td key={key}>{formatMoney(r[key], currency)}</td>)}</tr>)}</tbody></table>
  </div>;
}
