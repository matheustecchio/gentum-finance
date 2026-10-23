import { useEffect, useRef, useState } from "react";
import { databaseScope, graphql, type Row } from "./client";
import "./csv-import.css";

export const MAX_CSV_BYTES = 32 * 1024 * 1024;
export interface ImportJob {
  id: string; status: "running" | "committed" | "failed" | "cancelled";
  total: number; processed: number; message: string;
}
const key = (scope: string) => `gentum:csv-import:${scope}`;
async function operation(action: string, input: Row) {
  return (await graphql<{ csvImport: ImportJob }>(
    "mutation CSVImport($action:String!,$input:FinanceInput!){csvImport(action:$action,input:$input)}",
    { action, input },
  )).csvImport;
}

export function useCSVImport(onComplete: (message: string) => Promise<void>) {
  const [job, setJob] = useState<ImportJob>();
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pending = useRef(false);
  const cancelRequested = useRef(false);
  const active = useRef<{ id: string; scope: string } | undefined>(undefined);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const complete = useRef(onComplete); complete.current = onComplete;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (job) dialog.current?.showModal(); }, [job]);
  const current = () => mounted.current && active.current?.scope === databaseScope();

  async function follow(initial: ImportJob) {
    let next = initial;
    while (current()) {
      active.current!.id = next.id;
      localStorage.setItem(key(active.current!.scope), next.id);
      setJob(next);
      if (next.status !== "running") {
        localStorage.removeItem(key(active.current!.scope));
        pending.current = false; setBusy(false); setUnknown(false); setCancelling(false);
        if (next.status === "committed") await complete.current(next.message);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      if (!current()) return;
      next = await operation(cancelRequested.current ? "cancel" : "status", { id: next.id });
    }
  }
  function uncertain() {
    if (current()) { setUnknown(true); setChecking(false); }
    // Keep the checkpoint and block a second import until its outcome is known.
  }
  async function check(id: string, scope: string) {
    if (pending.current && !unknown) return;
    active.current = { id, scope }; pending.current = true; setBusy(true); setChecking(true); setUnknown(false);
    setJob(previous => previous ?? { id, status: "running", total: 0, processed: 0, message: "" });
    try { await follow(await operation("status", { id })); }
    catch { uncertain(); }
    finally { if (current()) setChecking(false); }
  }
  useEffect(() => {
    const scope = databaseScope(); const id = localStorage.getItem(key(scope));
    if (id) void check(id, scope);
    // This hook belongs to the authenticated ledger view; remount on selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(input: Row, count: number) {
    if (pending.current) return;
    trigger.current = document.activeElement as HTMLElement;
    const scope = databaseScope(); const id = crypto.randomUUID();
    // Save the operation ID before sending. A lost acknowledgement is recoverable.
    localStorage.setItem(key(scope), id);
    active.current = { id, scope }; pending.current = true; cancelRequested.current = false;
    setBusy(true); setUnknown(false); setCancelling(false);
    setJob({ id, status: "running", total: count, processed: 0, message: "" });
    try { await follow(await operation("start", { ...input, id })); }
    catch { uncertain(); }
  }
  const terminal = job && job.status !== "running";
  const popup = job && <dialog ref={dialog} className="csv-import-dialog" aria-labelledby="csv-import-title" onCancel={e => e.preventDefault()}>
    <h2 id="csv-import-title">{unknown ? "Import status unavailable" : job.status === "committed" ? "Import complete" : terminal ? "Import rolled back" : "Importing transactions"}</h2>
    {unknown ? <p>We could not confirm the result. Your import may have completed. Check its status before importing again.</p> : terminal ? <p role={job.status === "committed" ? "status" : "alert"}>{job.message}</p> : <>
      <p role="status">{cancelling ? "Cancelling and rolling back…" : job.total ? `${job.processed.toLocaleString()} of ${job.total.toLocaleString()} records processed` : "Checking your previous import…"}</p>
      <progress aria-label="Import progress" max={job.total || 1} value={job.processed} />
      {!!job.total && <p>{Math.max(0, job.total - job.processed).toLocaleString()} records remaining</p>}
      <p>{job.processed === job.total && job.total ? "Checking totals and saving the complete import…" : "Transactions are saved only when the entire import succeeds."}</p>
    </>}
    <div className="actions">
      {unknown ? <button disabled={checking} onClick={() => void check(active.current!.id, active.current!.scope)}>Check import status</button> : !terminal ? <button className="secondary" disabled={cancelling} onClick={() => { cancelRequested.current = true; setCancelling(true); }}>Cancel import</button> : <button onClick={() => { dialog.current?.close(); setJob(undefined); trigger.current?.focus(); }}>Close</button>}
    </div>
  </dialog>;
  return { start, busy, popup };
}
