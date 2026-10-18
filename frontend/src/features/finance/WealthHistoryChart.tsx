import { useId, useRef, useState } from "react";
import { formatMoney } from "../accounts/money";
import type { Row } from "./client";

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

// Geometry uses numbers; all values and formatting retain exact integer cents.
export function nearestWealthDay(clientX: number, left: number, width: number) {
  if (width <= 0) return 30;
  return Math.max(
    0,
    Math.min(30, Math.round((((clientX - left) / width) * 600 - 12) / 19.2)),
  );
}
export function WealthHistoryChart({
  wealth,
  today,
  currency,
  methodology,
}: {
  wealth: Row[];
  today: string;
  currency: string;
  methodology?: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState(30);
  const [active, setActive] = useState(false);
  const focused = useRef(false);
  const touching = useRef(false);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  const values = wealth.map((w) => BigInt(w.amount));
  const low = values.reduce((a, b) => (a < b ? a : b), values[0] ?? 0n);
  const high = values.reduce((a, b) => (a > b ? a : b), values[0] ?? 0n);
  const points = Array.from({ length: 31 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    const date = day.toISOString().slice(0, 10);
    const row = wealth.find((w) => w.date === date);
    const height = row
      ? high === low
        ? 47.5
        : Number(((BigInt(row.amount) - low) * 9500n) / (high - low)) / 100
      : 0;
    return {
      date,
      day: day.getUTCDate(),
      row,
      x: 12 + i * 19.2,
      y: 125 - height,
      index: i,
    };
  });
  const segments: (typeof points)[] = [];
  for (const p of points) {
    if (!p.row) continue;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1].index === p.index - 1) last.push(p);
    else segments.push([p]);
  }
  const point = points[selected];
  const value = point.row
    ? formatMoney(point.row.amount, currency)
    : "Unavailable";
  const selectAt = (element: HTMLDivElement, x: number) => {
    const rect = element.getBoundingClientRect();
    setSelected(nearestWealthDay(x, rect.left, rect.width));
    setActive(true);
  };
  if (!wealth.length)
    return <p className="wealth-history-state">No recorded balances yet.</p>;
  if (wealth.length === 1)
    return (
      <p className="wealth-history-state">
        One recorded balance:{" "}
        <time dateTime={wealth[0].date}>{dateLabel(wealth[0].date)}</time> ·{" "}
        {formatMoney(wealth[0].amount, currency)}.
      </p>
    );
  return (
    <>
      <div
        className="wealth-plot"
        role="slider"
        tabIndex={0}
        aria-label="Wealth history day"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={30}
        aria-valuenow={selected}
        aria-valuetext={`${dateLabel(point.date)}: ${value}`}
        aria-describedby={`${id}-help ${id}-method`}
        onFocus={() => {
          focused.current = true;
          setActive(true);
        }}
        onBlur={() => {
          focused.current = false;
          setActive(false);
          touching.current = false;
        }}
        onPointerDown={(e) => {
          touching.current = e.pointerType !== "mouse";
          e.currentTarget.focus({ preventScroll: true });
          selectAt(e.currentTarget, e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || touching.current)
            selectAt(e.currentTarget, e.clientX);
        }}
        onPointerUp={() => {
          touching.current = false;
        }}
        onPointerCancel={() => {
          touching.current = false;
        }}
        onPointerLeave={() => {
          if (!focused.current && !touching.current) setActive(false);
        }}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowLeft" || e.key === "ArrowDown"
              ? -1
              : e.key === "ArrowRight" || e.key === "ArrowUp"
                ? 1
                : 0;
          if (step) {
            e.preventDefault();
            setSelected((i) => Math.max(0, Math.min(30, i + step)));
            setActive(true);
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            setSelected(e.key === "Home" ? 0 : 30);
            setActive(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setActive(false);
          }
        }}
      >
        <svg
          viewBox="0 0 600 140"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#19ba96" stopOpacity=".5" />
              <stop offset="100%" stopColor="#19ba96" stopOpacity="0" />
            </linearGradient>
          </defs>
          {segments.map((segment, i) => {
            const line = segment
              .map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`)
              .join(" ");
            return (
              <g key={i}>
                {segment.length > 1 && (
                  <path
                    d={`${line} L${segment[segment.length - 1].x},135 L${segment[0].x},135 Z`}
                    fill={`url(#${id}-fill)`}
                  />
                )}
                <path
                  d={line}
                  fill="none"
                  stroke="#19ba96"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                {segment.length === 1 && (
                  <circle
                    cx={segment[0].x}
                    cy={segment[0].y}
                    r="3"
                    fill="#19ba96"
                  />
                )}
              </g>
            );
          })}
          {active && (
            <g className="wealth-selection">
              <line
                className="wealth-guide"
                x1={point.x}
                x2={point.x}
                y1="0"
                y2="140"
                vectorEffect="non-scaling-stroke"
              />
              {point.row && (
                <circle cx={point.x} cy={point.y} r="3" fill="#fff" />
              )}
            </g>
          )}
        </svg>
        {active && (
          <div
            role="tooltip"
            className="wealth-tooltip"
            style={{
              left: `clamp(0px, calc(${point.x / 6}% - 100px), max(0px, calc(100% - 200px)))`,
            }}
          >
            <time dateTime={point.date}>{dateLabel(point.date)}</time>
            <strong>{value}</strong>
          </div>
        )}
      </div>
      <div className="wealth-day-labels" aria-hidden="true">
        {points
          .filter((_, i) => i % 5 === 0)
          .map((p) => (
            <span key={p.date}>{p.day}</span>
          ))}
      </div>
      <p id={`${id}-help`} className="wealth-inspection-help">
        Hover, tap or use arrow keys to inspect a day.
      </p>
      <p id={`${id}-method`} className="wealth-methodology">
        {methodology ||
          "Recorded ledger balances. Missing dates are unavailable."}
      </p>
    </>
  );
}
