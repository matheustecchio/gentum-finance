import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  LocalAccess,
  useLocalAccess,
  AccessSettings,
} from "../security/LocalAccess";
import { formatMoney, toCents } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";

type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
};
const currencies = ["EUR", "GBP", "USD", "BRL"].map((value) => ({
  value,
  label: value,
}));
const kinds = ["EXPENSE", "INCOME"].map((value) => ({
  value,
  label: value === "EXPENSE" ? "Expense" : "Income",
}));
const today = () => new Date().toISOString().slice(0, 10);
function Form({
  title,
  fields,
  submit,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  submit: string;
  onSubmit: (values: Row) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await onSubmit(Object.fromEntries(new FormData(form).entries()) as Row);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={send}>
      <h2>{title}</h2>
      <div className="form-grid">
        {fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select
                aria-label={field.label}
                name={field.name}
                defaultValue={field.value ?? ""}
                required={!field.optional}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                defaultValue={field.value}
                required={!field.optional}
                maxLength={
                  field.type === "password"
                    ? 256
                    : field.type === "email"
                      ? 320
                      : 200
                }
                {...(field.name === "amount" || field.name === "initialBalance"
                  ? { inputMode: "decimal", placeholder: "0.00" }
                  : {})}
              />
            )}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy} type="submit">
        {busy ? "Saving…" : submit}
      </button>
    </form>
  );
}
const empty: Snapshot = {
  accounts: [],
  categories: [],
  entries: [],
  budgets: [],
  recurring: [],
  totals: [],
};
const tabs = [
  "Overview",
  "Accounts",
  "Categories",
  "Transactions",
  "Transfers",
  "Budgets",
  "Recurring",
  "Import & export",
  "Settings",
];
export function FinanceApp() {
  return (
    <LocalAccess>
      <Ledger />
    </LocalAccess>
  );
}
function Ledger() {
  const { status, lock } = useLocalAccess();
  const [tab, setTab] = useState("Overview");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [data, setData] = useState<Snapshot>(empty);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphql<{ finance: Snapshot }>(
        "query Finance($month:String!){finance(month:$month)}",
        { month },
      );
      setData(result.finance);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    } finally {
      setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (action: string, input: Row) => {
    const values = { ...input };
    if (values.amount) values.amount = toCents(values.amount);
    const result = await execute(action, values);
    setNotice(result);
    await load();
  };
  const act = async (action: string, input: Row = {}) => {
    setError("");
    try {
      setNotice(await execute(action, input));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    }
  };
  const options = (rows: Row[]) =>
    rows.map((row) => ({
      value: row.id,
      label:
        row.name +
        (row.currency ? ` · ${row.currency}` : ` · ${row.kind.toLowerCase()}`),
    }));
  const account = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name ?? id;
  const category = (id: string) =>
    data.categories.find((a) => a.id === id)?.name ?? "Transfer";
  const entryFields: Field[] = [
    { name: "kind", label: "Kind", options: kinds },
    { name: "accountId", label: "Account", options: options(data.accounts) },
    {
      name: "categoryId",
      label: "Category (must match kind)",
      options: options(data.categories),
    },
    { name: "amount", label: "Amount (decimal, account currency)" },
    { name: "date", label: "Date", type: "date", value: today() },
    { name: "description", label: "Description", optional: true },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">G</span>Gentum Finance
        </a>
        <p className="eyebrow">YOUR LOCAL LEDGER</p>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setNotice("");
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="profile">
          <small>
            Local ledger · {status.pinEnabled ? "PIN enabled" : "No PIN"}
          </small>
          {status.pinEnabled && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await lock();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to lock ledger",
                  );
                }
              }}
            >
              Lock now
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
            <h1>{tab}</h1>
            <p>Every amount accounted for. Each currency kept separate.</p>
          </div>
          <label>
            Reporting month
            <input
              aria-label="Reporting month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        </header>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading && <p role="status">Refreshing…</p>}
        {tab === "Settings" && <AccessSettings />}
        {tab === "Overview" && (
          <>
            <div className="stats-grid">
              {data.totals.map((t) => (
                <article className="panel stat" key={t.currency}>
                  <span className="eyebrow">
                    {t.currency} · {month}
                  </span>
                  <h2>Monthly cash flow</h2>
                  <p>
                    Income <strong>{formatMoney(t.income, t.currency)}</strong>
                  </p>
                  <p>
                    Expenses{" "}
                    <strong>{formatMoney(t.expense, t.currency)}</strong>
                  </p>
                  <p>
                    Net <strong>{formatMoney(t.net, t.currency)}</strong>
                  </p>
                </article>
              ))}
            </div>
            <AccountList rows={data.accounts} />
            {!data.accounts.length && (
              <section className="panel empty">
                <h2>A fresh start</h2>
                <p>
                  Create an account, add categories, then record your first
                  transaction.
                </p>
                <button onClick={() => setTab("Accounts")}>
                  Create your first account
                </button>
              </section>
            )}
          </>
        )}
        {tab === "Accounts" && (
          <>
            <Form
              title="Add an account"
              submit="Create account"
              fields={[
                { name: "name", label: "Account name" },
                {
                  name: "type",
                  label: "Account type",
                  options: ["CURRENT", "SAVINGS", "CASH", "CREDIT_CARD"].map(
                    (value) => ({ value, label: value.replace("_", " ") }),
                  ),
                },
                { name: "currency", label: "Currency", options: currencies },
                {
                  name: "initialBalance",
                  label: "Opening balance",
                  value: "0.00",
                },
              ]}
              onSubmit={async (values) => {
                await graphql(
                  "mutation Account($input:CreateAccountInput!){createAccount(input:$input){id}}",
                  {
                    input: {
                      ...values,
                      initialBalance: toCents(values.initialBalance),
                    },
                  },
                );
                setNotice("Account created");
                await load();
              }}
            />
            <AccountList rows={data.accounts} />
          </>
        )}
        {tab === "Categories" && (
          <>
            <Form
              title="Add a category"
              submit="Create category"
              fields={[
                { name: "name", label: "Category name" },
                { name: "kind", label: "Kind", options: kinds },
              ]}
              onSubmit={(values) => save("category", values)}
            />
            <section className="panel">
              <h2>Your categories</h2>
              <ul className="item-list">
                {data.categories.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span className="badge">{c.kind}</span>
                  </li>
                ))}
              </ul>
              {!data.categories.length && <p>No categories yet.</p>}
            </section>
          </>
        )}
        {tab === "Transactions" && (
          <>
            <Form
              title="Record a transaction"
              submit="Save transaction"
              fields={entryFields}
              onSubmit={(values) => save("transaction", values)}
            />
            <section className="panel">
              <h2>Transactions · {month}</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Account / category</th>
                      <th>Description</th>
                      <th>Kind</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries
                      .filter((e) => e.date.startsWith(month))
                      .map((e) => (
                        <tr key={e.id}>
                          <td>{e.date}</td>
                          <td>
                            {account(e.accountId)}
                            <small>{category(e.categoryId)}</small>
                          </td>
                          <td>{e.description || "—"}</td>
                          <td>{e.kind.replace("_", " ")}</td>
                          <td className="money">
                            {formatMoney(e.amount, e.currency)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Transfers appear as linked outgoing and incoming entries.
              </p>
            </section>
          </>
        )}
        {tab === "Transfers" && (
          <>
            <Form
              title="Move money between accounts"
              submit="Save transfer"
              fields={[
                {
                  name: "fromId",
                  label: "From account",
                  options: options(data.accounts),
                },
                {
                  name: "toId",
                  label: "To account (same currency)",
                  options: options(data.accounts),
                },
                { name: "amount", label: "Amount" },
                { name: "date", label: "Date", type: "date", value: today() },
                { name: "description", label: "Description", optional: true },
              ]}
              onSubmit={(values) => save("transfer", values)}
            />
            <p className="muted">
              Both entries are saved together. Currency conversion is not
              supported.
            </p>
          </>
        )}
        {tab === "Budgets" && (
          <>
            <Form
              title="Set a monthly budget"
              submit="Save budget"
              fields={[
                {
                  name: "categoryId",
                  label: "Expense category",
                  options: options(
                    data.categories.filter((c) => c.kind === "EXPENSE"),
                  ),
                },
                { name: "currency", label: "Currency", options: currencies },
                {
                  name: "month",
                  label: "Budget month",
                  type: "month",
                  value: month,
                },
                { name: "amount", label: "Monthly limit" },
              ]}
              onSubmit={(values) => save("budget", values)}
            />
            <div className="stats-grid">
              {data.budgets.map((b) => {
                const percent = (BigInt(b.spent) * 100n) / BigInt(b.amount);
                return (
                  <article className="panel" key={b.id}>
                    <h2>{category(b.categoryId)}</h2>
                    <p>
                      {formatMoney(b.spent, b.currency)} of{" "}
                      {formatMoney(b.amount, b.currency)}
                    </p>
                    <progress
                      max="100"
                      value={Number(percent > 100n ? 100n : percent)}
                      aria-label={`${category(b.categoryId)} budget usage`}
                    />
                    <p>
                      {percent.toString()}% used
                      {percent > 100n ? " · Over budget" : ""}
                    </p>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {tab === "Recurring" && (
          <>
            <Form
              title="Add a monthly recurring transaction"
              submit="Create recurring schedule"
              fields={entryFields.map((f) =>
                f.name === "date" ? { ...f, label: "First occurrence" } : f,
              )}
              onSubmit={(values) => save("recurring", values)}
            />
            <section className="panel">
              <h2>Monthly schedules</h2>
              <p>
                Run due creates occurrences through today (UTC). Running again
                is safe. Month-end dates retain their original day when
                possible.
              </p>
              <button onClick={() => void act("runDue")}>
                Run due transactions
              </button>
              <ul className="item-list">
                {data.recurring.map((r) => (
                  <li key={r.id}>
                    <div>
                      <strong>{r.description || category(r.categoryId)}</strong>
                      <small>
                        {account(r.accountId)} · {r.kind} · next {r.nextDate} ·{" "}
                        {r.active === "true" ? "Active" : "Stopped"}
                      </small>
                    </div>
                    <span>
                      {formatMoney(
                        r.amount,
                        data.accounts.find((a) => a.id === r.accountId)
                          ?.currency ?? "EUR",
                      )}
                    </span>
                    {r.active === "true" && (
                      <button
                        className="secondary"
                        onClick={() => void act("stopRecurring", { id: r.id })}
                      >
                        Stop schedule
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {tab === "Import & export" && (
          <section className="panel">
            <h2>Portable transaction CSV</h2>
            <p>
              Import income and expense transactions using exact integer cents
              (100 = 1.00). Create accounts and categories first. Imports are
              all-or-nothing; importing the same file again creates duplicates.
            </p>
            <p>
              Header:{" "}
              <code>
                date,account_id,category_id,kind,amount_cents,description
              </code>
            </p>
            <label>
              Choose CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 500000) {
                      setError("Use a CSV below 500 KB");
                      return;
                    }
                    setCsv(await file.text());
                  }
                }}
              />
            </label>
            <label>
              CSV content
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={8}
              />
            </label>
            <div className="actions">
              <button
                disabled={!csv}
                onClick={() => void act("import", { csv })}
              >
                Import CSV
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const result = await execute("export", {});
                    const url = URL.createObjectURL(
                      new Blob([result], { type: "text/csv;charset=utf-8" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "gentum-transactions.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Export CSV
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setCsv(
                    "date,account_id,category_id,kind,amount_cents,description\n",
                  )
                }
              >
                Use CSV template
              </button>
            </div>
            <h3>Account IDs</h3>
            {data.accounts.map((a) => (
              <p key={a.id}>
                {a.name} · <code>{a.id}</code>
              </p>
            ))}
            <h3>Category IDs</h3>
            {data.categories.map((c) => (
              <p key={c.id}>
                {c.name} ({c.kind}) · <code>{c.id}</code>
              </p>
            ))}
            <p className="muted">
              Exports contain all income and expenses, across all dates. Linked
              transfers and schedules are excluded. Spreadsheet formula prefixes
              are escaped with an apostrophe.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
function AccountList({ rows }: { rows: Row[] }) {
  return (
    <section className="panel">
      <h2>Your accounts</h2>
      <ul className="item-list">
        {rows.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.name}</strong>
              <small>
                {a.type.replace("_", " ")} · {a.currency}
              </small>
            </div>
            <strong className="money">
              {formatMoney(a.balance, a.currency)}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
