import { useEffect, useState } from "react";
import { graphql, type Row, type Snapshot } from "./client";
import { CategoryChart, FlowChart, shiftMonth } from "./Overview";

export type Period = "week" | "month" | "sixMonths" | "year" | "custom";
export function calendarDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
function dayShift(day: string, count: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function periodRange(period: Exclude<Period, "custom">, anchor: string) {
  if (period === "week") {
    const offset = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = dayShift(anchor, -offset);
    return { start, end: dayShift(start, 6) };
  }
  const month = anchor.slice(0, 7);
  const start = period === "year" ? `${anchor.slice(0, 4)}-01-01` : period === "sixMonths" ? `${shiftMonth(month, -5)}-01` : `${month}-01`;
  const endMonth = period === "year" ? `${anchor.slice(0, 4)}-12` : month;
  return { start, end: dayShift(`${shiftMonth(endMonth, 1)}-01`, -1) };
}
function rangeLabel(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return format.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`));
}
export function rangeBuckets(start: string, end: string) {
  const daily = (Date.parse(end) - Date.parse(start)) / 86400000 <= 62;
  const result: string[] = [];
  for (let point = daily ? start : start.slice(0, 7); point <= (daily ? end : end.slice(0, 7)); point = daily ? dayShift(point, 1) : shiftMonth(point, 1)) result.push(point);
  return result;
}
export function validRange(start: string, end: string, today: string) {
  const realDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!realDate(start) || !realDate(end) || start < "1900-01-01" || start > end || end > today) return false;
  const limit = new Date(`${start}T00:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 5);
  return Date.parse(end) <= limit.getTime();
}
interface AnalyticsData { flows: Row[]; breakdown: Row[] }
export function Analytics({ snapshot, month }: { snapshot: Snapshot; month: string }) {
  const [today, setToday] = useState(calendarDay);
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(`${month}-01`);
  const [custom, setCustom] = useState({ start: `${month}-01`, end: today });
  const [data, setData] = useState<AnalyticsData>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { setAnchor(`${month}-01`); }, [month]);
  useEffect(() => {
    const update = () => setToday(calendarDay());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const raw = period === "custom" ? custom : periodRange(period, anchor > today ? today : anchor);
  const start = raw.start;
  const end = raw.end > today ? today : raw.end;
  const valid = validRange(start, end, today) && (period !== "custom" || custom.end <= today);
  useEffect(() => {
    let active = true;
    setData(undefined); setError("");
    if (valid) void graphql<{ analytics: AnalyticsData }>("query Analytics($start:String!,$end:String!){analytics(start:$start,end:$end)}", { start, end })
      .then(result => { if (active) { if (!result.analytics) throw new Error("Unable to load analytics"); setData(result.analytics); } })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Unable to load analytics"); });
    return () => { active = false; };
  }, [start, end, valid, snapshot, retry]);
  function navigate(direction: number) {
    if (period === "custom") return;
    const next = period === "week" ? dayShift(anchor, direction * 7) : `${shiftMonth(anchor.slice(0, 7), direction * (period === "year" ? 12 : period === "sixMonths" ? 6 : 1))}-01`;
    setAnchor(next);
  }
  const atCurrent = period !== "custom" && periodRange(period, anchor).end >= today;
  return <>
    <section className="analytics-period" aria-label="Analytics period">
      <div className="period-options" role="group" aria-label="Period">
        {([["week", "Week"], ["month", "Month"], ["sixMonths", "6 months"], ["year", "Year"], ["custom", "Custom"]] as const).map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); setAnchor(today); }}>{label}</button>)}
      </div>
      {period === "custom" ? <div className="period-dates">
        <label>Start date<input type="date" min="1900-01-01" max={custom.end || today} value={custom.start} onChange={e => setCustom({ ...custom, start: e.target.value })} /></label>
        <label>End date<input type="date" min={custom.start || "1900-01-01"} max={today} value={custom.end} onChange={e => setCustom({ ...custom, end: e.target.value })} /></label>
      </div> : <div className="period-navigation">
        <button aria-label="Previous period" disabled={start <= "1901-01-01"} onClick={() => navigate(-1)}>‹</button>
        <span>{rangeLabel(start, end)}</span>
        <button aria-label="Next period" disabled={atCurrent} onClick={() => navigate(1)}>›</button>
        {!atCurrent && <button onClick={() => setAnchor(today)}>Current period</button>}
      </div>}
    </section>
    {!valid && <p role="alert">Choose valid dates, ending today or earlier, within five years.</p>}
    {valid && !data && !error && <p role="status">Loading analytics…</p>}
    {error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry analytics</button></p>}
    {valid && data && <>
      <section className="panel cash-chart"><h2>Cash flow</h2>
        <p className="chart-legend"><span className="income-key">Income</span><span className="expense-key">Expenses</span><span className="net-key">Net flow</span></p>
        <div className="flow-viewport"><div className="analytics-flow-track" style={{ minWidth: rangeBuckets(start, end).length * 70 }}>
          {[...new Set([...snapshot.accounts.map(a => a.currency), ...data.flows.map(f => f.currency)])].sort().map(currency => <FlowChart key={`${start}:${end}:${currency}`} currency={currency} rows={data.flows} months={rangeBuckets(start, end)} />)}
        </div></div>
      </section>
      <CategoryChart key={`${start}:${end}`} snapshot={{ ...snapshot, breakdown: data.breakdown }} month={rangeLabel(start, end)} />
    </>}
  </>;
}
