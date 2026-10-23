import { desktopFetch } from "../../desktop";
export type Row = Record<string, string>;
export interface Snapshot {
  accounts: Row[];
  categories: Row[];
  entries: Row[];
  budgets: Row[];
  recurring: Row[];
  totals: Row[];
  breakdown?: Row[];
}
let activeDatabase: string | undefined;
export function databaseScope() { return activeDatabase ?? "default"; }
let generation = 0;
const pending = new Set<AbortController>();
export function setActiveDatabase(id: string | undefined) {
  if (activeDatabase !== id) {
    invalidateDatabaseRequests();
    activeDatabase = id;
    window.dispatchEvent(new Event("gentum:database-ready"));
  }
}
export function invalidateDatabaseRequests() {
  generation++;
  for (const controller of pending) controller.abort();
  pending.clear();
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const discovery = path === "/auth/status";
  const version = generation;
  const controller = new AbortController();
  if (!discovery) pending.add(controller);
  try {
    const response = await desktopFetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(!discovery && activeDatabase ? { "X-Gentum-Database": activeDatabase } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!discovery && version !== generation) throw new Error("Database changed. Please try again.");
    if (response.status === 401 && path !== "/databases/select")
      window.dispatchEvent(new Event("gentum:unauthorized"));
    if (response.status === 409)
      window.dispatchEvent(new Event("gentum:database-changed"));
    if (!response.ok)
      throw new Error((await response.text()).trim() || "Request failed");
    const result = await response.json() as T;
    if (!discovery && version !== generation) throw new Error("Database changed. Please try again.");
    return result;
  } finally {
    pending.delete(controller);
  }
}
export async function graphql<T>(
  query: string,
  variables: unknown,
): Promise<T> {
  const result = await request<{ data: T; errors?: { message: string }[] }>(
    "/graphql",
    { query, variables },
  );
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}
export async function execute(action: string, input: Row): Promise<string> {
  const data = await graphql<{ executeFinance: string }>(
    "mutation Execute($action:String!,$input:FinanceInput!){executeFinance(action:$action,input:$input)}",
    { action, input },
  );
  return data.executeFinance;
}
