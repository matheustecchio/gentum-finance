import { AnalyticsIcon } from "./AnalyticsIcon";
import { CategoryRanking } from "./CategoryRanking";
import { Analytics } from "./Analytics";
import { FlowTooltip, type FlowSelection } from "./FlowTooltip";
import { WealthCalendarPanel } from "./WealthCalendarPanel";
import { WealthHistoryPanel } from "./WealthHistoryPanel";
import { useEffect, useState, useId } from "react";
import { formatMoney } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";
import "./overview.css";

export interface OverviewData {
  accounts?: Row[];
  historyNote?: string;
  change30?: string;
  changeError?: string;
  currency: string;
  today: string;
  wealth: Row[];
  flows: Row[];
  rateDate: string;
  rateCached?: boolean;
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
export function WealthCard({ data, calendar = false }: { data: OverviewData; calendar?: boolean }) {
  const HistoryPanel = calendar ? WealthCalendarPanel : WealthHistoryPanel;
  const current = data.wealth.find((w) => w.date === data.today);
  const delta = data.change30 ? amount(data.change30) : undefined;
  const deltaText =
    delta === undefined
      ? ""
      : `${delta >= 0n ? "+" : ""}${formatMoney(delta.toString(), data.currency)}`;
  return (
    <section className="panel wealth-card" aria-labelledby="wealth-title">
      <HistoryPanel data={data}>
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
          </span>
        )}
      </div>
      {data.rateError && <p role="status">{data.rateError}</p>}
      {data.changeError && <p className="chart-note" role="status">{data.changeError}</p>}
      </HistoryPanel>
      {!!data.accounts?.length && (
        <div className="wealth-accounts" aria-label="Account balances and changes">
          <div className="wealth-account-head" aria-hidden="true">
            <span>Account</span>
            <span>Balance</span>
            <span>Change</span>
          </div>
          <ul>
            {data.accounts.map((account) => {
              const change = account.change30
                ? BigInt(account.change30)
                : undefined;
              return (
                <li className="wealth-account" key={account.id}>
                  <div className="wealth-account-name">
                    {calendar && <span className="wealth-account-icon"><AnalyticsIcon name="cash" /></span>}
                    <strong>{account.name}</strong>
                    <small>{account.currency}</small>
                  </div>
                  <strong className="wealth-account-balance">
                    {formatMoney(account.amount, account.currency)}
                  </strong>
                  <span
                    className={
                      change === undefined
                        ? "wealth-account-unavailable"
                        : change < 0n ? "loss" : "gain"
                    }
                    aria-label={`${account.name} change`}
                  >
                    {change === undefined
                      ? "Unavailable"
                      : `${change >= 0n ? "+" : ""}${formatMoney(account.change30, account.currency)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
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
        aria-label={`Cash flow in ${currency}`}
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
      <table className="chart-amounts" aria-label={`Cash flow amounts in ${currency}`}>
        <thead>
          <tr>
            <th>Period</th>
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
  return <CategoryRanking snapshot={snapshot} period={month} />;
}

export function OverviewCharts({
  snapshot,
  month, onManage,
}: {
  snapshot: Snapshot;
  month: string; onManage?: () => void;
}) {
  const [wealthOpen, setWealthOpen] = useState(false);
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
      {wealthOpen ? <div className="analytics-wealth-detail"><button className="analytics-return" onClick={()=>setWealthOpen(false)}>← Back to Analytics</button>{data && <WealthCard data={data} calendar />}</div> : <Analytics snapshot={snapshot} month={flowMonth} overview={data} onManage={onManage} onWealth={()=>setWealthOpen(true)} />}
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
