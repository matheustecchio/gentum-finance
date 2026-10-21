import { Databases } from "../security/Databases";
import { CategoryColor } from "./CategoryColor";
import "./categories.css";
import { OverviewCharts, PrimaryCurrency } from "./Overview";
import { History, clearFilters, type Filters } from "./History";
import trashIcon from "../../assets/icons/trash.svg";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  options?: { value: string; label: string; kind?: string }[];
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
  onBusy,
}: {
  onBusy?: (busy: boolean) => void;
  title: string;
  fields: Field[];
  submit: string;
  onSubmit: (values: Row) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedKind, setSelectedKind] = useState("");
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await onSubmit(Object.fromEntries(new FormData(form).entries()) as Row);
      form.reset();
      setSelectedKind("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
      onBusy?.(false);
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
                key={
                  field.name === "categoryId" || field.name === "parentId"
                    ? selectedKind
                    : field.name
                }
                onChange={
                  field.name === "kind"
                    ? (e) => setSelectedKind(e.target.value)
                    : undefined
                }
                defaultValue={field.value ?? ""}
                required={!field.optional}
              >
                <option value="" disabled={!field.optional}>
                  Choose…
                </option>
                {field.options
                  .filter(
                    (option) =>
                      !fields.some((f) => f.name === "kind") ||
                      !("kind" in option) ||
                      option.kind === selectedKind,
                  )
                  .map((option) => (
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
  "Transactions",
  "Transfers",
  "Budgets",
  "Recurring",
  "Import & export",
  "Settings",
];
export function FinanceApp() {
  const [setupDismissed, setSetupDismissed] = useState(false);
  return (
    <LocalAccess>
      <Wallet
        setupDismissed={setupDismissed}
        dismissSetup={() => setSetupDismissed(true)}
      />
    </LocalAccess>
  );
}
function Wallet({
  setupDismissed,
  dismissSetup,
}: {
  setupDismissed: boolean;
  dismissSetup: () => void;
}) {
  const { status, lock } = useLocalAccess();
  const [filters, setFilters] = useState<Filters>({ ...clearFilters });
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [deleting, setDeleting] = useState<Row>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    if (deleting) deleteDialog.current?.showModal();
    else deleteTrigger.current?.focus();
  }, [deleting]);
  const [tab, setTab] = useState("Overview");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [data, setData] = useState<Snapshot>(empty);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [csv, setCsv] = useState("");
  const [importAccount, setImportAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState<"account" | "category">();
  const [createBusy, setCreateBusy] = useState(false);
  const createTrigger = useRef<HTMLButtonElement | null>(null);
  const openCreation = (
    kind: "account" | "category",
    trigger: HTMLButtonElement,
  ) => {
    createTrigger.current = trigger;
    setCreating(kind);
  };
  const closeCreation = () => setCreating(undefined);
  useEffect(() => {
    if (!creating) createTrigger.current?.focus();
  }, [creating]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphql<{ financeSummary: Snapshot }>(
        "query Finance($month:String!){financeSummary(month:$month)}",
        { month },
      );
      setData(result.financeSummary);
      setLoaded(true);
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
      ...(row.kind ? { kind: row.kind } : {}),
      label:
        (row.path || row.name) +
        (row.currency ? ` · ${row.currency}` : ` · ${row.kind.toLowerCase()}`),
    }));
  const account = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name ?? id;
  const category = (id: string) =>
    data.categories.find((c) => c.id === id)?.path ||
    data.categories.find((c) => c.id === id)?.name ||
    "Transfer";
  const eligibleAccounts = data.accounts.filter((a) => a.archived !== "true");
  const destination =
    eligibleAccounts.find((a) => a.id === importAccount) ??
    (eligibleAccounts.length === 1 ? eligibleAccounts[0] : undefined);
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
        <p className="eyebrow">YOUR LOCAL WALLET</p>
        <nav aria-label="Main navigation">
          <div className="navigation-links">
            {tabs.map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => {
                  setTab(t);
                  setNotice("");
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className={`add-transaction ${tab === "Add transaction" ? "active" : ""}`}
            aria-current={tab === "Add transaction" ? "page" : undefined}
            onClick={() => {
              setTab("Add transaction");
              setNotice("");
            }}
          >
            <span aria-hidden="true">+ </span>Add transaction
          </button>
        </nav>
        <div className="profile">
          <small>
            Local wallet
            <span className="app-version">
              v{__APP_VERSION__}
              {import.meta.env.DEV ? " (dev)" : ""}
            </span>
          </small>
          {status.pinEnabled && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await lock();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Unable to lock wallet",
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
            {status.databaseName && <p className="active-database">Database: <strong>{status.databaseName}</strong></p>}
            <p>Every amount accounted for. Your wealth in perspective.</p>
          </div>
          <label>
            Reporting month
            <input
              aria-label="Reporting month"
              type="month"
              value={month}
              min="1900-01"
              max="9998-12"
              onChange={(e) => {
                if (
                  /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
                  e.target.value >= "1900-01" &&
                  e.target.value <= "9998-12"
                )
                  setMonth(e.target.value);
              }}
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
        {loaded &&
          !loading &&
          !error &&
          !setupDismissed &&
          (!data.accounts.length || !data.categories.length) && (
            <section className="panel" aria-labelledby="setup-title">
              <h2 id="setup-title">Complete your wallet setup</h2>
              <p>
                {!data.accounts.length && !data.categories.length
                  ? "Create an account and categories to start recording transactions."
                  : !data.accounts.length
                    ? "Create an account to start recording transactions."
                    : "Create categories to organize your transactions."}
              </p>
              <div className="actions">
                <button
                  onClick={() => {
                    dismissSetup();
                    setTab("Settings");
                  }}
                >
                  Open Settings
                </button>
                <button className="secondary" onClick={dismissSetup}>
                  Configure later
                </button>
              </div>
            </section>
          )}
        {tab === "Overview" && (
          <>
            {loaded && !error && (
              <OverviewCharts snapshot={data} month={month} />
            )}
            {!data.accounts.length && (
              <section className="panel empty">
                <h2>A fresh start</h2>
                <p>
                  Create an account, add categories, then record your first
                  transaction.
                </p>
                <button onClick={() => setTab("Settings")}>
                  Create your first account
                </button>
              </section>
            )}
          </>
        )}
        {tab === "Settings" && (
          <>
            <PrimaryCurrency />
            <AccountList
              rows={data.accounts}
              onCreate={(e) => openCreation("account", e.currentTarget)}
            />
            {creating === "account" && (
              <CreationDialog
                title="Create account"
                busy={createBusy}
                onClose={closeCreation}
              >
                <Form
                  onBusy={setCreateBusy}
                  title="Add an account"
                  submit="Create account"
                  fields={[
                    { name: "name", label: "Account name" },
                    {
                      name: "type",
                      label: "Account type",
                      options: [
                        "CURRENT",
                        "SAVINGS",
                        "CASH",
                        "CREDIT_CARD",
                      ].map((value) => ({
                        value,
                        label: value.replace("_", " "),
                      })),
                    },
                    {
                      name: "currency",
                      label: "Currency",
                      options: currencies,
                    },
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
                    closeCreation();
                  }}
                />
              </CreationDialog>
            )}
          </>
        )}
        {tab === "Settings" && (
          <>
            {creating === "category" && (
              <CreationDialog
                title="Create category"
                busy={createBusy}
                onClose={closeCreation}
              >
                <Form
                  onBusy={setCreateBusy}
                  title="Add a category"
                  submit="Create category"
                  fields={[
                    { name: "name", label: "Category name" },
                    { name: "kind", label: "Kind", options: kinds },
                    {
                      name: "parentId",
                      label: "Parent category (optional)",
                      optional: true,
                      options: options(
                        data.categories.filter((c) => !c.parentId),
                      ),
                    },
                  ]}
                  onSubmit={async (values) => {
                    await save("category", values);
                    closeCreation();
                  }}
                />
              </CreationDialog>
            )}
            <section className="panel">
              <div className="section-heading">
                <h2>Your categories</h2>
                <button
                  onClick={(e) => openCreation("category", e.currentTarget)}
                >
                  Create category
                </button>
              </div>
              <button onClick={() => void act("starterCategories")}>
                Add categories
              </button>
              <ul className="item-list category-list">
                {data.categories.map((c) => (
                  <li key={c.id}>
                    <div className="category-identity">
                      <CategoryColor category={c} />
                      <strong>{c.path || c.name}</strong>
                      <span className={`badge category-kind-${c.kind.toLowerCase()}`}>
                        {c.kind === "INCOME" ? "Income" : "Expense"}
                      </span>
                    </div>
                    <button
                      className="delete-category"
                      aria-label={`Delete ${c.path || c.name}`}
                      onClick={(e) => {
                        deleteTrigger.current = e.currentTarget;
                        setDeleting(c);
                        setDeleteError("");
                      }}
                    >
                      <img src={trashIcon} alt="" />
                    </button>
                  </li>
                ))}
              </ul>
              {!data.categories.length && <p>No categories yet.</p>}
            </section>
          </>
        )}
        {tab === "Settings" && <>{status.databaseId && <Databases />}<AccessSettings /></>}
        {tab === "Add transaction" && (
          <Form
            title="Record a transaction"
            submit="Save transaction"
            fields={entryFields}
            onSubmit={(values) => save("transaction", values)}
          />
        )}
        {tab === "Transactions" && (
          <History
            categories={data.categories}
            accounts={data.accounts}
            filters={filters}
            onFilters={setFilters}
          />
        )}
        {deleting && (
          <dialog
            ref={deleteDialog}
            aria-labelledby="delete-category-title"
            className="category-dialog"
            onCancel={(e) => {
              e.preventDefault();
              if (!deleteBusy) setDeleting(undefined);
            }}
          >
            <div className="panel">
              <h2 id="delete-category-title">
                Delete {deleting.path || deleting.name}?
              </h2>
              <p>
                Only categories without children, transactions, budgets or
                schedules can be deleted.
              </p>
              {deleteError && <p role="alert">{deleteError}</p>}
              <div className="actions">
                <button
                  autoFocus
                  disabled={deleteBusy}
                  onClick={() => setDeleting(undefined)}
                >
                  Cancel
                </button>
                <button
                  className="delete-category-confirm"
                  disabled={deleteBusy}
                  onClick={async () => {
                    setDeleteBusy(true);
                    setDeleteError("");
                    try {
                      await execute("deleteCategory", { id: deleting.id });
                      setFilters((f) =>
                        f.categoryId === deleting.id
                          ? { ...f, categoryId: "", subcategoryId: "" }
                          : f.subcategoryId === deleting.id
                            ? { ...f, subcategoryId: "" }
                            : f,
                      );
                      setNotice("Category deleted");
                      setDeleting(undefined);
                      await load();
                    } catch (e) {
                      setDeleteError(
                        e instanceof Error
                          ? e.message
                          : "Unable to delete category",
                      );
                    } finally {
                      setDeleteBusy(false);
                    }
                  }}
                >
                  {deleteBusy ? "Deleting…" : "Delete category"}
                </button>
              </div>
            </div>
          </dialog>
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
                        {account(r.accountId)} · {category(r.categoryId)} ·{" "}
                        {r.kind} · next {r.nextDate} ·{" "}
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
              <code>date,kind,category_id,amount_cents,description</code>
            </p>
            <label>
              Import into account
              <select
                aria-label="Import into account"
                value={destination?.id ?? ""}
                onChange={(e) => setImportAccount(e.target.value)}
              >
                <option value="">Choose an account…</option>
                {eligibleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
            {destination ? (
              <p>
                Destination: {destination.name} · {destination.currency}
              </p>
            ) : (
              <p>
                {eligibleAccounts.length
                  ? "Choose the destination account before importing."
                  : "Create an account before importing."}
              </p>
            )}
            <p>
              Legacy compatibility: six-column files with account_id keep each
              row’s original account, regardless of this selection.
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
                disabled={
                  !csv ||
                  (!destination &&
                    !csv.startsWith(
                      "date,account_id,category_id,kind,amount_cents,description",
                    ))
                }
                onClick={() =>
                  void act("import", { csv, accountId: destination?.id ?? "" })
                }
              >
                Import CSV
              </button>
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const result = await execute("export", {});
                    const url = URL.createObjectURL(
                      new Blob(
                        [Uint8Array.from(atob(result), (c) => c.charCodeAt(0))],
                        { type: "application/zip" },
                      ),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "gentum-transactions.zip";
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
                  setCsv("date,kind,category_id,amount_cents,description\n")
                }
              >
                Use CSV template
              </button>
            </div>
            <h3>Category IDs</h3>
            {data.categories.map((c) => (
              <p key={c.id}>
                {c.path || c.name} ({c.kind}) · <code>{c.id}</code>
              </p>
            ))}
            <p className="muted">
              Exports include a separate CSV for every account in a ZIP, named
              by account and currency, with all income and expenses across all
              dates. Linked transfers and schedules are excluded. Spreadsheet
              formula prefixes are escaped with an apostrophe.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
function AccountList({
  rows,
  onCreate,
}: {
  rows: Row[];
  onCreate?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Your accounts</h2>
        {onCreate && <button onClick={onCreate}>Create account</button>}
      </div>
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

function CreationDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="category-dialog creation-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        );
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
      <div className="dialog-footer">
        <button className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
