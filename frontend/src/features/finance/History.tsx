import { useEffect, useRef, useState } from "react";
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
type Page = { entries: Row[]; nextCursor: string; hasEntries: boolean };
export function History({
  categories,
  accounts,
  filters,
  onFilters,
  onSaved,
}: {
  categories: Row[];
  accounts: Row[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSaved?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Row>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editError, setEditError] = useState("");
  const [cursors, setCursors] = useState([""]);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const after = cursors[cursors.length - 1];
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setPage(undefined);
    void graphql<{ entryHistory: Page }>(
      "query History($start:String,$end:String,$categoryId:String,$subcategoryId:String,$after:String){entryHistory(start:$start,end:$end,categoryId:$categoryId,subcategoryId:$subcategoryId,after:$after)}",
      { ...filters, after },
    )
      .then((result) => {
        if (current) setPage(result.entryHistory);
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
  }, [filters, after, retry]);
  const change = (values: Partial<Filters>) => {
    setCursors([""]);
    onFilters({ ...filters, ...values });
  };
  const children = categories.filter(
    (c) => c.parentId === filters.categoryId && filters.categoryId,
  );
  return (
    <section className="panel">
      <h2>Transaction history</h2>
      {editing && <form key={editing.id} aria-label="Edit transaction" onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true; setSaving(true); setEditError("");
        const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Row;
        try {
          const amount = toCents(values.amount);
          if (BigInt(amount) <= 0n) throw new Error("Amount must be positive");
          await execute("editTransaction", { ...values, id: editing.id, amount });
          setEditing(undefined); setCursors([""]); setRetry(v => v + 1);
          await onSaved?.();
        } catch (e) { setEditError(e instanceof Error ? e.message : "Unable to save correction"); }
        finally { savingRef.current = false; setSaving(false); }
      }}>
        <h3>Edit transaction</h3>
        <p>{accounts.find(a => a.id === editing.accountId)?.name} · {editing.kind} · {editing.currency}</p>
        <label>Amount<input name="amount" required inputMode="decimal" defaultValue={`${BigInt(editing.amount) / 100n}.${(BigInt(editing.amount) % 100n).toString().padStart(2, "0")}`} /></label>
        <label>Date<input name="date" required type="date" min="1900-01-01" max="9998-12-31" defaultValue={editing.date} /></label>
        <label>Description<input name="description" maxLength={200} defaultValue={editing.description} /></label>
        <label>Transaction category<select name="categoryId" required defaultValue={editing.categoryId}>
          {categories.filter(c => c.kind === editing.kind).map(c => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
        </select></label>
        {editError && <p role="alert">{editError}</p>}
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</button>
        <button type="button" disabled={saving} onClick={() => setEditing(undefined)}>Cancel</button>
      </form>}
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
        <label>
          Subcategory
          <select
            aria-label="Subcategory"
            disabled={!children.length}
            value={filters.subcategoryId}
            onChange={(e) => change({ subcategoryId: e.target.value })}
          >
            <option value="">All subcategories</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="secondary"
        onClick={() => {
          setCursors([""]);
          onFilters({ ...clearFilters });
        }}
      >
        Clear filters
      </button>
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
                    <th>Description</th>
                    <th>Kind</th>
                    <th>Amount</th>
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
                      <td>{e.description || "—"}</td>
                      <td>{e.kind.replace("_", " ")}</td>
                      <td className="money">
                        {formatMoney(e.amount, e.currency)}{" "}
                        <small>{e.currency}</small>
                      </td>
                      <td>{["INCOME", "EXPENSE"].includes(e.kind) && !e.transferId && !e.recurringId && <button disabled={saving} onClick={() => { setEditing({ ...e }); setEditError(""); }}>Edit transaction</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="actions" aria-label="History pages">
        <button
          disabled={loading || cursors.length === 1}
          onClick={() => setCursors((v) => v.slice(0, -1))}
        >
          Newer
        </button>
        <span>Page {cursors.length}</span>
        <button
          disabled={loading || !page?.nextCursor}
          onClick={() => setCursors((v) => [...v, page!.nextCursor])}
        >
          Older
        </button>
      </div>
      <p className="muted">
        Latest 10 entries per page, across all dates. Transfers appear as linked
        outgoing and incoming entries.
      </p>
    </section>
  );
}
