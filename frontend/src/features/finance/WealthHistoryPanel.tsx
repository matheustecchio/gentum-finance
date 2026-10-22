import { useEffect, useState, type ReactNode } from "react";
import { graphql } from "./client";
import type { OverviewData } from "./Overview";
import { calendarDay } from "./Analytics";
import { PeriodControls, type Period } from "./PeriodControls";
import { bucketLabel, type Bucket } from "./CashFlowChart";
import { WealthHistoryChart } from "./WealthHistoryChart";
interface History extends OverviewData { buckets: Bucket[]; hasEarlier: boolean }
const query = "query WealthHistory($grouping:String!,$weekEnd:Int!,$before:String,$start:String,$end:String){wealthHistory(grouping:$grouping,weekEnd:$weekEnd,before:$before,start:$start,end:$end)}";
export function WealthHistoryPanel({ data, children }: { data: OverviewData; children: ReactNode }) {
  const [today, setToday] = useState(calendarDay);
  const [period, setPeriod] = useState<Period>("week");
  const [weekEnd, setWeekEnd] = useState(0);
  const [custom, setCustom] = useState({ start: `${today.slice(0, 7)}-01`, end: today });
  const [before, setBefore] = useState<string>();
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const update = () => setToday(calendarDay());
    const timer = window.setInterval(update, 60_000); window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    let active = true; setHistory(undefined); setError("");
    void graphql<{ wealthHistory: History }>(query, { grouping: period, weekEnd, before, ...(period === "custom" ? custom : {}) })
      .then(r => { if (!active) return; if (!r.wealthHistory) throw new Error("Unable to load wealth history"); setHistory(r.wealthHistory); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Unable to load wealth history"); });
    return () => { active = false; };
  }, [period, weekEnd, custom.start, custom.end, before, today, data, retry]);
  return <>
    <div className="chart-header"><h2 id="wealth-title">Total Wealth</h2>
      <PeriodControls period={period} today={today} custom={custom} weekEnd={weekEnd} onWeekEnd={value => { setWeekEnd(value); setBefore(undefined); }} onPeriod={value => { setPeriod(value); setBefore(undefined); }} onCustom={range => { setCustom(range); setPeriod("custom"); setBefore(undefined); }} />
    </div>
    {children}
    {data.converted && !data.rateError && <p className="chart-note">Current total estimated · ECB rates {data.rateDate}{data.rateCached && " · Cached rates (refresh unavailable)"}</p>}
    <p className="chart-note">Current total · changes over 30 days</p>
    {error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry wealth history</button></p>}
    {!history && !error && <p role="status">Loading wealth history…</p>}
    {history && (history.rateError ? <p role="status">{history.rateError} <button onClick={() => setRetry(v => v + 1)}>Retry wealth history</button></p> : <>
      <WealthHistoryChart key={`${period}:${weekEnd}:${custom.start}:${custom.end}:${before}:${today}:${retry}`} wealth={history.wealth} today={history.today} currency={history.currency} methodology={history.historyNote} dates={history.buckets.map(b => b.end)} labels={history.buckets.map(b => period === "all" || period === "custom" ? b.end : bucketLabel(b, period, history.today).replace(" · current", ""))} />
      {history.converted && <p className="chart-note">Estimated · ECB rates {history.rateDate}{history.rateCached && " · Cached rates (refresh unavailable)"}</p>}
      <div className="wealth-history-navigation">
        {history.hasEarlier && <button className="secondary" onClick={() => setBefore(history.buckets[0].start)}>Older wealth history</button>}
        {before && <button className="secondary" onClick={() => setBefore(undefined)}>Latest wealth history</button>}
      </div>
    </>)}
  </>;
}
