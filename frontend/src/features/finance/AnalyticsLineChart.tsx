import { useId, useState } from "react";
import { formatMoney } from "../accounts/money";
import { calendarBucketLabel } from "./CalendarFlowChart";
import { type Bucket, rangeLabel } from "./CashFlowChart";
import type { Row } from "./client";
export function AnalyticsLineChart({
  buckets,
  rows,
  currency,
  kind,
  today,
  grouping = "day",
  period = "month",
  width = 900,
  comparisonBuckets = [],
  comparisonRows = [],
}: {
  buckets: Bucket[];
  rows: Row[];
  currency: string;
  kind: "income" | "expense";
  today: string;
  grouping?: string;
  period?: string;
  width?: number;
  comparisonBuckets?: Bucket[];
  comparisonRows?: Row[];
}) {
  const [index, setIndex] = useState<number>();
  const id = useId();
  const key = kind === "income" ? "cumulativeIncome" : "cumulativeExpense";
  let last = "0";
  const values = buckets.map((b) => {
    const row = rows.find(
      (r) => r.month === b.start && r.currency === currency,
    );
    if (row) last = row[key];
    return last;
  });
  let previous = "0";
  const comparison = comparisonBuckets.map((b) => {
    const row = comparisonRows.find(
      (r) => r.month === b.start && r.currency === currency,
    );
    if (row) previous = row[key];
    return previous;
  });
  const maximum = [...values, ...comparison]
    .map(BigInt)
    .reduce((a, b) => (a > b ? a : b), 0n);
  const x = (i: number) => 20 + (i * 860) / Math.max(1, buckets.length - 1);
  const valueY = (value: string) =>
    205 - (maximum ? Number((BigInt(value) * 17000n) / maximum) / 100 : 0);
  const y = (i: number) => valueY(values[i]);
  const points = buckets
    .flatMap((b, i) => (b.start <= today ? [`${x(i)},${y(i)}`] : []))
    .join(" ");
  const lastIndex = buckets.reduce(
    (last, b, i) => (b.start <= today ? i : last),
    0,
  );
  const selected = index === undefined ? undefined : Math.min(index, lastIndex);
  const change = (i: number) => setIndex(Math.max(0, Math.min(lastIndex, i)));
  if (!buckets.length) return <p>No recorded transactions.</p>;
  return (
    <div className="analytics-line-chart">
      <div className="analytics-line-plot">
      <svg
        onPointerLeave={() => setIndex(undefined)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          change(
            Math.round(
              (((e.clientX - rect.left) / rect.width * 900 - 20) / 860) * (buckets.length - 1),
            ),
          );
        }}
        viewBox="0 0 900 250"
        role="img"
        aria-label={`Cumulative ${kind} in ${currency}`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--series-color, var(--assets))" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--series-color, var(--assets))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((step) => (
          <g key={step}>
          <text x="880" y={205 - step * 170 / 3 - 8} textAnchor="end" className="calendar-scale">
            {formatMoney((maximum * BigInt(step) / 3n).toString(), currency)}
          </text>
          <line
            x1="20"
            x2="880"
            y1={205 - step * 170 / 3}
            y2={205 - step * 170 / 3}
            className="calendar-grid"
          />
          </g>
        ))}
        {comparison.length > 0 && (
          <polyline
            className="analytics-comparison-line"
            points={comparison
              .map(
                (value, i) =>
                  `${20 + (i * 860) / Math.max(1, comparison.length - 1)},${valueY(value)}`,
              )
              .join(" ")}
            fill="none"
            stroke="var(--chart-muted)"
            strokeWidth="1.5"
          />
        )}
        <polygon
          points={`20,205 ${points} ${x(lastIndex)},205`}
          fill={`url(#${id})`}
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--series-color, var(--assets))"
          strokeWidth="2"
        />
        {selected !== undefined && (
          <>
            <line
              x1="20"
              x2="880"
              y1={y(selected)}
              y2={y(selected)}
              stroke="var(--control-border)"
              strokeDasharray="4 5"
            />
            <line x1={x(selected)} x2={x(selected)} y1="35" y2="205" className="wealth-guide" />
            <circle cx={x(selected)} cy={y(selected)} r="5" fill="var(--text)" />
          </>
        )}
        {buckets.map(
          (b, i) =>
            (i % Math.max(1, Math.ceil(buckets.length / (width < 600 ? 4 : 7))) === 0 ||
              i === buckets.length - 1) && (
              <text
                key={b.start}
                x={x(i)}
                y="240"
                textAnchor="middle"
                className="calendar-label"
              >
                {calendarBucketLabel(b, grouping, period, width)}
              </text>
            ),
        )}
      </svg>
      {selected !== undefined && (
        <div role="tooltip" className="wealth-tooltip" style={{ left: `clamp(0px, calc(${x(selected) / 9}% - 100px), max(0px, calc(100% - 200px)))` }}>
          <time>{rangeLabel(buckets[selected].start, buckets[selected].end)}</time>
          <strong>Selected: {formatMoney(values[selected], currency)}</strong>
          {comparison[selected] !== undefined && <>
            <span>Previous: {formatMoney(comparison[selected], currency)}</span>
            <time>{rangeLabel(comparisonBuckets[selected].start, comparisonBuckets[selected].end)}</time>
          </>}
        </div>
      )}
      </div>
      {comparison.length > 0 && (
        <small className="analytics-line-legend">
          Colored: selected period · Grey: previous period
        </small>
      )}
      <input
        aria-label={`Inspect ${kind} history in ${currency}`}
        type="range"
        min="0"
        max={Math.max(0, lastIndex)}
        value={selected ?? Math.max(0, lastIndex)}
        onChange={(e) => change(Number(e.target.value))}
        onFocus={() => change(selected ?? lastIndex)}
        onBlur={() => setIndex(undefined)}
        onKeyDown={(e) => { if (e.key === "Escape") setIndex(undefined); }}
      />
      {selected !== undefined && (
        <output aria-live="polite">
          {rangeLabel(buckets[selected].start, buckets[selected].end)} ·{" "}
          {formatMoney(values[selected], currency)}
        </output>
      )}
    </div>
  );
}
