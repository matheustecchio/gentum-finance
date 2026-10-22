import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { History, clearFilters } from "./History";
import type { Row } from "./client";
const categories: Row[] = [
  { id: "root", name: "Daily Living", kind: "EXPENSE", parentId: "" },
  {
    id: "child",
    name: "Groceries",
    path: "Daily Living / Groceries",
    kind: "EXPENSE",
    parentId: "root",
  },
  { id: "education", name: "Education", kind: "EXPENSE", parentId: "" },
];
const entry = {
  id: "e",
  date: "2026-10-17",
  accountId: "a",
  categoryId: "child",
  kind: "EXPENSE",
  amount: "9007199254740993",
  currency: "EUR",
  description: "Groceries",
};
afterEach(() => vi.unstubAllGlobals());
function Harness() {
  const [filters, setFilters] = useState({ ...clearFilters });
  return (
    <History
      categories={categories}
      accounts={[{ id: "a", name: "Wallet" }]}
      filters={filters}
      onFilters={setFilters}
    />
  );
}
it("requests bounded history with combined filters, navigates pages and resets cursors", async () => {
  const requests: Record<string, string>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const variables = JSON.parse(init.body).variables;
      requests.push(variables);
      return new Response(
        JSON.stringify({
          data: {
            entryHistory: {
              entries: [entry],
              nextCursor: variables.after ? "" : "next",
              hasEntries: true,
            },
          },
        }),
      );
    }),
  );
  render(<Harness />);
  await screen.findByRole("cell", { name: "Groceries" });
  expect(screen.getByText(/90,071,992,547,409.93/)).toBeVisible();
  expect(screen.getByText("Daily Living / Groceries")).toBeVisible();
  expect(requests[0]).toEqual({ ...clearFilters, after: "" });
  expect(screen.getByLabelText("Subcategory")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Older" }));
  await waitFor(() => expect(requests.at(-1)?.after).toBe("next"));
  await screen.findByRole("cell", { name: "Groceries" });
  await userEvent.click(screen.getByRole("button", { name: "Newer" }));
  await waitFor(() => expect(requests.at(-1)?.after).toBe(""));
  await userEvent.selectOptions(
    screen.getByLabelText("Category", { exact: true }),
    "root",
  );
  await userEvent.selectOptions(screen.getByLabelText("Subcategory"), "child");
  await userEvent.type(screen.getByLabelText("Start date"), "2026-10-01");
  await userEvent.type(screen.getByLabelText("End date"), "2026-10-31");
  await waitFor(() =>
    expect(requests.at(-1)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      categoryId: "root",
      subcategoryId: "child",
      after: "",
    }),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Category", { exact: true }),
    "education",
  );
  expect(screen.getByLabelText("Subcategory")).toHaveValue("");
  expect(screen.getByLabelText("Subcategory")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() =>
    expect(requests.at(-1)).toEqual({ ...clearFilters, after: "" }),
  );
});
it("shows loading, distinct empty states and retryable request errors", async () => {
  let mode = "error";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            mode === "error"
              ? { errors: [{ message: "Try again" }] }
              : {
                  data: {
                    entryHistory: {
                      entries: [],
                      hasEntries: mode === "matches",
                      nextCursor: "",
                    },
                  },
                },
          ),
        ),
    ),
  );
  const view = render(<Harness />);
  expect(screen.getByText("Loading history…")).toBeVisible();
  await screen.findByText("Try again");
  mode = "matches";
  await userEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await screen.findByText("No transactions match these filters.");
  view.unmount();
  mode = "empty";
  render(<Harness />);
  await screen.findByText("No transactions yet. Add your first transaction.");
});

it("edits exact cents, validates, cancels and refreshes history", async () => {
  let current = { ...entry };
  const writes: Record<string, unknown>[] = [];
  const saved = vi.fn(async () => {});
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes("mutation")) {
      writes.push(variables);
      current = { ...current, ...variables.input };
      return new Response(JSON.stringify({ data: { executeFinance: "Saved" } }));
    }
    return new Response(JSON.stringify({ data: { entryHistory: { entries: [current], nextCursor: "", hasEntries: true } } }));
  }));
  render(<History categories={categories} accounts={[{id:"a",name:"Wallet"}]} filters={clearFilters} onFilters={() => {}} onSaved={saved} />);
  await userEvent.click(await screen.findByRole("button", {name:"Edit transaction"}));
  expect(screen.getByLabelText("Amount")).toHaveValue("90071992547409.93");
  await userEvent.click(screen.getByRole("button", {name:"Cancel"}));
  expect(writes).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", {name:"Edit transaction"}));
  await userEvent.clear(screen.getByLabelText("Amount"));
  await userEvent.type(screen.getByLabelText("Amount"), "0");
  await userEvent.click(screen.getByRole("button", {name:"Save correction"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("positive");
  expect(writes).toHaveLength(0);
  await userEvent.clear(screen.getByLabelText("Amount"));
  await userEvent.type(screen.getByLabelText("Amount"), "12.34");
  await userEvent.clear(screen.getByLabelText("Description"));
  await userEvent.type(screen.getByLabelText("Description"), "Corrected");
  await userEvent.click(screen.getByRole("button", {name:"Save correction"}));
  await screen.findByRole("cell", {name:"Corrected"});
  expect(saved).toHaveBeenCalledOnce();
  expect(writes[0].input).toMatchObject({ id:"e", amount:"1234", description:"Corrected" });
});

it("hides editing for transfers and recurring entries", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({data:{entryHistory:{entries:[{...entry,id:"transfer",kind:"TRANSFER_OUT",transferId:"t"},{...entry,id:"scheduled",recurringId:"r"}],nextCursor:"",hasEntries:true}}}))));
  render(<Harness />);
  await screen.findByText("TRANSFER OUT");
  expect(screen.queryByRole("button",{name:"Edit transaction"})).not.toBeInTheDocument();
});
