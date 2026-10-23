import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Row } from "./client";
import { type Bucket, rangeLabel } from "./CashFlowChart";
import { FlowTooltip, type FlowSelection } from "./FlowTooltip";
import { formatMoney } from "../accounts/money";
export function calendarBucketLabel(
  bucket: Bucket,
  grouping: string,
  period: string,
  width: number,
) {
  const day = new Date(`${bucket.start}T00:00:00Z`);
  if (grouping === "year") return String(day.getUTCFullYear());
  if (grouping === "month")
    return new Intl.DateTimeFormat("en-IE", {
      month: width >= 760 ? "long" : "short",
      timeZone: "UTC",
    }).format(day);
  if (period === "week")
    return new Intl.DateTimeFormat("en-IE", {
      weekday: width >= 760 ? "long" : "short",
      timeZone: "UTC",
    }).format(day);
  return String(day.getUTCDate());
}
export function CalendarFlowChart({
  rows,
  currency,
  buckets,
  grouping,
  period,
  today,
  width,
  selected,
  onSelect,
  focusSelection,
  mode = "cash",
}: {
  rows: Row[];
  currency: string;
  buckets: Bucket[];
  grouping: string;
  period: string;
  today: string;
  width: number;
  selected?: string;
  onSelect?: (start: string, series: "income" | "expense") => void;
  focusSelection?: string;
  mode?: "cash" | "income" | "expense";
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (focusSelection)
      root.current
        ?.querySelector<SVGRectElement>(`[data-focus="${focusSelection}"]`)
        ?.focus({ preventScroll: true });
  }, [focusSelection]);
  const [inspection, setInspection] = useState<FlowSelection>();
  const id = useId();
  const entries = buckets.map(
    (b) =>
      rows.find((r) => r.month === b.start && r.currency === currency) || {
        income: "0",
        expense: "0",
      },
  );
  const maximum = entries
    .flatMap((r) => [BigInt(r.income), BigInt(r.expense)])
    .reduce((a, b) => (a > b ? a : b), 0n);
  const size = Math.max(280, width);
  const slot = (size - 24) / Math.max(1, buckets.length);
  const bar = Math.min(22, slot * 0.29);
  const labelEvery =
    grouping === "day" && period !== "week"
      ? Math.max(1, Math.ceil(buckets.length / Math.max(1, size / 40)))
      : 1;
  const clearInspection = (element: SVGRectElement) =>
    setInspection((old) => (old?.element === element ? undefined : old));
  const inspect = (
    element: SVGRectElement,
    value: string,
    series: "income" | "expense",
  ) => setInspection({ element, value: formatMoney(value, currency), series });
  return (
    <div ref={root} className={`calendar-currency-chart mode-${mode}`}>
      <svg
        viewBox={`0 0 ${size} 260`}
        role="group"
        aria-label={`Cash flow in ${currency}`}
      >
        {[35, 85, 135, 195].map((y) => (
          <line
            key={y}
            x1="12"
            x2={size - 12}
            y1={y}
            y2={y}
            className="calendar-grid"
          />
        ))}
        {maximum > 0n && (
          <text
            x={size - 12}
            y="22"
            textAnchor="end"
            className="calendar-scale"
          >
            {formatMoney(maximum.toString(), currency)}
          </text>
        )}
        {buckets.map((bucket, i) => (
          <g
            className={`calendar-slot ${bucket.start > today ? "is-future" : ""} ${selected && selected !== bucket.start ? "is-muted" : ""}`}
            key={bucket.start}
          >
            {(
              (mode === "cash" ? ["income", "expense"] : [mode]) as (
                | "income"
                | "expense"
              )[]
            ).map((series, j) => {
              const value = entries[i][series];
              const height =
                maximum === 0n
                  ? 0
                  : Number((BigInt(value) * 15500n) / maximum) / 100;
              const label = `${rangeLabel(bucket.start, bucket.end)} ${series === "income" ? "Income" : "Expenses"}: ${formatMoney(value, currency)}`;
              return (
                <g key={series}>
                  <rect
                    x={12 + slot * (i + 0.5) + (j - 1) * (bar + 2)}
                    y={195 - height}
                    width={bar}
                    height={height}
                    rx="3"
                    className={`flow-${series} calendar-bar`}
                    aria-hidden="true"
                  />
                  <rect
                    x={12 + slot * (i + 0.5) + (j - 1) * (bar + 2) - 1}
                    y="30"
                    width={bar + 2}
                    height="165"
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    data-focus={`${currency}:${bucket.start}:${series}`}
                    aria-describedby={
                      inspection?.element?.getAttribute("aria-label") === label
                        ? id
                        : undefined
                    }
                    onFocus={(e) => inspect(e.currentTarget, value, series)}
                    onBlur={(e) => clearInspection(e.currentTarget)}
                    onPointerEnter={(e) => {
                      if (
                        e.pointerType === "mouse" &&
                        !(
                          document.activeElement instanceof SVGElement &&
                          document.activeElement.getAttribute("role") ===
                            "button" &&
                          document.activeElement !== e.currentTarget
                        )
                      )
                        inspect(e.currentTarget, value, series);
                    }}
                    onPointerLeave={(e) => {
                      if (document.activeElement !== e.currentTarget)
                        clearInspection(e.currentTarget);
                    }}
                    aria-pressed={selected === bucket.start}
                    onClick={(e) => {
                      inspect(e.currentTarget, value, series);
                      if (bucket.start <= today)
                        onSelect?.(bucket.start, series);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setInspection(undefined);
                      } else if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inspect(e.currentTarget, value, series);
                        if (bucket.start <= today)
                          onSelect?.(bucket.start, series);
                      }
                    }}
                  />
                </g>
              );
            })}
            {(i % labelEvery === 0 || i === buckets.length - 1) && (
              <text
                x={12 + slot * (i + 0.5)}
                y="224"
                textAnchor="middle"
                className="calendar-label"
                style={{
                  fontSize: buckets.length === 12 && size < 760 ? 10 : 12,
                }}
              >
                {calendarBucketLabel(bucket, grouping, period, size)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {inspection && (
        <FlowTooltip
          id={id}
          selection={inspection}
          layoutKey={`${maximum}:${size}`}
        />
      )}
      <table className="chart-amounts" aria-label={`Cash flow amounts in ${currency}`}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Money In</th>
            <th>Money Out</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b.start}>
              <th>{rangeLabel(b.start, b.end)}</th>
              <td>{formatMoney(entries[i].income, currency)}</td>
              <td>{formatMoney(entries[i].expense, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
