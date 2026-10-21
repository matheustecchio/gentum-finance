import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Databases } from "./Databases";
import { LocalAccess, useLocalAccess } from "./LocalAccess";
import { request, setActiveDatabase } from "../finance/client";

afterEach(() => { vi.unstubAllGlobals(); setActiveDatabase(undefined); });
function fixture() {
  let active = "one";
  const databases = [{ id: "one", name: "Personal", pinEnabled: false }, { id: "two", name: "Business", pinEnabled: true }];
  const calls = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url === "/auth/status") return Response.json({ databaseId: active, databaseName: databases.find(d => d.id === active)?.name, setupRequired: false, pinEnabled: false, unlocked: true });
    if (url === "/databases") return Response.json({ activeId: active, databases });
    if (url === "/databases/select") {
      if (body.recoveryCode === "RECOVERY-CODE" && body.pin === "5678") { active = body.id; return Response.json({ recoveryCode: "REPLACEMENT-CODE" }); }
      if (body.pin !== "0123") return new Response("Invalid PIN", { status: 401 });
      active = body.id; return Response.json({});
    }
    if (url === "/databases/rename") { databases.find(d => d.id === body.id)!.name = body.name; return Response.json({}); }
    if (url === "/databases/create") {
      if (databases.some(d => d.name.toLowerCase() === body.name.toLowerCase())) return new Response("A database with that name already exists", { status: 400 });
      databases.push({ id: "new", name: body.name, pinEnabled: body.mode === "pin" });
      return Response.json(body.mode === "pin" ? { recoveryCode: "RECOVERY-CODE" } : {});
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", calls);
  return calls;
}
function Wallet() {
  const { status } = useLocalAccess();
  return <><h1>{status.databaseName}</h1><Databases /><input aria-label="Unsaved transaction" /></>;
}
it("creates a protected database without switching and requires recovery acknowledgement", async () => {
  const calls = fixture();
  render(<LocalAccess><Wallet /></LocalAccess>);
  await userEvent.click(await screen.findByRole("button", { name: "New database" }));
  await userEvent.type(screen.getByLabelText("Database name"), "Travel");
  await userEvent.click(screen.getByLabelText("Protect this database with a PIN"));
  await userEvent.type(screen.getByLabelText("New database PIN"), "0123");
  await userEvent.type(screen.getByLabelText("Confirm database PIN"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Create database" }));
  await screen.findByText("RECOVERY-CODE");
  expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue to wallet" })).toBeDisabled();
  await userEvent.click(screen.getByLabelText("I have saved my recovery code"));
  await userEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
  await screen.findByText("Travel", { exact: true });
  expect(calls.mock.calls.filter(([url]) => url === "/databases/select")).toHaveLength(0);
});
it("preserves the current wallet on failed PIN then clears open forms on switch", async () => {
  fixture();
  render(<LocalAccess><Wallet /></LocalAccess>);
  await userEvent.type(await screen.findByLabelText("Unsaved transaction"), "old data");
  await userEvent.click(await screen.findByRole("button", { name: "Open Business" }));
  await userEvent.type(screen.getByLabelText("Database PIN"), "9999");
  await userEvent.click(screen.getByRole("button", { name: "Unlock database" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid PIN");
  expect(screen.getByLabelText("Unsaved transaction")).toHaveValue("old data");
  await userEvent.clear(screen.getByLabelText("Database PIN"));
  await userEvent.type(screen.getByLabelText("Database PIN"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Unlock database" }));
  await screen.findByRole("heading", { name: "Business" });
  expect(screen.getByLabelText("Unsaved transaction")).toHaveValue("");
});
it("renames display names and shows actionable duplicate errors", async () => {
  fixture();
  render(<LocalAccess><Wallet /></LocalAccess>);
  await userEvent.click(await screen.findByRole("button", { name: "Rename Personal" }));
  await userEvent.clear(screen.getByLabelText("Database name"));
  await userEvent.type(screen.getByLabelText("Database name"), "Home");
  await userEvent.click(screen.getByRole("button", { name: "Save database name" }));
  await screen.findByRole("heading", { name: "Home" });
  await userEvent.click(screen.getByRole("button", { name: "New database" }));
  await userEvent.type(screen.getByLabelText("Database name"), "home");
  await userEvent.click(screen.getByRole("button", { name: "Create database" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
});
it("rejects late responses and tags requests with their original database", async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  setActiveDatabase("old");
  const result = request("/graphql", { query: "old" }).catch(e => e);
  setActiveDatabase("new");
  complete(Response.json({ oldData: true }));
  expect(await result).toBeInstanceOf(Error);
  expect(fetcher).toHaveBeenCalledWith("/graphql", expect.objectContaining({ headers: expect.objectContaining({ "X-Gentum-Database": "old" }) }));
});
it("refreshes and discards forms when another tab changes access", async () => {
  const calls = fixture();
  render(<LocalAccess><Wallet /></LocalAccess>);
  await userEvent.type(await screen.findByLabelText("Unsaved transaction"), "pending");
  await request("/databases/select", { id: "two", pin: "0123" });
  fireEvent(window, new StorageEvent("storage", { key: "gentum:access-change" }));
  await screen.findByRole("heading", { name: "Business" });
  await waitFor(() => expect(screen.getByLabelText("Unsaved transaction")).toHaveValue(""));
  expect(calls).toHaveBeenCalledWith("/databases", expect.objectContaining({ headers: expect.objectContaining({ "X-Gentum-Database": "two" }) }));
});

it("recovers a nonselected database and gates access on saving its replacement code", async () => {
  const calls = fixture();
  render(<LocalAccess><Wallet /></LocalAccess>);
  await userEvent.click(await screen.findByRole("button", { name: "Open Business" }));
  await userEvent.click(screen.getByRole("button", { name: "Forgot this database PIN?" }));
  await userEvent.type(screen.getByLabelText("Database recovery code"), "RECOVERY-CODE");
  await userEvent.type(screen.getByLabelText("Replacement database PIN"), "5678");
  await userEvent.type(screen.getByLabelText("Confirm replacement PIN"), "5678");
  await userEvent.click(screen.getByRole("button", { name: "Reset PIN and open database" }));
  await screen.findByText("REPLACEMENT-CODE");
  expect(screen.queryByLabelText("Unsaved transaction")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue to wallet" })).toBeDisabled();
  await userEvent.click(screen.getByLabelText("I have saved my recovery code"));
  await userEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
  await screen.findByRole("heading", { name: "Business" });
  expect(calls).toHaveBeenCalledWith("/databases/select", expect.objectContaining({ body: JSON.stringify({ id: "two", pin: "5678", recoveryCode: "RECOVERY-CODE" }) }));
});
