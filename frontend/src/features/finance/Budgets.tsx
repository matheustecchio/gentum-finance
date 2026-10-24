import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";
import { BudgetForm, budgetFrequencies, ids } from "./BudgetForm";
import "./budgets.css";

type Action = { kind: "details" | "stop" | "delete"; budget: Row };
export function Budgets({ data, month, refresh }: { data: Snapshot; month: string; refresh: () => Promise<void> }) {
  const [editor, setEditor] = useState<Row | null | undefined>();
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [entries, setEntries] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (action) dialog.current?.showModal(); }, [action]);
  useEffect(() => {
    if (editor === undefined && !action) (trigger.current?.isConnected ? trigger.current : createButton.current)?.focus();
  }, [editor, action]);
  useEffect(() => {
    if (action?.kind !== "details") return;
    let cancelled = false;
    setLoading(true); setEntries([]); setError("");
    const budget = action.budget;
    void (async () => {
      let after = ""; const result: Row[] = [];
      do {
        const page = await graphql<{ entryHistory: { entries: Row[]; nextCursor?: string } }>(
          "query BudgetTransactions($start:String!,$end:String!,$after:String!){entryHistory(start:$start,end:$end,after:$after,limit:100)}",
          { start: budget.startDate || `${month}-01`, end: budget.endDate || `${month}-31`, after });
        if (cancelled) return;
        result.push(...page.entryHistory.entries); after = page.entryHistory.nextCursor || "";
      } while (after);
      const matching = new Set(ids(budget.entryIds));
      setEntries(result.filter(entry => matching.has(entry.id)));
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load transactions."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [action, month]);
  async function run(kind: string, input: Row) {
    setBusy(true); setError(""); setNotice("");
    try { await execute(kind, input); await refresh(); setNotice("Budget saved."); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to save budget."); return false; }
    finally { setBusy(false); }
  }
  const name = (budget: Row) => budget.name || data.categories.find(c => c.id === budget.categoryId)?.name || "Budget";
  const scope = (budget: Row, key: "categoryIds" | "accountIds") => {
    const selected = ids(budget[key] ?? (key === "categoryIds" ? budget.categoryId : ""));
    const source = key === "categoryIds" ? data.categories : data.accounts;
    return selected.length ? selected.map(id => source.find(item => item.id === id)?.name || "Deleted item").join(", ") : key === "categoryIds" ? "All expense categories" : `All ${budget.currency} accounts`;
  };
  const includesCategory = (selected: string[], id: string) => {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current && !visited.has(current)) {
      if (selected.includes(current)) return true;
      visited.add(current);
      current = data.categories.find(category => category.id === current)?.parentId;
    }
    return false;
  };
  const hasLaterRevision = (budget: Row) => budget.latestVersion === "false" || !!budget.seriesId && data.budgets.some(other => other.seriesId === budget.seriesId && other.effectiveDate > budget.effectiveDate);
  const overlapping = data.budgets.some((a, index) => data.budgets.slice(index + 1).some(b => {
    if (a.id === b.id || (a.seriesId && a.seriesId === b.seriesId) || a.currency !== b.currency || (a.endDate && b.startDate > a.endDate) || (b.endDate && a.startDate > b.endDate)) return false;
    return (["categoryIds", "accountIds"] as const).every(key => { const left = ids(a[key] ?? (key === "categoryIds" ? a.categoryId : "")); const right = ids(b[key] ?? (key === "categoryIds" ? b.categoryId : "")); return !left.length || !right.length || (key === "categoryIds" ? left.some(id => includesCategory(right, id)) || right.some(id => includesCategory(left, id)) : left.some(id => right.includes(id))); });
  }));
  function open(kind: Action["kind"], budget: Row, element: HTMLElement) { trigger.current = element; setError(""); setAction({kind, budget}); }
  return <section className="budgets-view" aria-label="Budget planning">
    <div className="budget-header"><div><h2>Budgets</h2><p className="muted">Plan spending by period, category and account.</p></div><button ref={createButton} onClick={e => { trigger.current = e.currentTarget; setError(""); setEditor(null); }}>Create budget</button></div>
    {notice && <p role="status">{notice}</p>}{error && !action && <p role="alert">{error}</p>}
    {editor !== undefined && <BudgetForm key={editor?.id || "new"} data={data} budget={editor || undefined} month={month} busy={busy} save={input => run("saveBudget", input)} cancel={() => setEditor(undefined)} />}
    {overlapping && <p className="panel" role="note">Some budgets overlap. The same expense can count toward more than one budget. Each budget is shown separately.</p>}
    {!data.budgets.length && <div className="panel"><h3>No budgets for this month</h3><p>Create a budget to track recorded expenses against your limit.</p></div>}
    <div className="stats-grid">{data.budgets.map(budget => {
      const amount = BigInt(budget.amount); const spent = BigInt(budget.spent || "0"); const remaining = amount - spent;
      const percent = amount > 0n ? spent * 100n / amount : 0n;
      const today = new Date().toISOString().slice(0, 10);
      const periodStart = budget.startDate || today;
      const days = budget.endDate ? Math.max(0, Math.round((Date.parse(`${budget.endDate}T00:00:00Z`) - Date.parse(`${periodStart > today ? periodStart : today}T00:00:00Z`)) / 86400000) + 1) : 0;
      const timing = periodStart > today ? `Starts ${periodStart} · ${days}-day period` : budget.endDate && budget.endDate < today ? "Period ended" : `${days} days remaining`;
      const alert = percent >= 100n ? "Limit reached" : percent >= 90n ? "90% of limit reached" : percent >= 75n ? "75% of limit reached" : "";
      return <article className="panel budget-card" key={`${budget.id}-${budget.startDate || month}`}>
        <div><h3>{name(budget)}</h3><p className="muted">{budgetFrequencies[budget.frequency as keyof typeof budgetFrequencies] || "Monthly"}{budget.startDate && ` · ${budget.startDate} to ${budget.endDate}`}</p></div>
        <p>{formatMoney(spent.toString(), budget.currency)} spent of {formatMoney(amount.toString(), budget.currency)}</p>
        <progress max="100" value={Number(percent > 100n ? 100n : percent)} aria-label={`${name(budget)} budget usage`} />
        <p>{percent.toString()}% used{percent > 100n ? " · Over budget" : ""}</p>
        <strong>{formatMoney((remaining < 0n ? -remaining : remaining).toString(), budget.currency)} {remaining < 0n ? "exceeded" : "remaining"}</strong>
        <p className="muted">{timing}{budget.active === "false" && budget.frequency !== "once" ? " · Stopped" : ""}{budget.frequency && budget.frequency !== "once" && budget.active !== "false" ? " · Renews automatically" : ""}</p>
        {budget.alert !== "false" && alert && <p className="budget-alert" role="status">{alert}</p>}
        <p className="muted">{scope(budget, "categoryIds")}<br />{scope(budget, "accountIds")}</p>
        {hasLaterRevision(budget) && <p className="muted">A newer version exists. Select its period to edit this budget.</p>}
        <div className="actions"><button className="secondary" onClick={e => open("details", budget, e.currentTarget)}>Transactions</button><button className="secondary" disabled={hasLaterRevision(budget)} onClick={e => { trigger.current = e.currentTarget; setError(""); setEditor(budget); }}>Edit</button>{budget.active !== "false" && budget.frequency !== "once" && <button className="secondary" onClick={e => open("stop", budget, e.currentTarget)}>Stop</button>}<button className="secondary" onClick={e => open("delete", budget, e.currentTarget)}>Delete</button></div>
      </article>;
    })}</div>
    {action && <dialog ref={dialog} className="budget-dialog" aria-labelledby="budget-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else setAction(undefined); }}>
      <h2 id="budget-dialog-title">{action.kind === "details" ? "Matching transactions" : action.kind === "stop" ? "Stop budget" : "Delete budget"}: {name(action.budget)}</h2>
      {error && <p role="alert">{error}</p>}
      {action.kind === "details" ? <>{loading ? <p role="status">Loading transactions…</p> : entries.length ? <ul className="budget-transactions">{entries.map(entry => <li key={entry.id}><span>{entry.description || "Expense"}<small>{entry.date}</small></span><strong>{formatMoney(entry.amount, entry.currency || action.budget.currency)}</strong></li>)}</ul> : !error && <p>No matching recorded expenses in this period.</p>}<button className="secondary" onClick={() => setAction(undefined)}>Close</button></> : <><p>{action.kind === "stop" ? `This budget will stop after ${action.budget.endDate}. Existing periods remain available.` : "Delete this budget and its saved periods? Your transactions will stay in your accounts."}</p><div className="actions"><button disabled={busy} onClick={async () => { if (await run(action.kind === "stop" ? "stopBudget" : "deleteBudget", action.kind === "stop" ? {id: action.budget.id, date: action.budget.endDate} : {id: action.budget.id})) setAction(undefined); }}>{busy ? "Saving…" : action.kind === "stop" ? "Stop budget" : "Delete budget"}</button><button disabled={busy} className="secondary" onClick={() => setAction(undefined)}>Cancel</button></div></>}
    </dialog>}
  </section>;
}
