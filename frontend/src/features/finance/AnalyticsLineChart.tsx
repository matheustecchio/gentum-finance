import { useId, useState } from "react";
import { formatMoney } from "../accounts/money";
import { type Bucket, rangeLabel } from "./CashFlowChart";
import type { Row } from "./client";
export function AnalyticsLineChart({
  buckets,
  rows,
  currency,
  kind,
  today,
  comparisonBuckets = [],
  comparisonRows = [],
}: {
  buckets: Bucket[];
  rows: Row[];
  currency: string;
  kind: "income" | "expense";
  today: string;
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
  const change = (i: number) => setIndex(Math.max(0, Math.min(lastIndex, i)));
  if (!buckets.length) return <p>No recorded transactions.</p>;
  return (
    <div className="analytics-line-chart">
      <svg
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          change(
            Math.round(
              ((e.clientX - rect.left) / rect.width) * (buckets.length - 1),
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
        {[35, 90, 145, 205].map((p) => (
          <line
            key={p}
            x1="20"
            x2="880"
            y1={p}
            y2={p}
            className="calendar-grid"
          />
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
        {index !== undefined && (
          <>
            <line
              x1="20"
              x2="880"
              y1={y(index)}
              y2={y(index)}
              stroke="var(--control-border)"
              strokeDasharray="4 5"
            />
            <circle cx={x(index)} cy={y(index)} r="5" fill="var(--text)" />
          </>
        )}
        {buckets.map(
          (b, i) =>
            (i % Math.max(1, Math.ceil(buckets.length / 7)) === 0 ||
              i === buckets.length - 1) && (
              <text
                key={b.start}
                x={x(i)}
                y="240"
                textAnchor="middle"
                className="calendar-label"
              >
                {b.start.slice(5)}
              </text>
            ),
        )}
        <text x="880" y="22" textAnchor="end" className="calendar-scale">
          {formatMoney(maximum.toString(), currency)}
        </text>
      </svg>
      {comparison.length > 0 && (
        <small className="analytics-line-legend">
          White: selected period · Grey: previous period
        </small>
      )}
      <input
        aria-label={`Inspect ${kind} history in ${currency}`}
        type="range"
        min="0"
        max={Math.max(0, lastIndex)}
        value={index ?? Math.max(0, lastIndex)}
        onChange={(e) => change(Number(e.target.value))}
        onFocus={() => change(index ?? lastIndex)}
      />
      {index !== undefined && (
        <output aria-live="polite">
          {rangeLabel(buckets[index].start, buckets[index].end)} ·{" "}
          {formatMoney(values[index], currency)}
        </output>
      )}
    </div>
  );
}
