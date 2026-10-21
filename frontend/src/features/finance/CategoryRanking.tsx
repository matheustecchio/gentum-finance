import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { formatMoney } from "../accounts/money";
import type { Row, Snapshot } from "./client";

export function contrastText(color: string) {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const light = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return light > 0.179 ? "#000000" : "#ffffff";
}
function CategoryRow({ row, max, reserve }: { row: Row; max: bigint; reserve: number }) {
  const track = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const [inside, setInside] = useState(false);
  const [stacked, setStacked] = useState(false);
  const value = formatMoney(row.direct, row.currency);
  const percent = Number(BigInt(row.direct) * 10000n / max) / 100;
  const color = /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : "#467644";
  useLayoutEffect(() => {
    const measure = () => {
      if (track.current && label.current) {
        const fullWidth = track.current.clientWidth + parseFloat(getComputedStyle(track.current).marginRight || "0");
        const needsStack = reserve > fullWidth - 60;
        setStacked(needsStack);
        setInside(!needsStack && track.current.clientWidth * percent / 100 >= label.current.getBoundingClientRect().width + 24);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    if (track.current) observer?.observe(track.current);
    if (label.current) observer?.observe(label.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [percent, value, reserve, stacked]);
  return <li className="category-rank-row" aria-label={`${row.name}: ${value}`}>
    <span className="category-rank-name">{row.name}</span>
    <div className={`category-rank-track ${stacked ? "is-stacked" : ""}`} ref={track}>
      <div className="category-rank-fill" style={{ width: `${percent}%`, backgroundColor: color }} />
      <span ref={label} className={`category-rank-amount ${inside ? "inside" : "outside"}`} style={{ left: `${percent}%`, color: inside ? contrastText(color) : undefined }}>{value}</span>
    </div>
  </li>;
}
function CategoryGroup({ currency, rows }: { currency: string; rows: Row[] }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [reserve, setReserve] = useState(160);
  useLayoutEffect(() => {
    const update = () => { if (measure.current) setReserve(measure.current.getBoundingClientRect().width + 16); };
    update(); const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    if (measure.current) observer?.observe(measure.current);
    return () => observer?.disconnect();
  }, [rows[0].direct, currency]);
  return <div className="category-currency"><h3>{currency}</h3><span className="category-amount-measure" ref={measure} aria-hidden="true">{formatMoney(rows[0].direct, currency)}</span>
    <ol className="category-ranking" aria-label={`Category spending in ${currency}`} style={{ "--amount-reserve": `${reserve}px` } as CSSProperties}>
      {rows.map(row => <CategoryRow key={row.categoryId} row={row} max={BigInt(rows[0].direct)} reserve={reserve} />)}
    </ol>
  </div>;
}
export function CategoryRanking({ snapshot, period }: { snapshot: Snapshot; period: string }) {
  const bars: Row[] = (snapshot.breakdown || []).flatMap(b => {
    const category = snapshot.categories.find(c => c.id === b.categoryId && c.kind === "EXPENSE");
    return category && BigInt(b.direct) > 0n ? [{ ...b, color: category.color, name: category.path || category.name }] : [];
  });
  const currencies = [...new Set(bars.map(b => b.currency))].sort();
  return <section className="panel category-chart">
    <div className="category-chart-heading"><h2>Categories</h2><p className="chart-note">{period}</p></div>
    {!bars.length && <p>No spending in this period.</p>}
    {currencies.map(currency => {
      const rows = bars.filter(b => b.currency === currency).sort((a, b) => BigInt(a.direct) === BigInt(b.direct) ? a.name.localeCompare(b.name) || a.categoryId.localeCompare(b.categoryId) : BigInt(a.direct) > BigInt(b.direct) ? -1 : 1);
      return <CategoryGroup key={currency} currency={currency} rows={rows} />;
    })}
  </section>;
}
