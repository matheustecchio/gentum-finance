import { useEffect, useState, type ReactNode } from "react";
import { graphql } from "./client";
import type { OverviewData } from "./Overview";
import { calendarDay } from "./Analytics";
import { CashPeriodControls } from "./CashPeriodControls";
import type { Period } from "./PeriodControls";
import { rangeLabel, type Bucket } from "./CashFlowChart";
import { WealthHistoryChart } from "./WealthHistoryChart";
interface History extends OverviewData {
  buckets: Bucket[];
  start: string;
  end: string;
  previous: string;
  next: string;
}
const query =
  "query WealthCalendar($period:String!,$weekStart:Int!,$anchor:String,$start:String,$end:String){wealthCalendar(period:$period,weekStart:$weekStart,anchor:$anchor,start:$start,end:$end)}";
export function WealthCalendarPanel({
  data,
  children,
}: {
  data: OverviewData;
  children: ReactNode;
}) {
  const [today, setToday] = useState(calendarDay);
  const [period, setPeriod] = useState<Period>("month");
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
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const update = () => setToday(calendarDay());
    const timer = setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setError("");
    void graphql<{ wealthCalendar: History }>(query, {
      period,
      weekStart,
      anchor: anchor || today,
      ...(period === "custom" ? custom : {}),
    })
      .then((r) => {
        if (!active) return;
        if (!r.wealthCalendar) throw new Error("Unable to load wealth history");
        setHistory(r.wealthCalendar);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Unable to load wealth history",
          );
      });
    return () => {
      active = false;
    };
  }, [period, weekStart, anchor, custom.start, custom.end, today, data, retry]);
  return (
    <>
      <div className="chart-header">
        <h2 id="wealth-title">Total Wealth</h2>
      </div>
      {children}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRetry((v) => v + 1)}>
            Retry wealth history
          </button>
        </p>
      )}
      {!history && !error && <p role="status">Loading wealth history…</p>}
      {history && (
        <>
          <p className="chart-note">{rangeLabel(history.start, history.end)}</p>
          {history.rateError ? (
            <p role="status">{history.rateError}</p>
          ) : (
            <div
              className="wealth-calendar-viewport"
              tabIndex={0}
              role="group"
              aria-label="Wealth period navigation"
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "ArrowLeft" && history.previous) {
                  e.preventDefault();
                  setAnchor(history.previous);
                }
                if (e.key === "ArrowRight" && history.next) {
                  e.preventDefault();
                  setAnchor(history.next);
                }
              }}
            >
              <WealthHistoryChart
                key={`${period}:${anchor}:${today}:${retry}`}
                wealth={history.wealth}
                today={history.today}
                currency={history.currency}
                methodology={history.historyNote}
                dates={history.buckets.map((b) => b.end)}
                labels={history.buckets.map((b) => b.end.slice(5))}
              />
            </div>
          )}
          {history.converted && (
            <p className="chart-note">
              Estimated · ECB rates {history.rateDate}
              {history.rateCached && " · Cached rates (refresh unavailable)"}
            </p>
          )}
          {period !== "all" && period !== "custom" && (
            <div className="cash-page-navigation">
              <button
                disabled={!history.previous}
                aria-label="Previous wealth period"
                onClick={() => setAnchor(history.previous)}
              >
                ←
              </button>
              <span>{rangeLabel(history.start, history.end)}</span>
              <button
                disabled={!history.next}
                aria-label="Next wealth period"
                onClick={() => setAnchor(history.next)}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
      <CashPeriodControls
        label="Wealth"
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
          setAnchor(undefined);
        }}
        onPeriod={(value) => {
          setPeriod(value);
          setAnchor(undefined);
        }}
        onCustom={(value) => {
          setCustom(value);
          setPeriod("custom");
          setAnchor(undefined);
        }}
      />
      <p className="chart-note">Current total · account changes over 30 days</p>
      {data.rateError && <p role="status">{data.rateError}</p>}
      {data.changeError && <p role="status">{data.changeError}</p>}
    </>
  );
}
