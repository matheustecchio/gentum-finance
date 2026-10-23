import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { graphql, type Row, type Snapshot } from "./client";
import { rangeLabel, type Bucket } from "./CashFlowChart";
import { CashPeriodControls } from "./CashPeriodControls";
import { CalendarFlowChart } from "./CalendarFlowChart";
import { MoneyBreakdown } from "./MoneyBreakdown";
import { WealthEstimateNote } from "./WealthEstimateNote";
import { AnalyticsIcon } from "./AnalyticsIcon";
import { AnalyticsLineChart } from "./AnalyticsLineChart";
import { formatMoney } from "../accounts/money";
import type { Period } from "./PeriodControls";
import type { OverviewData } from "./Overview";
export { validRange } from "./PeriodControls";
export function calendarDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}
export interface CashPage {
  start: string;
  end: string;
  today: string;
  grouping: string;
  previous: string;
  next: string;
  buckets: Bucket[];
  flows: Row[];
  totals: Row[];
  incoming: Row[];
  outgoing: Row[];
  selectedStart: string;
  selectedEnd: string;
  entries: Row[];
  nextOffset?: number;
  trendBuckets: Bucket[];
  trendFlows: Row[];
  comparisonBuckets?: Bucket[];
  comparisonFlows?: Row[];
}
type Screen = "overview" | "cash" | "income" | "expense";
const query =
  "query CashFlowPage($period:String!,$weekStart:Int!,$anchor:String,$start:String,$end:String,$selected:String,$categoryId:String,$offset:Int){cashFlowPage(period:$period,weekStart:$weekStart,anchor:$anchor,start:$start,end:$end,selected:$selected,categoryId:$categoryId,offset:$offset)}";
