import { useEffect, useId, useRef, useState } from "react";
import { formatMoney } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";
import "./overview.css";

export interface OverviewData {
  change30?: string;
  currency: string;
  today: string;
  wealth: Row[];
  flows: Row[];
  rateDate: string;
  rateError: string;
  converted: boolean;
}
export function shiftMonth(month: string, count: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}
// Numbers below are SVG coordinates only. Financial values stay integer cents.
export function position(
  value: bigint,
  low: bigint,
  high: bigint,
  height = 150,
): number {
  return high === low
    ? height / 2
    : Number(((value - low) * BigInt(height * 100)) / (high - low)) / 100;
}
const amount = (value: string) => BigInt(value);
export function WealthCard({ data }: { data: OverviewData }) {
  const gradient = useId();
  const current = data.wealth.find((w) => w.date === data.today);
  const start = new Date(`${data.today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  const first = start.toISOString().slice(0, 10);
  const previous = data.wealth.find((w) => w.date === first);
  const delta = data.change30 ? amount(data.change30) : undefined;
  const values = data.wealth.map((w) => amount(w.amount));
  const low = values.reduce((a, b) => (a < b ? a : b), values[0] ?? 0n);
  const high = values.reduce((a, b) => (a > b ? a : b), values[0] ?? 0n);
  const points = Array.from({ length: 31 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + i);
    const date = day.toISOString().slice(0, 10);
    const row = data.wealth.find((w) => w.date === date);
    return {
      date,
      day: day.getUTCDate(),
      row,
      x: 12 + i * 19.2,
      y: row ? 125 - position(amount(row.amount), low, high, 95) : 0,
    };
  });
  const segments: (typeof points)[] = [];
  for (const p of points) {
    if (!p.row) continue;
    const last = segments[segments.length - 1];
    if (last && points.indexOf(last[last.length - 1]) === points.indexOf(p) - 1)
      last.push(p);
    else segments.push([p]);
  }
  return (
    <section className="panel wealth-card" aria-labelledby="wealth-title">
      <h2 id="wealth-title">Total Wealth</h2>
      <div className="wealth-value">
        <strong>
          {current ? formatMoney(current.amount, data.currency) : "Unavailable"}
        </strong>
        {delta !== undefined && (
          <span className={delta < 0n ? "loss" : "gain"}>
            {delta >= 0n ? "+" : ""}
            {formatMoney(delta.toString(), data.currency)}{" "}
            <small>over 30 days</small>
          </span>
        )}
      </div>
      {data.rateError ? (
        <p role="status">{data.rateError}</p>
      ) : (
        <>
          <svg
            viewBox="0 0 600 160"
            role="img"
            aria-label="Wealth observations over the last 30 days. Missing days are gaps."
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
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
                      fill={`url(#${gradient})`}
                    />
                  )}
                  <path
                    d={line}
                    fill="none"
                    stroke="#19ba96"
                    strokeWidth="2.5"
                  />
                  {segment.map((p) => (
                    <circle key={p.date} cx={p.x} cy={p.y} r="3" fill="#19ba96">
                      <title>
                        {p.date}: {formatMoney(p.row!.amount, data.currency)}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
            {points
              .filter((_, i) => i % 5 === 0)
              .map((p) => (
                <text key={p.date} x={p.x} y="156" textAnchor="middle">
                  {p.day}
                </text>
              ))}
          </svg>
          <p className="chart-note">
            {data.converted
              ? `Estimated in ${data.currency} · ECB reference rates via Frankfurter · ${data.rateDate}.`
              : `All balances in ${data.currency}.`}
          </p>
          {!previous && (
            <p className="chart-note">
              30-day change unavailable until an observation exists for {first}.
            </p>
          )}
          <details>
            <summary>About this total and recorded wealth</summary>
            {data.converted && (
              <p className="chart-note">
                Both endpoints use these rates. The change excludes
                exchange-rate movements.
              </p>
            )}
            <p className="chart-note">
              Daily observations start when you open Overview. Missing days are
              not estimated. All account balances, including archived accounts
              and recorded future entries, are included.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Date (UTC)</th>
                  <th>Wealth</th>
                </tr>
              </thead>
              <tbody>
                {data.wealth.map((w) => (
                  <tr key={w.date}>
                    <td>{w.date}</td>
                    <td>{formatMoney(w.amount, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
function FlowChart({
  rows,
  currency,
  months,
}: {
  rows: Row[];
  currency: string;
  months: string[];
}) {
  const entries = months.map(
    (month) =>
      rows.find((r) => r.month === month && r.currency === currency) ?? {
        month,
        income: "0",
        expense: "0",
        net: "0",
      },
  );
  const values = entries.flatMap((r) => [
    amount(r.income),
    amount(r.expense),
    amount(r.net),
  ]);
  const high = values.reduce((a, b) => (a > b ? a : b), 0n);
  const low = values.reduce((a, b) => (a < b ? a : b), 0n);
  const zero = 170 - position(0n, low, high, 145);
  const [selected, setSelected] = useState("");
  return (
    <div className="currency-flow">
      <h3>{currency}</h3>
      <svg
        viewBox="0 0 650 210"
        role="group"
        aria-label={`Monthly cash flow in ${currency}`}
      >
        <line x1="10" x2="640" y1={zero} y2={zero} className="zero-line" />
        {entries.map((r, i) => (
          <g key={r.month}>
            {(["income", "expense", "net"] as const).map((key, j) => {
              const value = amount(r[key]);
              const y = 170 - position(value, low, high, 145);
              const label = `${r.month} ${key === "net" ? "Net" : key === "income" ? "Income" : "Expenses"}: ${formatMoney(r[key], currency)}`;
              return (
                <rect
                  key={key}
                  x={25 + i * 104 + j * 23}
                  y={Math.min(y, zero)}
                  width="18"
                  height={value === 0n ? 0 : Math.max(Math.abs(zero - y), 2)}
                  rx="3"
                  className={`flow-${key}`}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onFocus={() => setSelected(label)}
                  onMouseEnter={() => setSelected(label)}
                  onClick={() => setSelected(label)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(label);
                    }
                  }}
                >
                  <title>{label}</title>
                </rect>
              );
            })}
            <text x={58 + i * 104} y="202" textAnchor="middle">
              {r.month}
            </text>
          </g>
        ))}
      </svg>
      <p className="bar-inspection" aria-live="polite">
        {selected || "Select a bar to inspect its amount."}
      </p>
      <details>
        <summary>View monthly amounts</summary>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Income</th>
              <th>Expenses</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((r) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                {["income", "expense", "net"].map((key) => (
                  <td key={key}>{formatMoney(r[key], currency)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
export function CategoryChart({
  snapshot,
  month,
}: {
  snapshot: Snapshot;
  month: string;
}) {
  const [selected, setSelected] = useState("");
  const bars: Row[] = (snapshot.breakdown ?? []).flatMap((b) => {
    const category = snapshot.categories.find(
      (c) => c.id === b.categoryId && c.kind === "EXPENSE",
    );
    // Direct amounts keep parent and child bars from double-counting spending.
    return category && amount(b.direct) > 0n
      ? [{ ...b, name: category.path || category.name }]
      : [];
  });
  const currencies = [...new Set(bars.map((b) => b.currency))];
  return (
    <section className="panel category-chart">
      <h2>Monthly categories · {month}</h2>
      {!bars.length && <p>No spending this month.</p>}
      {currencies.map((currency) => {
        const rows = bars.filter((b) => b.currency === currency);
        const max = rows.reduce(
          (m, b) => (amount(b.direct) > m ? amount(b.direct) : m),
          1n,
        );
        return (
          <div key={currency}>
            <h3>{currency}</h3>
            <div className="category-bars">
              {rows.map((b) => {
                const label = `${b.name}: ${formatMoney(b.direct, currency)}`;
                return (
                  <button
                    className="category-column"
                    key={b.categoryId}
                    aria-label={label}
                    title={label}
                    onMouseEnter={() => setSelected(label)}
                    onFocus={() => setSelected(label)}
                    onClick={() => setSelected(label)}
                  >
                    <span className="category-track">
                      <span
                        style={{
                          height: `${position(amount(b.direct), 0n, max, 100)}%`,
                        }}
                      />
                    </span>
                    <span>{b.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="bar-inspection" role="status">
        {selected || "Hover, tap or focus a bar to see spending."}
      </p>
      {!!bars.length && (
        <details>
          <summary>View category spending</summary>
          {bars.map((b) => (
            <p key={`${b.categoryId}-${b.currency}`}>
              {b.name} · {formatMoney(b.direct, b.currency)}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function OverviewCharts({
  snapshot,
  month,
}: {
  snapshot: Snapshot;
  month: string;
}) {
  const [end, setEnd] = useState(month);
  const [data, setData] = useState<OverviewData>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const drag = useRef<number | undefined>(undefined);
  useEffect(() => setEnd(month), [month]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(undefined);
    setError("");
    void graphql<{ overview: OverviewData }>(
      "query Overview($month:String!){overview(month:$month)}",
      { month: end },
    )
      .then((r) => {
        if (active && r.overview) setData(r.overview);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Unable to load Overview");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [end, snapshot, retry]);
  const move = (count: number) =>
    setEnd((m) => {
      const next = shiftMonth(m, count);
      return next >= "1900-06" && next <= "9998-12" ? next : m;
    });
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(end, i - 5));
  const currencies = [
    ...new Set([
      ...snapshot.accounts.map((a) => a.currency),
      ...(data?.flows ?? []).map((f) => f.currency),
    ]),
  ].sort();
  return (
    <>
      {busy && <p role="status">Loading wealth and cash flow…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRetry((r) => r + 1)}>Retry Overview</button>
        </p>
      )}
      {data && <WealthCard data={data} />}
      <section className="panel cash-chart">
        <div className="chart-heading">
          <h2>Monthly cash flow</h2>
          <div className="actions">
            <button
              aria-label="Earlier months"
              disabled={end <= "1900-06"}
              onClick={() => move(-3)}
            >
              ← Earlier
            </button>
            <button
              aria-label="Later months"
              disabled={end >= "9998-09"}
              onClick={() => move(3)}
            >
              Later →
            </button>
          </div>
        </div>
        <p className="chart-legend">
          <span className="income-key">Income</span>
          <span className="expense-key">Expenses</span>
          <span className="net-key">Net flow</span>
        </p>
        <p className="chart-note">
          Drag or swipe horizontally, use the arrow keys, or choose Earlier and
          Later. Each view loads six months.
        </p>
        <div
          className="flow-viewport"
          tabIndex={0}
          role="group"
          aria-label="Cash flow month navigation"
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              move(e.key === "ArrowLeft" ? -3 : 3);
            }
          }}
          onPointerDown={(e) => {
            drag.current = e.clientX;
            if ((e.target as Element).tagName.toLowerCase() !== "rect") {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              if (e.pointerType === "mouse") e.preventDefault();
            }
          }}
          onPointerUp={(e) => {
            if (
              drag.current !== undefined &&
              Math.abs(e.clientX - drag.current) > 50
            )
              move(e.clientX > drag.current ? -3 : 3);
            drag.current = undefined;
          }}
          onPointerCancel={() => {
            drag.current = undefined;
          }}
        >
          {data &&
            currencies.map((currency) => (
              <FlowChart
                key={`${currency}-${end}`}
                rows={data.flows}
                currency={currency}
                months={months}
              />
            ))}
        </div>
      </section>
      <CategoryChart snapshot={snapshot} month={month} />
    </>
  );
}
export function PrimaryCurrency() {
  const [currency, setCurrency] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void graphql<{ overview: OverviewData }>(
      "query Overview($month:String!){overview(month:$month)}",
      { month: new Date().toISOString().slice(0, 7) },
    )
      .then((r) => {
        if (active && r.overview) setCurrency(r.overview.currency);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Unable to load primary currency. Reopen Settings to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="panel">
      <h2>Primary currency</h2>
      <p>
        Total Wealth is estimated in this currency. Account balances keep their
        original currencies.
      </p>
      <label>
        Primary currency{" "}
        <select
          aria-label="Primary currency"
          value={currency}
          disabled={busy || !currency}
          onChange={async (e) => {
            const next = e.target.value;
            setBusy(true);
            setMessage("");
            try {
              await execute("primaryCurrency", { currency: next });
              setCurrency(next);
              setMessage("Primary currency saved");
            } catch {
              setMessage("Unable to save primary currency");
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="" disabled>
            Loading…
          </option>
          {["EUR", "GBP", "USD", "BRL"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
