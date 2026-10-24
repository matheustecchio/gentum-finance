import { useEffect, useRef, useState } from "react";
import { SvgIcon } from "./SvgIcon";
import pencilIcon from "../../assets/icons/pencil.svg";
import plusIcon from "../../assets/icons/plus.svg";
import "./history.css";
import { execute, graphql, type Row } from "./client";
import { formatMoney, toCents } from "../accounts/money";
export type Filters = {
  start: string;
  end: string;
  categoryId: string;
  subcategoryId: string;
};
export const clearFilters: Filters = {
  start: "",
  end: "",
  categoryId: "",
  subcategoryId: "",
};
type Page = { entries: Row[]; totalCount: number; hasEntries: boolean };
export function historyPages(current: number, total: number): (number | string)[] {
 const pages: (number | string)[] = [];
 let last = 0;
 const start = Math.min(Math.max(1, current - 2), Math.max(1, total - 4));
 const window = Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
 const candidates = [...new Set([1, ...window, total])].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
 for (const n of candidates) {
  if (last && n - last > 1) pages.push(`gap-${last}`);
  pages.push(n); last = n;
 }
 return pages;
}
export function History({
  categories,
  accounts,
  filters,
  onFilters,
  onSaved,
  onAdd,
}: {
  categories: Row[];
  accounts: Row[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSaved?: () => Promise<void>;
  onAdd?: () => void;
}) {
  const [editing, setEditing] = useState<Row>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editDialog = useRef<HTMLDialogElement>(null);
  const root = useRef<HTMLElement>(null);
  const returnToEntry = useRef<string | undefined>(undefined);
  const restoreFocus = useRef(false);
  const [editError, setEditError] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const loadedRevision = useRef(-1);
  const totalPages = Math.max(1, Math.ceil((page?.totalCount ?? 0) / pageSize));
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setPage(undefined);
    void graphql<{ entryHistory: Page }>(
      "query History($start:String,$end:String,$categoryId:String,$limit:Int,$page:Int){entryHistory(start:$start,end:$end,categoryId:$categoryId,limit:$limit,page:$page)}",
      { start: filters.start, end: filters.end, categoryId: filters.categoryId, limit: pageSize, page: pageNumber },
    )
      .then((result) => {
        if (current) {
          const lastPage = Math.max(1, Math.ceil(result.entryHistory.totalCount / pageSize));
          if (pageNumber > lastPage) setPageNumber(lastPage);
          else { loadedRevision.current = retry; setPage(result.entryHistory); }
        }
      })
      .catch((e) => {
        if (current)
          setError(e instanceof Error ? e.message : "Unable to load history");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filters, pageNumber, pageSize, retry]);
  useEffect(() => {
    if (editing && !editDialog.current?.open) editDialog.current?.showModal();
    if (!editing && !saving && !loading && page && loadedRevision.current === retry && restoreFocus.current) {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>("[data-edit-entry]");
      const trigger = [...(buttons ?? [])].find(button => button.dataset.editEntry === returnToEntry.current);
      const target = trigger ?? root.current?.querySelector<HTMLButtonElement>(".history-clear-filters");
      target?.focus();
      if (target && document.activeElement === target) restoreFocus.current = false;
    }
  }, [editing, saving, loading, page, retry]);
  const closeEditor = () => { if (!savingRef.current) { restoreFocus.current = true; setEditing(undefined); } };
  const change = (values: Partial<Filters>) => {
    setPageNumber(1);
    onFilters({ ...filters, ...values });
  };
  return (
    <section ref={root} className="panel transaction-history">
      <h2>Transaction history</h2>
      {editing && <dialog ref={editDialog} className="transaction-edit-dialog" aria-label="Edit transaction"
        onCancel={event => { event.preventDefault(); closeEditor(); }}>
      <form key={editing.id} aria-label="Edit transaction" onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true; setSaving(true); setEditError("");
        const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Row;
        try {
          const amount = toCents(values.amount);
          if (BigInt(amount) <= 0n) throw new Error("Amount must be positive");
          await execute("editTransaction", { ...values, id: editing.id, amount });
          restoreFocus.current = true; setEditing(undefined); setPageNumber(1); setRetry(v => v + 1);
          await onSaved?.();
        } catch (e) { setEditError(e instanceof Error ? e.message : "Unable to save correction"); }
        finally { savingRef.current = false; setSaving(false); }
      }}>
        <h2>Edit transaction</h2>
        <fieldset disabled={saving}>
        <p>{accounts.find(a => a.id === editing.accountId)?.name} · {editing.kind} · {editing.currency}</p>
        <label>Amount<input name="amount" required inputMode="decimal" autoFocus defaultValue={`${BigInt(editing.amount) / 100n}.${(BigInt(editing.amount) % 100n).toString().padStart(2, "0")}`} /></label>
        <label>Date<input name="date" required type="date" min="1900-01-01" max="9998-12-31" defaultValue={editing.date} /></label>
        <label>Description<input name="description" maxLength={200} defaultValue={editing.description} /></label>
        <label>Transaction category<select name="categoryId" required defaultValue={editing.categoryId}>
          {categories.filter(c => c.kind === editing.kind).map(c => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
        </select></label>
        {editError && <p role="alert">{editError}</p>}
        </fieldset>
        <div className="transaction-edit-actions">
        <button type="button" className="secondary" disabled={saving} onClick={closeEditor}>Cancel</button>
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</button>
        </div>
      </form></dialog>}
      <div className="form-grid">
        <label>
          Start date
          <input
            type="date"
            value={filters.start}
            onChange={(e) => change({ start: e.target.value })}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={filters.end}
            onChange={(e) => change({ end: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            aria-label="Category"
            value={filters.categoryId}
            onChange={(e) =>
              change({ categoryId: e.target.value, subcategoryId: "" })
            }
          >
            <option value="">All categories</option>
            {["INCOME", "EXPENSE"].map((kind) => (
              <optgroup
                key={kind}
                label={kind === "INCOME" ? "Income" : "Expense"}
              >
                {categories
                  .filter((c) => !c.parentId && c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className="history-toolbar">
        <div className="history-filter-actions">
          <button className="secondary history-clear-filters" onClick={() => { setPageNumber(1); onFilters({ ...clearFilters }); }}>Clear filters</button>
          <label className="history-page-size">
            <select aria-label="Rows per page" value={pageSize} onChange={e => { setPageNumber(1); setPageSize(Number(e.target.value)); }}>
              {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        {onAdd && <button onClick={onAdd}><SvgIcon className="button-icon" src={plusIcon} />Add transaction</button>}
      </div>
      {loading && <p role="status">Loading history…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>Retry history</button>
        </div>
      )}
      {page && (
        <>
          {!page.entries.length && (
            <p>
              {page.hasEntries
                ? "No transactions match these filters."
                : "No transactions yet. Add your first transaction."}
            </p>
          )}
          {!!page.entries.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account / category</th>
                    <th>Kind</th>
                    <th className="history-description">Description</th>
                    <th className="history-amount">Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>
                        {accounts.find((a) => a.id === e.accountId)?.name ??
                          e.accountId}
                        <small>
                          {categories.find((c) => c.id === e.categoryId)
                            ?.path ||
                            categories.find((c) => c.id === e.categoryId)
                              ?.name ||
                            "Transfer"}
                        </small>
                      </td>
                      <td className={`history-kind kind-${e.kind.toLowerCase()}`}>{e.kind === "INCOME" ? "Income" : e.kind === "EXPENSE" ? "Expense" : e.kind.replace("_", " ")}</td>
                      <td className="history-description">{e.description || "—"}</td>
                      <td className={`money history-amount kind-${e.kind.toLowerCase()}`}>
                        {formatMoney(e.amount, e.currency)}{" "}
                        <small>{e.currency}</small>
                      </td>
                      <td>{["INCOME", "EXPENSE"].includes(e.kind) && !e.transferId && !e.recurringId && <button className="history-edit" data-edit-entry={e.id} aria-label="Edit transaction" title="Edit transaction" disabled={saving} onClick={() => { returnToEntry.current = e.id; setEditing({ ...e }); setEditError(""); }}><SvgIcon className="button-icon" src={pencilIcon} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {page && page.totalCount > 0 && <nav className="history-pagination" aria-label="History pages">
        <span className="muted">{page.totalCount} transactions · {totalPages} {totalPages === 1 ? "page" : "pages"}</span>
        <div className="history-page-buttons">
          <button aria-label="Previous page" disabled={loading || pageNumber === 1} onClick={() => setPageNumber(n => n - 1)}>Previous</button>
          {historyPages(pageNumber, totalPages).map(n => typeof n === "number"
            ? <button key={n} aria-label={`Page ${n}`} aria-current={n === pageNumber ? "page" : undefined} disabled={loading} onClick={() => setPageNumber(n)}>{n}</button>
            : <span key={n} aria-hidden="true">…</span>)}
          <button aria-label="Next page" disabled={loading || pageNumber >= totalPages} onClick={() => setPageNumber(n => n + 1)}>Next</button>
        </div>
      </nav>}
    </section>
  );
}
