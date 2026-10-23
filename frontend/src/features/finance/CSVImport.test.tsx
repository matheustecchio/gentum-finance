import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useCSVImport, type ImportJob } from "./CSVImport";
import { setActiveDatabase } from "./client";

Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
afterEach(() => { localStorage.clear(); setActiveDatabase(undefined); vi.unstubAllGlobals(); });
const committed = (id: string): ImportJob => ({ id, status: "committed", total: 100000, processed: 100000, message: "Imported 100000 transactions" });
function Harness({ done = vi.fn() }: { done?: (message: string) => void }) {
  const importer = useCSVImport(async message => { done(message); });
  return <><button disabled={importer.busy} onClick={() => void importer.start({ csv: "synthetic", accountId: "owned" }, 100000)}>Start</button>{importer.popup}</>;
}
function mock(handler: (action: string, id: string) => ImportJob | Promise<ImportJob>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { action, input } = JSON.parse(String(init.body)).variables; calls.push(action);
    return new Response(JSON.stringify({ data: { csvImport: await handler(action, input.id) } }));
  }));
  return calls;
}
it("guards repeated clicks and reports backend progress before atomic success", async () => {
  let finish!: (job: ImportJob) => void; let id = "";
  const calls = mock(async (action, token) => { id = token; return action === "start" ? { ...committed(token), status: "running", processed: 57000, message: "" } : new Promise(resolve => { finish = resolve; }); });
  const done = vi.fn(); render(<Harness done={done} />);
  const button = screen.getByRole("button", { name: "Start" });
  button.focus();
  act(() => { button.click(); button.click(); button.click(); });
  await screen.findByText("57,000 of 100,000 records processed");
  expect(screen.getByText("43,000 records remaining")).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "57000");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish(committed(id)));
  await screen.findByRole("heading", { name: "Import complete" });
  expect(done).toHaveBeenCalledOnce(); expect(calls.filter(c => c === "start")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Close" })); expect(button).toHaveFocus();
});
it("waits for confirmed rollback when cancelled and prevents Escape from hiding work", async () => {
  let cancelled = false;
  mock((action,id) => { if (action === "cancel") cancelled = true; return { ...committed(id), processed: 57000, status: cancelled ? "cancelled" : "running", message: cancelled ? "Import cancelled. No transactions saved." : "" }; });
  render(<Harness />); await userEvent.click(screen.getByRole("button", { name: "Start" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent(dialog, new Event("cancel", { cancelable: true })); expect(dialog).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cancel import" }));
  await screen.findByText("Import cancelled. No transactions saved."); expect(cancelled).toBe(true);
  expect(localStorage.getItem("gentum:csv-import:default")).toBeNull();
});
it("resolves a lost start acknowledgement without sending the file again", async () => {
  const calls = mock((action,id) => { if (action === "start") throw new Error("Connection lost after commit"); return committed(id); });
  render(<Harness />); await userEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("heading", { name: "Import status unavailable" });
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Check import status" }));
  await screen.findByRole("heading", { name: "Import complete" });
  expect(calls).toEqual(["start", "status"]);
});
it("recovers a database-scoped operation on remount", async () => {
  setActiveDatabase("ledger-b"); localStorage.setItem("gentum:csv-import:ledger-b", "saved-token");
  localStorage.setItem("gentum:csv-import:ledger-a", "another-token");
  const calls = mock((_action,id) => { expect(id).toBe("saved-token"); return committed(id); });
  render(<Harness />); await screen.findByRole("heading", { name: "Import complete" });
  expect(calls).toEqual(["status"]); expect(localStorage.getItem("gentum:csv-import:ledger-a")).toBe("another-token");
});
it("shows the offending record after rollback and allows a fresh attempt", async () => {
  let starts = 0;
  mock((action,id) => { if (action === "start") starts++; return starts === 1 ? { ...committed(id), status: "failed", message: "CSV record 57002: Invalid amount. No transactions saved." } : committed(id); });
  render(<Harness />); await userEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("57002");
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("heading", { name: "Import complete" }); expect(starts).toBe(2);
});
