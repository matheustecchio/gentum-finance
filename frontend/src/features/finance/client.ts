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
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401)
    window.dispatchEvent(new Event("gentum:unauthorized"));
  if (!response.ok)
    throw new Error((await response.text()).trim() || "Request failed");
  return response.json() as Promise<T>;
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
