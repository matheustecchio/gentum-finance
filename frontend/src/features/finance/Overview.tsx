import { FlowTooltip, type FlowSelection } from "./FlowTooltip";
import { WealthHistoryChart } from "./WealthHistoryChart";
import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { formatMoney } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";
import "./overview.css";

export interface OverviewData {
  historyNote?: string;
  change30?: string;
  changeError?: string;
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
export function dublinMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
function useCurrentMonth() {
  const [month, setMonth] = useState(dublinMonth);
  useEffect(() => {
    const update = () => setMonth(dublinMonth());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return month;
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
  const current = data.wealth.find((w) => w.date === data.today);
  const delta = data.change30 ? amount(data.change30) : undefined;
  const deltaText =
    delta === undefined
      ? ""
      : `${delta >= 0n ? "+" : ""}${formatMoney(delta.toString(), data.currency)}`;
  return (
    <section className="panel wealth-card" aria-labelledby="wealth-title">
      <h2 id="wealth-title">Total Wealth</h2>
      <div className="wealth-value">
        <strong>
          {current ? formatMoney(current.amount, data.currency) : "Unavailable"}
        </strong>
        {delta !== undefined && (
          <span
            className={`wealth-change ${delta < 0n ? "loss" : "gain"}`}
            style={{
              fontSize: `min(1rem, calc(100cqi / ${deltaText.length * 0.75 + 8}))`,
            }}
          >
            <span className="wealth-change-amount">{deltaText}</span>
            <small>over 30 days</small>
          </span>
        )}
      </div>
      {data.rateError ? (
        <p role="status">{data.rateError}</p>
      ) : (
        <>
          <WealthHistoryChart
            wealth={data.wealth}
            today={data.today}
            currency={data.currency}
            methodology={data.historyNote}
          />
          {data.converted && (
            <p className="chart-note">Estimated · ECB rates {data.rateDate}</p>
          )}
          {data.changeError && (
            <p className="chart-note" role="status">
              {data.changeError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
export function FlowChart({
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
  const [selected, setSelected] = useState<FlowSelection>();
  const tooltipId = useId();
  const clearSelection = (element: SVGRectElement) =>
    setSelected((old) => (old?.element === element ? undefined : old));
  return (
    <div className="currency-flow">
      <h3>{currency}</h3>
      <svg
        viewBox={`0 0 ${months.length * 140} 210`}
        role="group"
        aria-label={`Monthly cash flow in ${currency}`}
      >
        <line
          x1="10"
          x2={months.length * 140 - 10}
          y1={zero}
          y2={zero}
          className="zero-line"
        />
        {entries.map((r, i) => (
          <g key={r.month}>
            {(["income", "expense", "net"] as const).map((key, j) => {
              const value = amount(r[key]);
              const y = 170 - position(value, low, high, 145);
              const label = `${r.month} ${key === "net" ? "Net" : key === "income" ? "Income" : "Expenses"}: ${formatMoney(r[key], currency)}`;
              const top = Math.min(y, zero);
              const height = value === 0n ? 2 : Math.max(Math.abs(zero - y), 2);
              const select = (element: SVGRectElement) =>
                setSelected({
                  element,
                  value: formatMoney(r[key], currency),
                  series: key,
                });
              return (
                <g key={key}>
                  <rect
                    x={29 + i * 140 + j * 27}
                    y={top}
                    width="18"
                    height={height}
                    rx="3"
                    className={`flow-${key}`}
                    aria-hidden="true"
                  />
                  <rect
                    x={25 + i * 140 + j * 27}
                    y={top - 3}
                    width="26"
                    height={Math.max(height + 6, 12)}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    aria-describedby={
                      selected?.element?.getAttribute("aria-label") === label
                        ? tooltipId
                        : undefined
                    }
                    onFocus={(e) => {
                      e.currentTarget.scrollIntoView?.({
                        block: "nearest",
                        inline: "nearest",
                      });
                      select(e.currentTarget);
                    }}
                    onBlur={(e) => clearSelection(e.currentTarget)}
                    onPointerEnter={(e) => {
                      if (e.pointerType === "mouse") select(e.currentTarget);
                    }}
                    onPointerLeave={(e) => {
                      if (
                        e.pointerType === "mouse" &&
                        document.activeElement !== e.currentTarget
                      )
                        clearSelection(e.currentTarget);
                    }}
                    onClick={(e) => select(e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSelected(undefined);
                      } else if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(e.currentTarget);
                      }
                    }}
                  />
                </g>
              );
            })}
            <text x={65 + i * 140} y="202" textAnchor="middle">
              {r.month}
            </text>
          </g>
        ))}
      </svg>
      {selected && (
        <FlowTooltip
          selection={selected}
          id={tooltipId}
          layoutKey={`${low}:${high}:${months.length}`}
        />
      )}
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
const MONTH_WIDTH = 140;
export function CashFlowTimeline({
  initial,
  month,
  currencies,
  currentMonth,
}: {
  initial: OverviewData;
  month: string;
  currencies: string[];
  currentMonth: string;
}) {
  const [range, setRange] = useState({
    start: shiftMonth(month < currentMonth ? month : currentMonth, -5),
    end: month < currentMonth ? month : currentMonth,
  });
  const [rows, setRows] = useState(initial.flows);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<"earlier" | "later">();
  const viewport = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  const interacted = useRef(false);
  const anchor = useRef<number | null>(null);
  const initialized = useRef(false);
  const dragged = useRef(false);
  const pointer = useRef<{ x: number; left: number } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const months: string[] = [];
  for (let m = range.start; m <= range.end; m = shiftMonth(m, 1))
    months.push(m);
  async function load(direction: "earlier" | "later") {
    if (
      inFlight.current ||
      (direction === "later" && range.end >= currentMonth)
    )
      return;
    const end =
      direction === "earlier"
        ? shiftMonth(range.start, -1)
        : shiftMonth(range.end, 6) < currentMonth
          ? shiftMonth(range.end, 6)
          : currentMonth;
    if (end < "1900-06" || end > "9998-12") return;
    inFlight.current = true;
    setLoading(true);
    setFailure(undefined);
    try {
      const result = await graphql<{ overview: OverviewData }>(
        "query Overview($month:String!){overview(month:$month)}",
        { month: end },
      );
      if (!active.current) return;
      if (!result.overview) throw new Error("Missing cash flow history");
      if (direction === "earlier")
        anchor.current = viewport.current?.scrollLeft ?? 0;
      setRows((old) => [...old, ...result.overview.flows]);
      setRange((old) =>
        direction === "earlier"
          ? { ...old, start: shiftMonth(end, -5) }
          : { ...old, end },
      );
    } catch {
      if (active.current) setFailure(direction);
    } finally {
      inFlight.current = false;
      if (active.current) setLoading(false);
    }
  }
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (anchor.current !== null) {
      element.scrollLeft = anchor.current + 6 * MONTH_WIDTH;
      if (pointer.current) pointer.current.left += 6 * MONTH_WIDTH;
      anchor.current = null;
    } else if (!initialized.current) {
      element.scrollLeft = element.scrollWidth;
      initialized.current = true;
    }
    // Provide a real scroll range even on wide screens or empty ledgers.
    if (
      element.clientWidth > 0 &&
      element.scrollWidth <= element.clientWidth + MONTH_WIDTH &&
      !failure
    )
      void load("earlier");
  }, [range, failure]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (
        element.clientWidth > 0 &&
        element.scrollWidth <= element.clientWidth + MONTH_WIDTH &&
        !failure
      )
        void load("earlier");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [range, failure]);
  const inspectEdges = () => {
    const element = viewport.current;
    if (!element || !interacted.current || inFlight.current || failure) return;
    if (element.scrollLeft < MONTH_WIDTH) void load("earlier");
    else if (
      element.scrollWidth - element.clientWidth - element.scrollLeft <
      MONTH_WIDTH
    )
      void load("later");
  };
  return (
    <section className="panel cash-chart">
      <h2>Monthly cash flow</h2>
      <p className="chart-legend">
        <span className="income-key">Income</span>
        <span className="expense-key">Expenses</span>
        <span className="net-key">Net flow</span>
      </p>
      <p id="flow-help" className="chart-note">
        Drag or swipe through months up to the current month. Older history
        loads at the left edge. With the chart focused, use the left and right
        arrow keys.
      </p>
      <div
        ref={viewport}
        className="flow-viewport flow-timeline"
        tabIndex={0}
        role="group"
        aria-label="Cash flow month navigation"
        aria-describedby="flow-help"
        aria-busy={loading}
        onScroll={inspectEdges}
        onWheel={() => {
          interacted.current = true;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            interacted.current = true;
            e.currentTarget.scrollLeft +=
              e.key === "ArrowLeft" ? -MONTH_WIDTH : MONTH_WIDTH;
            inspectEdges();
          }
        }}
        onPointerDown={(e) => {
          interacted.current = true;
          dragged.current = false;
          if (e.pointerType === "mouse")
            pointer.current = {
              x: e.clientX,
              left: e.currentTarget.scrollLeft,
            };
        }}
        onPointerMove={(e) => {
          const start = pointer.current;
          if (!start) return;
          if (Math.abs(e.clientX - start.x) > 5) {
            dragged.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            e.currentTarget.scrollLeft = start.left - (e.clientX - start.x);
          }
        }}
        onPointerUp={() => {
          pointer.current = null;
          inspectEdges();
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div
          className="timeline-track"
          style={{ width: months.length * MONTH_WIDTH }}
        >
          {(currencies.length ? currencies : [initial.currency]).map(
            (currency) => (
              <FlowChart
                key={currency}
                rows={rows}
                currency={currency}
                months={months}
              />
            ),
          )}
        </div>
      </div>
      {loading && <p role="status">Loading more months…</p>}
      {failure && (
        <p role="alert">
          Unable to load more months.{" "}
          <button onClick={() => void load(failure)}>Retry history</button>
        </p>
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
  const currentMonth = useCurrentMonth();
  const flowMonth = month < currentMonth ? month : currentMonth;
  const [data, setData] = useState<OverviewData>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setData(undefined);
    setError("");
    void graphql<{ overview: OverviewData }>(
      "query Overview($month:String!){overview(month:$month)}",
      { month: flowMonth },
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
  }, [flowMonth, snapshot, retry]);
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
      {data && (
        <CashFlowTimeline
          key={`${flowMonth}:${currentMonth}`}
          initial={data}
          month={flowMonth}
          currentMonth={currentMonth}
          currencies={[
            ...new Set([
              ...snapshot.accounts.map((a) => a.currency),
              ...data.flows.map((f) => f.currency),
            ]),
          ].sort()}
        />
      )}
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
