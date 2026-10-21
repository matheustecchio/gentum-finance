import { useEffect, useState, type FormEvent } from "react";
import { request } from "../finance/client";
import { PINField, RecoveryNotice, signalChange, useLocalAccess } from "./LocalAccess";

interface Database { id: string; name: string; pinEnabled: boolean }
interface DatabaseList { activeId: string; databases: Database[] }

export function Databases() {
  const { refresh, showRecovery } = useLocalAccess();
  const [list, setList] = useState<DatabaseList>();
  const [editing, setEditing] = useState<Database>();
  const [selecting, setSelecting] = useState<Database>();
  const [recover, setRecover] = useState(false);
  const [creating, setCreating] = useState(false);
  const [usePIN, setUsePIN] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => setList(await request<DatabaseList>("/databases"));
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  async function select(database: Database, pin?: string, recoveryCode?: string) {
    setBusy(true); setError("");
    try {
      const result = await request<{recoveryCode?: string}>("/databases/select", { id: database.id, ...(pin ? { pin } : {}), ...(recoveryCode ? { recoveryCode } : {}) });
      signalChange();
      if (result.recoveryCode) showRecovery(result.recoveryCode);
      else window.dispatchEvent(new Event("gentum:database-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select database");
    } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError(""); setNotice("");
    try {
      const name = String(values.name).trim();
      if (!name) throw new Error("Enter a database name.");
      if (name.length > 100) throw new Error("Use at most 100 characters.");
      if (usePIN && !editing && values.pin !== values.confirmPin) throw new Error("PINs do not match");
      const result = await request<{ recoveryCode?: string }>(editing ? "/databases/rename" : "/databases/create", editing
        ? { id: editing.id, name }
        : { name, mode: usePIN ? "pin" : "open", ...(usePIN ? { pin: values.pin } : {}) });
      if (result.recoveryCode) setRecovery(result.recoveryCode);
      await load();
      if (editing) { await refresh(); signalChange(); }
      setCreating(false); setEditing(undefined); setUsePIN(false);
      if (result.recoveryCode) setRecovery(result.recoveryCode);
      else setNotice(editing ? "Database renamed." : "Database created. Select it to open its wallet.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save database");
    } finally { setBusy(false); }
  }
  if (recovery) return <section className="panel"><p>The new database is ready. Your current database stays selected.</p><RecoveryNotice code={recovery} onDone={() => { setRecovery(""); setNotice("Database created. Select it to open its wallet."); }} /></section>;
  return <section className="panel">
    <h2>Databases</h2>
    <p>Keep separate wallets on this computer. Each database has its own financial data and optional PIN.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!list && !error && <p role="status">Loading databases…</p>}
    <ul className="database-list">{list?.databases.map(database => <li key={database.id}>
      <div><strong>{database.name}</strong><small>{database.id === list.activeId ? "Active database" : database.pinEnabled ? "PIN protected" : "Direct access"}</small></div>
      <div className="actions">
        <button type="button" disabled={busy || database.id === list.activeId || creating || !!editing || !!selecting} onClick={() => {
          setError(""); setNotice("");
          if (database.pinEnabled) { setRecover(false); setSelecting(database); } else void select(database);
        }}>{database.id === list.activeId ? "Selected" : `Open ${database.name}`}</button>
        <button type="button" className="secondary" disabled={busy || creating || !!editing || !!selecting} onClick={() => { setError(""); setEditing(database); }}>Rename {database.name}</button>
      </div>
    </li>)}</ul>
    {selecting && <form aria-label={`Unlock ${selecting.name}`} onSubmit={e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.currentTarget));
      if (recover && values.pin !== values.confirmPin) { setError("PINs do not match"); return; }
      void select(selecting, String(values.pin), recover ? String(values.recoveryCode) : undefined);
    }}>
      <h3>{recover ? "Reset PIN for" : "Open"} {selecting.name}</h3>
      {recover && <label>Database recovery code<input name="recoveryCode" required maxLength={100} autoComplete="off" /></label>}
      <PINField name="pin" label={recover ? "Replacement database PIN" : "Database PIN"} />
      {recover && <PINField name="confirmPin" label="Confirm replacement PIN" />}
      <button type="submit" disabled={busy}>{busy ? "Opening…" : recover ? "Reset PIN and open database" : "Unlock database"}</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setRecover(!recover); setError(""); }}>{recover ? "Back to database PIN" : "Forgot this database PIN?"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setSelecting(undefined); setError(""); }}>Cancel</button>
    </form>}
    {(creating || editing) && <form aria-label={editing ? "Rename database" : "Create database"} onSubmit={save}>
      <h3>{editing ? "Rename database" : "Create database"}</h3>
      <label>Database name<input name="name" defaultValue={editing?.name ?? ""} maxLength={100} required autoFocus /></label>
      {!editing && <><label className="check-label"><input type="checkbox" checked={usePIN} onChange={e => setUsePIN(e.target.checked)} />Protect this database with a PIN</label>
      {usePIN && <div className="form-grid"><PINField name="pin" label="New database PIN" /><PINField name="confirmPin" label="Confirm database PIN" /></div>}</>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save database name" : "Create database"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setCreating(false); setEditing(undefined); setUsePIN(false); setError(""); }}>Cancel</button>
    </form>}
    {!creating && !editing && !selecting && <button type="button" disabled={busy} onClick={() => { setCreating(true); setError(""); setNotice(""); }}>New database</button>}
  </section>;
}
