import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMoney, toCents } from "../accounts/money";
import { execute, graphql, type Row, type Snapshot } from "./client";
import "./recurring.css";

const frequencies = {
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};
const today = () => new Date().toISOString().slice(0, 10);

export function Recurring({
  data,
  refresh,
}: {
  data: Snapshot;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Row>();
  const [action, setAction] = useState<{ kind: string; occurrence: Row }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [finding, setFinding] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pendingTitle = useRef<HTMLHeadingElement>(null);
  const editTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editing && editTrigger.current?.isConnected)
      editTrigger.current.focus();
  }, [editing]);
  useEffect(() => {
    if (action) dialog.current?.showModal();
    else if (trigger.current?.isConnected) trigger.current.focus();
    else if (trigger.current) pendingTitle.current?.focus();
  }, [action]);
  useEffect(() => {
    if (action?.kind !== "linkOccurrence") return;
    let cancelled = false;
    setFinding(true);
    setCandidates([]);
    void (async () => {
      const entries: Row[] = [];
      let after = "";
      do {
        const result = await graphql<{
          entryHistory: { entries: Row[]; nextCursor: string };
        }>(
          "query RecurringCandidates($start:String!,$end:String!,$after:String!){entryHistory(start:$start,end:$end,after:$after,limit:100)}",
          {
            start: shiftDate(action.occurrence.date, -14),
            end: shiftDate(action.occurrence.date, 14),
            after,
          },
        );
        if (cancelled) return;
        entries.push(...result.entryHistory.entries);
        after = result.entryHistory.nextCursor;
      } while (after);
      setCandidates(
        entries.filter(
          (e) =>
            !e.recurringId &&
            !e.transferId &&
            e.accountId === action.occurrence.accountId &&
            e.kind === action.occurrence.kind,
        ),
      );
    })()
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Unable to load transactions",
          );
      })
      .finally(() => {
        if (!cancelled) setFinding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [action]);
  const account = (id: string) => data.accounts.find((a) => a.id === id);
  const category = (id: string) =>
    data.categories.find((c) => c.id === id)?.path ||
    data.categories.find((c) => c.id === id)?.name ||
    "Category";
  async function run(kind: string, input: Row) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await execute(kind, input);
      await refresh();
      setNotice("Changes saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const occurrences = [...(data.occurrences ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const pending = occurrences.filter((o) => o.status === "pending");
  const upcoming = occurrences.filter((o) => o.status === "upcoming");
  const recent = occurrences.filter(
    (o) =>
      o.status === "posted" || o.status === "linked" || o.status === "skipped",
  );
  function open(kind: string, occurrence: Row, element: HTMLElement) {
    trigger.current = element;
    setError("");
    setAction({ kind, occurrence });
  }
  function occurrenceList(items: Row[], empty: string) {
    return items.length ? (
      <ul className="item-list recurring-list">
        {items.map((o) => (
          <li key={o.id || `${o.recurringId}:${o.date}`}>
            <div>
              <strong>{o.description || category(o.categoryId)}</strong>
              <small>
                {o.date} · {account(o.accountId)?.name} ·{" "}
                {category(o.categoryId)} ·{" "}
                {o.kind === "INCOME" ? "Income" : "Expense"}
              </small>
              <small>
                {o.status === "upcoming"
                  ? o.mode === "automatic"
                    ? "Will be entered automatically"
                    : "Will need confirmation"
                  : o.status === "pending"
                    ? o.date < today()
                      ? "Overdue · needs confirmation"
                      : "Needs confirmation"
                    : o.status === "linked"
                      ? "Matched to transaction"
                      : o.status === "posted"
                        ? "Entered"
                        : "Skipped"}
              </small>
            </div>
            <div className="recurring-item-actions">
              <span>
                {formatMoney(o.amount, account(o.accountId)?.currency ?? "EUR")}
              </span>
              {o.status === "pending" && (
                <>
                  <button
                    disabled={busy}
                    onClick={(e) =>
                      open("confirmOccurrence", o, e.currentTarget)
                    }
                  >
                    Confirm
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={(e) => open("editOccurrence", o, e.currentTarget)}
                  >
                    Adjust
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run("skipOccurrence", { occurrenceId: o.id })
                    }
                  >
                    Skip
                  </button>
                </>
              )}
              {(o.status === "pending" || o.status === "posted") && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={(e) => open("linkOccurrence", o, e.currentTarget)}
                >
                  Link transaction
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">{empty}</p>
    );
  }
  return (
    <div className="recurring-view">
      <p>
        Plan regular income and expenses. Automatic entries are recorded when
        due. Confirmation items affect your balance only after you confirm or
        link a transaction.
      </p>
      {error && !action && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="panel">
        <h2 ref={pendingTitle} tabIndex={-1}>
          Needs confirmation ({pending.length})
        </h2>
        {occurrenceList(
          pending,
          "You're up to date. No payments need confirmation.",
        )}
      </section>
      <section className="panel">
        <h2>Upcoming · next 90 days</h2>
        {occurrenceList(
          upcoming,
          "No upcoming occurrences. Create a schedule below.",
        )}
      </section>
      <ScheduleForm
        key={editing?.id ?? "new"}
        schedule={editing}
        data={data}
        busy={busy}
        cancel={() => setEditing(undefined)}
        save={async (input) => {
          const ok = await run(editing ? "editRecurring" : "recurring", {
            ...input,
            ...(editing ? { id: editing.id } : {}),
          });
          if (ok) setEditing(undefined);
          return ok;
        }}
      />
      <section className="panel">
        <h2>Schedules</h2>
        <p>
          Editing a schedule changes future occurrences. Existing pending items
          and recorded transactions keep their details.
        </p>
        {!data.recurring.length && <p>No schedules yet.</p>}
        <ul className="item-list recurring-list">
          {data.recurring.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.description || category(s.categoryId)}</strong>
                <small>
                  {account(s.accountId)?.name} ·{" "}
                  {frequencies[s.frequency as keyof typeof frequencies] ??
                    "Monthly"}{" "}
                  · {s.mode === "automatic" ? "Automatic" : "Confirmation"} ·{" "}
                  {s.active === "true" ? `Next ${s.nextDate}` : "Stopped"}
                </small>
              </div>
              <div className="recurring-item-actions">
                <span>
                  {formatMoney(
                    s.amount,
                    account(s.accountId)?.currency ?? "EUR",
                  )}
                </span>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={(e) => {
                    editTrigger.current = e.currentTarget;
                    setEditing(s);
                    setError("");
                  }}
                >
                  Edit schedule
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      s.active === "true" ? "stopRecurring" : "resumeRecurring",
                      { id: s.id },
                    )
                  }
                >
                  {s.active === "true" ? "Stop schedule" : "Resume schedule"}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted">
          Stopping prevents new occurrences. Existing pending items remain
          available to confirm or skip. Resuming includes missed dates.
        </p>
      </section>
      {recent.length > 0 && (
        <section className="panel">
          <h2>Recent occurrences</h2>
          {occurrenceList(recent, "")}
        </section>
      )}
      <dialog
        ref={dialog}
        className="recurring-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setAction(undefined);
        }}
        onClose={() => setAction(undefined)}
        aria-labelledby="occurrence-title"
      >
        {action && (
          <form
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const input = Object.fromEntries(
                new FormData(e.currentTarget),
              ) as Row;
              try {
                if (input.amount) input.amount = toCents(input.amount);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Invalid amount");
                return;
              }
              if (
                await run(action.kind, {
                  ...input,
                  occurrenceId: action.occurrence.id,
                })
              ) {
                dialog.current?.close();
                setAction(undefined);
              }
            }}
          >
            <h2 id="occurrence-title">
              {action.kind === "linkOccurrence"
                ? "Link existing transaction"
                : action.kind === "editOccurrence"
                  ? "Adjust this occurrence"
                  : "Confirm transaction"}
            </h2>
            <p>
              {action.occurrence.description ||
                category(action.occurrence.categoryId)}{" "}
              · {action.occurrence.date}
            </p>
            {action.kind === "linkOccurrence" ? (
              <>
                <p>
                  Select a transaction within 14 days of the due date. Linking
                  replaces a generated entry, so it is counted once.
                </p>
                {finding ? (
                  <p role="status">Loading transactions…</p>
                ) : (
                  <label>
                    Transaction
                    <select
                      aria-label="Transaction"
                      name="entryId"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Choose a transaction…
                      </option>
                      {candidates.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.date} · {e.description || category(e.categoryId)} ·{" "}
                          {formatMoney(
                            e.amount,
                            account(e.accountId)?.currency ?? "EUR",
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!finding && !candidates.length && (
                  <p>No unlinked transactions found in this period.</p>
                )}
              </>
            ) : (
              <div className="form-grid">
                <label>
                  Amount
                  <input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={decimal(action.occurrence.amount)}
                    required
                  />
                </label>
                <label>
                  Description
                  <input
                    name="description"
                    maxLength={200}
                    defaultValue={action.occurrence.description}
                  />
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="actions">
              <button
                disabled={
                  busy ||
                  finding ||
                  (action.kind === "linkOccurrence" && !candidates.length)
                }
              >
                {busy
                  ? "Saving…"
                  : action.kind === "linkOccurrence"
                    ? "Link transaction"
                    : action.kind === "editOccurrence"
                      ? "Save this occurrence"
                      : "Confirm transaction"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
function decimal(cents: string) {
  const n = BigInt(cents);
  return `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
function shiftDate(day: string, offset: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function ScheduleForm({
  schedule,
  data,
  busy,
  cancel,
  save,
}: {
  schedule?: Row;
  data: Snapshot;
  busy: boolean;
  cancel: () => void;
  save: (input: Row) => Promise<boolean>;
}) {
  const [kind, setKind] = useState(schedule?.kind ?? "EXPENSE");
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (schedule) title.current?.focus();
  }, [schedule]);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setError("");
        const input = Object.fromEntries(new FormData(form)) as Row;
        try {
          input.amount = toCents(input.amount);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Invalid amount");
          return;
        }
        if (await save(input)) {
          if (!schedule) {
            form.reset();
            setKind("EXPENSE");
          }
        }
      }}
    >
      <h2 ref={title} tabIndex={-1}>
        {schedule ? "Edit future occurrences" : "Add a recurring transaction"}
      </h2>
      <div className="form-grid">
        <label>
          Kind
          <select
            aria-label="Kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
          </select>
        </label>
        <label>
          Account
          <select
            aria-label="Account"
            name="accountId"
            required
            defaultValue={schedule?.accountId ?? ""}
          >
            <option value="" disabled>
              Choose…
            </option>
            {data.accounts
              .filter((a) => a.archived !== "true")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
          </select>
        </label>
        <label>
          Category (must match kind)
          <select
            aria-label="Category (must match kind)"
            name="categoryId"
            key={kind}
            required
            defaultValue={schedule?.kind === kind ? schedule.categoryId : ""}
          >
            <option value="" disabled>
              Choose…
            </option>
            {data.categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path || c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Amount (decimal, account currency)
          <input
            name="amount"
            inputMode="decimal"
            required
            defaultValue={schedule ? decimal(schedule.amount) : ""}
          />
        </label>
        <label>
          {schedule ? "Next occurrence" : "First occurrence"}
          <input
            name="date"
            type="date"
            min="1900-01-01"
            max="9998-12-31"
            required
            defaultValue={schedule?.nextDate ?? today()}
          />
        </label>
        <label>
          Description
          <input
            name="description"
            maxLength={200}
            defaultValue={schedule?.description}
          />
        </label>
        <label>
          Frequency
          <select
            aria-label="Frequency"
            name="frequency"
            defaultValue={schedule?.frequency ?? "monthly"}
          >
            {Object.entries(frequencies).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          When due
          <select
            aria-label="When due"
            name="mode"
            defaultValue={schedule?.mode ?? "manual"}
          >
            <option value="manual">Ask for confirmation</option>
            <option value="automatic">Enter automatically</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Dates use UTC. Month-end and leap-day schedules use the last available
        day and return to the original day when possible. The app catches up
        when you open it.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : schedule
              ? "Save future occurrences"
              : "Create recurring schedule"}
        </button>
        {schedule && (
          <button
            type="button"
            className="secondary"
            onClick={cancel}
            disabled={busy}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
