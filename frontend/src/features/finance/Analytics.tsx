import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { graphql, type Row, type Snapshot } from "./client";
import { CategoryChart } from "./Overview";
import { CashFlowChart, rangeLabel, type Bucket } from "./CashFlowChart";

import { PeriodControls, validRange, type Period } from "./PeriodControls";
export { validRange } from "./PeriodControls";
export function calendarDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
interface HistoryData { buckets: Bucket[]; flows: Row[]; hasEarlier: boolean }
const historyQuery = "query FlowHistory($grouping:String!,$weekEnd:Int!,$before:String,$start:String,$end:String){flowHistory(grouping:$grouping,weekEnd:$weekEnd,before:$before,start:$start,end:$end)}";
export function Analytics({ snapshot }: { snapshot: Snapshot; month?: string }) {
  const [today, setToday] = useState(calendarDay);
  const [period, setPeriod] = useState<Period>("week");
  const [weekEnd, setWeekEnd] = useState(0);
  const [custom, setCustom] = useState({ start: `${today.slice(0, 7)}-01`, end: today });
  const [history, setHistory] = useState<HistoryData>();
  const [historyKey, setHistoryKey] = useState("");
  const [selected, setSelected] = useState<Bucket>();
  const [breakdown, setBreakdown] = useState<Row[]>();
  const [breakdownKey, setBreakdownKey] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [spendingError, setSpendingError] = useState("");
  const [retry, setRetry] = useState(0);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(600);
  const viewport = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const interacted = useRef(false);
  const scrollAnchor = useRef<number | undefined>(undefined);
  const initialized = useRef(false);
  const drag = useRef<{ x: number; left: number; mouse: boolean } | undefined>(undefined);
  const dragged = useRef(false);
  const requestKey = `${period}:${weekEnd}:${period === "custom" ? `${custom.start}:${custom.end}` : ""}:${today}`;
  const valid = period !== "custom" || validRange(custom.start, custom.end, today);
  useEffect(() => {
    const update = () => setToday(calendarDay());
    const timer = window.setInterval(update, 60_000); window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    initialized.current = false; inFlight.current = false; interacted.current = false; scrollAnchor.current = undefined;
    setHistory(undefined); setSelected(undefined); setHistoryError(""); setLoadingEarlier(false);
    if (valid) void graphql<{ flowHistory: HistoryData }>(historyQuery, { grouping: period, weekEnd, ...(period === "custom" ? custom : {}) })
      .then(r => { if (version !== generation.current) return; if (!r.flowHistory) throw new Error("Unable to load cash flow"); setHistory(r.flowHistory); setHistoryKey(requestKey); setSelected(period === "custom" ? custom : r.flowHistory.buckets.at(-1)); })
      .catch((e: unknown) => { if (version === generation.current) setHistoryError(e instanceof Error ? e.message : "Unable to load cash flow"); });
    return () => { generation.current++; };
  }, [period, weekEnd, custom.start, custom.end, today, snapshot, retry, valid]);
  useEffect(() => {
    let active = true; setBreakdown(undefined); setSpendingError("");
    if (selected) void graphql<{ categorySpending: { breakdown: Row[] } }>("query CategorySpending($start:String!,$end:String!){categorySpending(start:$start,end:$end)}", selected)
      .then(r => { if (active) { if (!r.categorySpending) throw new Error("Unable to load category spending"); setBreakdown(r.categorySpending.breakdown); setBreakdownKey(`${selected!.start}:${selected!.end}`); } })
      .catch((e: unknown) => { if (active) setSpendingError(e instanceof Error ? e.message : "Unable to load category spending"); });
    return () => { active = false; };
  }, [selected?.start, selected?.end, snapshot, categoryRetry]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const update = () => setViewportWidth(element.clientWidth || 600);
    update(); const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update); observer?.observe(element);
    return () => observer?.disconnect();
  }, [!!history]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element || !history) return;
    if (scrollAnchor.current !== undefined) { element.scrollLeft = scrollAnchor.current; scrollAnchor.current = undefined; }
    else if (!initialized.current) { element.scrollLeft = element.scrollWidth; initialized.current = true; }
  }, [history]);
  async function earlier(force = false) {
    if (!history?.hasEarlier || inFlight.current || (historyError && !force)) return;
    const version = generation.current; inFlight.current = true; setLoadingEarlier(true);
    try {
      const r = await graphql<{ flowHistory: HistoryData }>(historyQuery, { grouping: period, weekEnd, before: history.buckets[0].start });
      if (version !== generation.current) return;
      if (!r.flowHistory || !r.flowHistory.buckets.length || r.flowHistory.buckets.at(-1)!.start >= history.buckets[0].start) throw new Error("Unable to load older history");
      const element = viewport.current;
      const oldWidth = Math.max(viewportWidth, history.buckets.length * 150);
      const newWidth = Math.max(viewportWidth, (history.buckets.length + r.flowHistory.buckets.length) * 150);
      const left = element?.scrollLeft || 0;
      const oldSlot = oldWidth / history.buckets.length;
      const newSlot = newWidth / (history.buckets.length + r.flowHistory.buckets.length);
      const visibleIndex = Math.floor(left / oldSlot);
      const shift = (visibleIndex + r.flowHistory.buckets.length + .5) * newSlot - (visibleIndex + .5) * oldSlot;
      scrollAnchor.current = left + shift;
      if (drag.current) drag.current.left += shift;
      setHistory(old => old && ({ buckets: [...r.flowHistory.buckets, ...old.buckets], flows: [...r.flowHistory.flows, ...old.flows], hasEarlier: r.flowHistory.hasEarlier }));
    } catch (e) { if (version === generation.current) setHistoryError(e instanceof Error ? e.message : "Unable to load older history"); }
    finally { if (version === generation.current) { inFlight.current = false; setLoadingEarlier(false); } }
  }
  const inspectEdge = () => { if (interacted.current && viewport.current && viewport.current.scrollLeft < 150) void earlier(); };
  const viewHistory = historyKey === requestKey ? history : undefined;
  const currentBreakdown = breakdownKey === `${selected?.start}:${selected?.end}` ? breakdown : undefined;
  const width = Math.max(viewportWidth, (viewHistory?.buckets.length || 1) * 150);
  const currencies = [...new Set([...snapshot.accounts.map(a => a.currency), ...(viewHistory?.flows.map(f => f.currency) || [])])].sort();
  return <>
    <section className="panel cash-chart" aria-labelledby="cash-flow-title">
      <div className="chart-header"><h2 id="cash-flow-title">Cash flow</h2>
        <PeriodControls period={period} custom={custom} today={today} weekEnd={weekEnd} onWeekEnd={setWeekEnd} onPeriod={setPeriod} onCustom={range => { setCustom(range); setPeriod("custom"); }} />
      </div>
    {!valid && <p role="alert">Choose valid dates, ending today or earlier.</p>}
    {valid && !viewHistory && !historyError && <p role="status">Loading cash flow…</p>}
    {historyError && <p role="alert">{historyError} <button onClick={() => { if (history) { setHistoryError(""); void earlier(true); } else setRetry(v => v + 1); }}>Retry cash flow</button>{history && <button onClick={() => { setHistoryError(""); setRetry(v => v + 1); }}>Reload history</button>}</p>}
    {viewHistory && <><p className="chart-legend"><span className="income-key">Income</span><span className="expense-key">Expenses</span><span className="net-key">Net flow</span></p>
      <div ref={viewport} className="flow-viewport grouped-timeline" role="group" aria-label="Cash flow history navigation" tabIndex={0}
        onScroll={inspectEdge} onWheel={() => { interacted.current = true; }}
        onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); interacted.current = true; e.currentTarget.scrollLeft += e.key === "ArrowLeft" ? -150 : 150; inspectEdge(); } }}
        onPointerDown={e => { interacted.current = true; dragged.current = false; drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, mouse: e.pointerType === "mouse" }; }}
        onPointerMove={e => { const start = drag.current; if (!start) return; if (Math.abs(e.clientX - start.x) > 6) { dragged.current = true; if (start.mouse) { e.currentTarget.setPointerCapture?.(e.pointerId); e.preventDefault(); e.currentTarget.scrollLeft = start.left - (e.clientX - start.x); } } }}
        onPointerUp={() => { drag.current = undefined; inspectEdge(); }} onPointerCancel={() => { drag.current = undefined; }}
        onClickCapture={e => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); } }}>
        <div className="history-track" style={{ width }}>{(currencies.length ? currencies : ["EUR"]).map(currency => <CashFlowChart key={currency} rows={viewHistory.flows} currency={currency} buckets={viewHistory.buckets} width={width} selected={selected?.start || ""} grouping={period} today={today} onSelect={setSelected} />)}</div>
      </div>
      {loadingEarlier && <p role="status">Loading older history…</p>}
    </>}
    </section>
    {viewHistory && selected && !currentBreakdown && !spendingError && <p role="status">Loading categories…</p>}
    {spendingError && <p role="alert">{spendingError} <button onClick={() => setCategoryRetry(v => v + 1)}>Retry categories</button></p>}
    {viewHistory && selected && currentBreakdown && <CategoryChart key={`${selected.start}:${selected.end}`} snapshot={{ ...snapshot, breakdown: currentBreakdown }} month={rangeLabel(selected.start, selected.end)} />}
  </>;
}