const emptyTotal: Row = { income: "0", expense: "0", net: "0" };
export function Analytics({
  snapshot,
  overview,
  onWealth,
  onManage,
}: {
  snapshot: Snapshot;
  month?: string;
  overview?: OverviewData;
  onWealth?: () => void;
  onManage?: () => void;
}) {
  const [today, setToday] = useState(calendarDay);
  const [period, setPeriod] = useState<Period>("month");
  const [screen, setScreen] = useState<Screen>("overview");
  const [chart, setChart] = useState<"line" | "bar" | "pie">("bar");
  const [selected, setSelected] = useState("");
  const [focusSelection, setFocusSelection] = useState("");
  const [category, updateCategory] = useState<Row>();
  const [entryOffset, setEntryOffset] = useState(0);
  const setCategory = (row: Row | undefined) => {
    setEntryOffset(0);
    setFocusSelection("");
    updateCategory(row);
  };
  const [weekStart, setWeekStart] = useState(() => {
    try {
      return localStorage.getItem("gentum:week-start") === "0" ? 0 : 1;
    } catch {
      return 1;
    }
  });
  const [anchor, setAnchor] = useState<string>();
  const [custom, setCustom] = useState({
    start: `${today.slice(0, 7)}-01`,
    end: today,
  });
  const [page, setPage] = useState<CashPage>();
  const [pageKey, setPageKey] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [width, setWidth] = useState(900);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const suppressClick = useRef(false);
  const requestKey = `${entryOffset}:${category?.categoryId || ""}:${selected}:${period}:${weekStart}:${anchor || today}:${period === "custom" ? `${custom.start}:${custom.end}` : ""}:${today}`;
  const visible = pageKey === requestKey ? page : undefined;
  useEffect(() => {
    const update = () => setToday(calendarDay());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError("");
    void graphql<{ cashFlowPage: CashPage }>(query, {
      period,
      weekStart,
      offset: entryOffset,
      selected,
      categoryId: category?.categoryId,
      anchor: anchor || today,
      ...(period === "custom" ? custom : {}),
    })
      .then((result) => {
        if (!active) return;
        if (!result.cashFlowPage) throw new Error("Unable to load cash flow");
        setPage(result.cashFlowPage);
        setPageKey(requestKey);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Unable to load cash flow");
      });
    return () => {
      active = false;
    };
  }, [
    period,
    weekStart,
    anchor,
    custom.start,
    custom.end,
    today,
    snapshot,
    retry,
    selected,
    category?.categoryId,
    entryOffset,
  ]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth || 900);
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [!!visible, screen]);
  const currencies = [
    ...new Set([
      ...snapshot.accounts.map((a) => a.currency),
      ...(visible?.totals.map((r) => r.currency) || []),
    ]),
  ].sort();
  if (!currencies.length) currencies.push("EUR");
  const navigate = (value: string, next: number) => {
    if (value) {
      setEntryOffset(0);
      setSelected("");
      setDirection(next);
      setAnchor(value);
    }
  };
  const finishDrag = (x: number, y: number) => {
    const start = drag.current;
    drag.current = undefined;
    setOffset(0);
    if (!start || !visible) return;
    const dx = x - start.x,
      dy = y - start.y;
    if (
      Math.abs(dx) >= Math.min(70, width * 0.18) &&
      Math.abs(dx) > Math.abs(dy)
    )
      navigate(dx > 0 ? visible.previous : visible.next, dx > 0 ? -1 : 1);
  };
  const open = (next: Exclude<Screen, "overview">) => {
    setScreen(next);
    setChart(next === "expense" ? "line" : "bar");
    setCategory(undefined);
    setEntryOffset(0);
    setSelected("");
  };
  const back = () => {
    if (category) setCategory(undefined);
    else {
      setScreen("overview");
      setEntryOffset(0);
      setSelected("");
    }
  };
  const title =
    screen === "cash"
      ? "Net cash flow"
      : screen === "income"
        ? "Income"
        : "Spent";
  const status = (
    <>
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>
            Retry cash flow
          </button>
        </p>
      )}
      {!visible && !error && <p role="status">Loading analytics…</p>}
    </>
  );
  const controls = (
    <CashPeriodControls
      period={period}
      custom={custom}
      today={today}
      weekStart={weekStart}
      onWeekStart={(value) => {
        setWeekStart(value);
        try {
          localStorage.setItem("gentum:week-start", String(value));
        } catch {
          /* Storage may be disabled. */
        }
        setEntryOffset(0);
        setSelected("");
        setAnchor(undefined);
      }}
      onPeriod={(value) => {
        setEntryOffset(0);
        setSelected("");
        setDirection(1);
        setPeriod(value);
        setAnchor(undefined);
      }}
      onCustom={(range) => {
        setEntryOffset(0);
        setSelected("");
        setCustom(range);
        setPeriod("custom");
        setAnchor(undefined);
      }}
    />
  );
  if (screen === "overview")
    return (
      <section className="analytics-dashboard" aria-label="Analytics overview">
        <div className="analytics-dashboard-header">
          <span>{visible && rangeLabel(visible.start, visible.end)}</span>
        </div>
        {status}
        {visible &&
          currencies.map((currency) => {
            const total =
              visible.totals.find((r) => r.currency === currency) || emptyTotal;
            return (
              <div className="analytics-summary-grid" key={currency}>
                <button
                  className="analytics-summary-card spent-summary"
                  onClick={() => open("expense")}
                >
                  <span>Spent · {currency}</span>
                  <strong>{formatMoney(total.expense, currency)}</strong>
                  <SummaryPlot
                    rows={visible.trendFlows || []}
                    buckets={visible.trendBuckets}
                    today={visible.today}
                    period={period}
                    currency={currency}
                    field="cumulativeExpense"
                  />
                </button>
                <button
                  className="analytics-summary-card income-summary"
                  onClick={() => open("income")}
                >
                  <span>Income · {currency}</span>
                  <strong>{formatMoney(total.income, currency)}</strong>
                  <SummaryPlot
                    rows={visible.trendFlows || []}
                    buckets={visible.trendBuckets}
                    today={visible.today}
                    period={period}
                    currency={currency}
                    field="income"
                    bars
                  />
                </button>
                <button
                  className="analytics-summary-card cash-summary"
                  onClick={() => open("cash")}
                >
                  <span>Net cash flow · {currency}</span>
                  <strong>{formatMoney(total.net, currency)}</strong>
                  <small
                    className={
                      BigInt(total.net) >= 0n
                        ? "cash-money-in"
                        : "cash-money-out"
                    }
                  >
                    {BigInt(total.net) === 0n
                      ? "Balanced"
                      : BigInt(total.net) > 0n
                        ? "⊕ Positive"
                        : "⊖ Negative"}
                  </small>
                  <div className="summary-flow-bars">
                    <i
                      style={{
                        width: `${BigInt(total.income) + BigInt(total.expense) > 0n ? Number((BigInt(total.income) * 100n) / (BigInt(total.income) > BigInt(total.expense) ? BigInt(total.income) : BigInt(total.expense))) : 0}%`,
                      }}
                    />
                    <i
                      style={{
                        width: `${BigInt(total.income) + BigInt(total.expense) > 0n ? Number((BigInt(total.expense) * 100n) / (BigInt(total.income) > BigInt(total.expense) ? BigInt(total.income) : BigInt(total.expense))) : 0}%`,
                      }}
                    />
                  </div>
                </button>
              </div>
            );
          })}
        {controls}
        {overview && (
          <>
            <button
              className="analytics-summary-card wealth-summary"
              onClick={onWealth}
            >
              <h2>Total Wealth</h2>
              <strong>
                {overview.wealth.find((w) => w.date === overview.today)
                  ? formatMoney(
                      overview.wealth.find((w) => w.date === overview.today)!
                        .amount,
                      overview.currency,
                    )
                  : "Unavailable"}
              </strong>
              <WealthEstimateNote data={overview} />
              <SummaryPlot
                rows={overview.wealth.map((w) => ({
                  ...w,
                  currency: overview.currency,
                }))}
                currency={overview.currency}
                today={overview.today}
                field="amount"
              />
              <small>View assets and account balances</small>
            </button>
          </>
        )}
      </section>
    );
  return (
    <div className={`analytics-detail mode-${screen}`}>
      <div className="analytics-detail-heading">
        <button
          className="analytics-back"
          aria-label={category ? "Back to categories" : "Back to Analytics"}
          onClick={back}
        >
          ←
        </button>
        <h2>
          {title}
          {category && <span> · {category.name}</span>}
        </h2>
        {!category && (
          <div
            className="analytics-view-switch"
            role="group"
            aria-label="Analytics view"
          >
            {(
              [
                ["expense", "Spent"],
                ["income", "Income"],
                ["cash", "Net cash flow"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-label={label}
                aria-pressed={screen === value}
                onClick={() => open(value)}
              >
                <AnalyticsIcon name={label} />
              </button>
            ))}
          </div>
        )}
      </div>
      <section
        className="panel cash-chart revolut-flow"
        aria-labelledby="cash-flow-title"
      >
        <h3 id="cash-flow-title">
          {title} · {category?.name || "Personal"}
        </h3>
        {screen !== "cash" && (
          <div
            className="analytics-view-switch chart-style-switch"
            role="group"
            aria-label="Chart style"
          >
            {(["line", "bar", "pie"] as const).map((style) => (
              <button
                key={style}
                aria-label={`${style} chart`}
                aria-pressed={chart === style}
                onClick={() => setChart(style)}
              >
                <AnalyticsIcon name={style} />
              </button>
            ))}
          </div>
        )}
        {category && (
          <button
            className="analytics-clear"
            onClick={() => setCategory(undefined)}
          >
            Clear category
          </button>
        )}
        {status}
        <div
          ref={viewport}
          className="flow-viewport calendar-viewport"
          role="group"
          aria-label="Cash flow period navigation"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || !visible) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              navigate(
                e.key === "ArrowLeft" ? visible.previous : visible.next,
                e.key === "ArrowLeft" ? -1 : 1,
              );
            }
          }}
          onPointerDown={(e) => {
            if (
              e.button !== 0 ||
              (e.target as Element).closest("input,summary,table")
            )
              return;
            suppressClick.current = false;
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (!start) return;
            const dx = e.clientX - start.x,
              dy = e.clientY - start.y;
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
              suppressClick.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setOffset(Math.max(-width * 0.3, Math.min(width * 0.3, dx)));
            }
          }}
          onPointerUp={(e) => finishDrag(e.clientX, e.clientY)}
          onPointerCancel={() => {
            drag.current = undefined;
            setOffset(0);
          }}
          onClickCapture={(e) => {
            if (suppressClick.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {visible && (
            <div
              key={requestKey}
              className={`cash-calendar-page ${direction < 0 ? "from-previous" : "from-next"}`}
              style={{
                transform: offset ? `translateX(${offset}px)` : undefined,
              }}
            >
              {currencies.map((currency) => {
                const total =
                  visible.totals.find((r) => r.currency === currency) ||
                  emptyTotal;
                return (
                  <div key={currency} className="cash-currency-page">
                    {currencies.length > 1 && <h3>{currency}</h3>}
                    <strong
                      className="cash-net"
                      aria-label={`${title} in ${currency}`}
                    >
                      {formatMoney(
                        screen === "income"
                          ? total.income
                          : screen === "expense"
                            ? total.expense
                            : total.net,
                        currency,
                      )}
                    </strong>
                    {screen !== "cash" && (
                      <div className="analytics-comparison">
                        {total[`${screen}Change`] !== undefined && (
                          <span
                            className={
                              (
                                screen === "expense"
                                  ? BigInt(total[`${screen}Change`]) <= 0n
                                  : BigInt(total[`${screen}Change`]) >= 0n
                              )
                                ? "cash-money-in"
                                : "cash-money-out"
                            }
                          >
                            {BigInt(total[`${screen}Change`]) >= 0n ? "▲" : "▼"}{" "}
                            {formatMoney(
                              (BigInt(total[`${screen}Change`]) < 0n
                                ? -BigInt(total[`${screen}Change`])
                                : BigInt(total[`${screen}Change`])
                              ).toString(),
                              currency,
                            )}{" "}
                            vs previous period
                          </span>
                        )}
                        {screen === "income" && total.incomeAverage && (
                          <span>
                            {formatMoney(total.incomeAverage, currency)} avg.
                            per {visible.grouping}
                          </span>
                        )}
                      </div>
                    )}
                    {screen === "cash" && (
                      <div className="cash-totals">
                        <span
                          className="cash-money-in"
                          aria-label={`Money In total in ${currency}`}
                        >
                          ⊕ {formatMoney(total.income, currency)}
                        </span>
                        <span
                          className="cash-money-out"
                          aria-label={`Money Out total in ${currency}`}
                        >
                          ⊖ {formatMoney(total.expense, currency)}
                        </span>
                      </div>
                    )}
                    <div className="cash-period-range" aria-live="polite">
                      {rangeLabel(
                        visible.selectedStart || visible.start,
                        visible.selectedEnd || visible.end,
                      )}
                      {visible.end > today && <span> · Through today</span>}
                    </div>
                    {screen !== "cash" && chart === "line" ? (
                      <AnalyticsLineChart
                        buckets={visible.trendBuckets || visible.buckets}
                        rows={visible.trendFlows || []}
                        currency={currency}
                        kind={screen}
                        today={today}
                        grouping={(visible.trendBuckets || visible.buckets).some(b => b.start !== b.end) ? visible.grouping : "day"}
                        period={period}
                        width={width}
                        comparisonBuckets={visible.comparisonBuckets}
                        comparisonRows={visible.comparisonFlows}
                      />
                    ) : screen !== "cash" && chart === "pie" ? (
                      <CategoryDonut
                        rows={(screen === "income"
                          ? visible.incoming
                          : visible.outgoing
                        ).filter((r) => r.currency === currency)}
                        total={
                          screen === "income" ? total.income : total.expense
                        }
                        currency={currency}
                        onCategory={setCategory}
                      />
                    ) : (
                      <CalendarFlowChart
                        selected={selected}
                        focusSelection={focusSelection}
                        onSelect={(start, series) => {
                          setFocusSelection(`${currency}:${start}:${series}`);
                          setEntryOffset(0);
                          setSelected((old) => (old === start ? "" : start));
                        }}
                        mode={screen}
                        rows={visible.flows}
                        currency={currency}
                        buckets={visible.buckets}
                        grouping={(visible.trendBuckets || visible.buckets).some(b => b.start !== b.end) ? visible.grouping : "day"}
                        period={period}
                        today={visible.today}
                        width={width}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {selected && (
          <button className="analytics-clear" onClick={() => setSelected("")}>
            Show full period
          </button>
        )}
        {controls}
        {visible && period !== "all" && period !== "custom" && (
          <div className="cash-page-navigation">
            <button
              disabled={!visible.previous}
              onClick={() => navigate(visible.previous, -1)}
              aria-label="Previous period"
            >
              ←
            </button>
            <span>
              {period === "year"
                ? visible.start.slice(0, 4)
                : rangeLabel(visible.start, visible.end)}
            </span>
            <button
              disabled={!visible.next}
              onClick={() => navigate(visible.next, 1)}
              aria-label="Next period"
            >
              →
            </button>
          </div>
        )}
      </section>
      {visible && (
        <div key={requestKey} className="money-breakdowns">
          {currencies.map((currency) => {
            const total =
              visible.totals.find((r) => r.currency === currency) || emptyTotal;
            return (
              <div
                key={currency}
                className={`money-currency-breakdowns ${screen !== "cash" ? "single-breakdown" : ""}`}
              >
                {screen !== "expense" && (
                  <MoneyBreakdown
                    onCategory={setCategory}
                    onManage={
                      screen !== "cash" && !category ? onManage : undefined
                    }
                    title={screen === "cash" ? "Money In" : "By Category"}
                    kind="income"
                    currency={currency}
                    total={total.income}
                    rows={visible.incoming.filter(
                      (r) => r.currency === currency,
                    )}
                  />
                )}
                {screen !== "income" && (
                  <MoneyBreakdown
                    onCategory={setCategory}
                    onManage={
                      screen !== "cash" && !category ? onManage : undefined
                    }
                    title={screen === "cash" ? "Money Out" : "By Category"}
                    kind="expense"
                    currency={currency}
                    total={total.expense}
                    rows={visible.outgoing.filter(
                      (r) => r.currency === currency,
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {visible && category && (
        <section
          className="analytics-transactions"
          aria-label={`${category.name} transactions`}
        >
          <h2>Transactions</h2>
          {(visible.entries || []).length === 0 ? (
            <p>No transactions in this period.</p>
          ) : (
            [...new Set(visible.entries.map((e) => e.date))].map((date) => (
              <div key={date}>
                <h3>
                  {new Intl.DateTimeFormat("en-IE", {
                    dateStyle: "long",
                    timeZone: "UTC",
                  }).format(new Date(`${date}T00:00:00Z`))}
                </h3>
                <ul>
                  {visible.entries
                    .filter((e) => e.date === date)
                    .map((entry) => (
                      <li key={entry.id}>
                        <span className="money-category-icon">
                          <AnalyticsIcon name={category.name} />
                        </span>
                        <div>
                          <strong>{entry.description || category.name}</strong>
                          <small>{entry.account}</small>
                        </div>
                        <strong
                          className={
                            entry.kind === "INCOME" ? "cash-money-in" : ""
                          }
                        >
                          {entry.kind === "INCOME" ? "+" : "−"}
                          {formatMoney(entry.amount, entry.currency)}
                        </strong>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}
          <div className="cash-page-navigation">
            {entryOffset > 0 && (
              <button
                onClick={() => setEntryOffset((v) => Math.max(0, v - 50))}
              >
                Newer transactions
              </button>
            )}
            {!!visible.nextOffset && (
              <button onClick={() => setEntryOffset(visible.nextOffset!)}>
                Older transactions
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
function CategoryDonut({
  rows,
  total,
  currency,
  onCategory,
}: {
  rows: Row[];
  total: string;
  currency: string;
  onCategory: (row: Row) => void;
}) {
  let cursor = 0;
  const colors = ["#3478f6", "#1ac394", "#f4b85d", "#ad79dc", "#ff7484"];
  const categoryColor = (row: Row, index: number) =>
    /^#[0-9a-f]{6}$/i.test(row.color)
      ? row.color
      : colors[index % colors.length];
  const gradient =
    BigInt(total) > 0n
      ? rows
          .map((r, i) => {
            const from = cursor;
            cursor += Number((BigInt(r.amount) * 36000n) / BigInt(total)) / 100;
            return `${categoryColor(r, i)} ${from}deg ${cursor}deg`;
          })
          .join(",")
      : "var(--surface-hover) 0deg 360deg";
  return (
    <div className="analytics-donut">
      <div
        className="analytics-pie"
        role="img"
        aria-label={`Categories in ${currency}`}
        style={{ background: `conic-gradient(${gradient})` }}
      >
        <span>{formatMoney(total, currency)}</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={r.categoryId}>
            <button onClick={() => onCategory(r)}>
              <i style={{ background: categoryColor(r, i) }} />
              {r.name} · {r.percentage}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryPlot({
  rows,
  buckets,
  currency,
  field,
  today,
  period,
  bars = false,
}: {
  rows: Row[];
  buckets?: Bucket[];
  currency: string;
  field: string;
  today: string;
  period?: Period;
  bars?: boolean;
}) {
  const matching = rows.filter((row) => row.currency === currency);
  const calendar = buckets?.length ? buckets : matching.map((row) => ({
    start: row.month || row.date,
    end: row.month || row.date,
  }));
  const points = calendar.map((bucket) => {
    const row = matching.find((row) => (row.month || row.date) === bucket.start);
    if (bucket.start > today || row?.[field] === undefined) return { bucket };
    try {
      return { bucket, formatted: formatMoney(row[field], currency), value: BigInt(row[field]) };
    } catch {
      return { bucket };
    }
  });
  const values = points.flatMap((point) => point.value === undefined ? [] : [point.value]);
  const low = values.reduce((a, b) => (a < b ? a : b), 0n),
    high = values.reduce((a, b) => (a > b ? a : b), 0n);
  const y = (value: bigint) => high === low
    ? 85 : 85 - Number(((value - low) * 7500n) / (high - low)) / 100;
  const x = (index: number) => ((index + 0.5) * 500) / Math.max(1, calendar.length);
  const monthly = calendar.some((bucket) =>
    Date.parse(bucket.end) - Date.parse(bucket.start) >= 20 * 86400000);
  const yearly = calendar.some((bucket) =>
    Date.parse(bucket.end) - Date.parse(bucket.start) >= 300 * 86400000);
  const label = (bucket: Bucket) => new Intl.DateTimeFormat("en-IE", {
    timeZone: "UTC",
    ...(yearly ? { year: "numeric" as const }
      : monthly ? { month: "short" as const }
      : period === "week" ? { weekday: "short" as const }
      : { day: "numeric" as const, month: "short" as const }),
  }).format(new Date(`${bucket.start}T00:00:00Z`));
  const tickCount = Math.min(calendar.length, monthly || period === "week" ? 7 : 3);
  const ticks = new Set(Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i * (calendar.length - 1)) / (tickCount - 1))));
  const segments: string[][] = [];
  points.forEach((point, index) => {
    if (point.value === undefined) return;
    if (index === 0 || points[index - 1].value === undefined) segments.push([]);
    segments[segments.length - 1].push(`${x(index)},${y(point.value)}`);
  });
  const chartName = field === "amount" ? "Wealth" : bars ? "Income" : "Spending";
  if (!calendar.length) return <small>No chart history yet.</small>;
  return (
    <div className="summary-plot" role="img"
      aria-label={`${chartName}: ${rangeLabel(calendar[0].start, calendar[calendar.length - 1].end)}`}>
      <svg viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="500" y1="85" y2="85" className="summary-baseline" />
        {bars ? points.map((point, index) => point.value === undefined ? null : (
          <rect key={point.bucket.start}
            x={x(index) - Math.min(18, 320 / calendar.length) / 2}
            y={y(point.value)} width={Math.min(18, 320 / calendar.length)}
            height={Math.max(1, 85 - y(point.value))} rx="2" fill="var(--income-chart)">
            <title>{rangeLabel(point.bucket.start, point.bucket.end)}: {point.formatted}</title>
          </rect>
        )) : segments.map((segment, index) => (
          <polyline key={index} points={segment.join(" ")} stroke="currentColor"
            fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
        {!bars && points.map((point, index) => point.value === undefined ? null : (
          <circle key={point.bucket.start} cx={x(index)} cy={y(point.value)}
            r={values.length === 1 ? "3" : "2"} fill="currentColor">
            <title>{rangeLabel(point.bucket.start, point.bucket.end)}: {point.formatted}</title>
          </circle>
        ))}
      </svg>
      <div className="summary-axis" aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${calendar.length}, minmax(0, 1fr))` }}>
        {calendar.map((bucket, index) => (
          <span key={bucket.start} className={bucket.start > today ? "is-future" : undefined}
            title={`${rangeLabel(bucket.start, bucket.end)}${bucket.start > today ? " · Future period" : ""}`}>
            {ticks.has(index) ? label(bucket) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
