import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceApp } from "./FinanceApp";
afterEach(() => vi.unstubAllGlobals());
it("shows authenticated balances and monthly budgets with exact cents", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/auth/status"
              ? {
                  setupRequired: false,
                  existingProfilesAvailable: false,
                  pinEnabled: false,
                  unlocked: true,
                }
              : {
                  data: {
                    financeSummary: {
                      accounts: [
                        {
                          id: "a",
                          name: "Wallet",
                          type: "CASH",
                          currency: "EUR",
                          balance: "9007199254740993",
                        },
                      ],
                      categories: [{ id: "c", name: "Food", kind: "EXPENSE" }],
                      entries: [],
                      recurring: [],
                      totals: [
                        {
                          currency: "EUR",
                          income: "29",
                          expense: "1",
                          net: "28",
                        },
                      ],
                      budgets: [
                        {
                          id: "b",
                          categoryId: "c",
                          currency: "EUR",
                          amount: "100",
                          spent: "125",
                        },
                      ],
                    },
                  },
                },
          ),
          { status: 200 },
        ),
    ),
  );
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  expect(screen.getByText(/90,071,992,547,409.93/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Budgets" }));
  expect(screen.getByText("125% used · Over budget")).toBeInTheDocument();
});
it("offers optional PIN setup without email registration", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            setupRequired: true,
            existingProfilesAvailable: false,
            pinEnabled: false,
            unlocked: false,
          }),
        ),
    ),
  );
  render(<FinanceApp />);
  await screen.findByRole("heading", { name: "Set up your local wallet" });
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Use without a PIN")).toBeChecked();
  await userEvent.click(screen.getByLabelText("Protect with a PIN"));
  expect(screen.getByLabelText("PIN (4 digits)")).toHaveAttribute(
    "type",
    "password",
  );
});

function mockLedger(
  accounts = [
    { id: "a", name: "Wallet", currency: "EUR", type: "CASH", balance: "0" },
  ],
) {
  const categories = [
    { id: "root", name: "Home", path: "Home", kind: "EXPENSE", parentId: "" },
    {
      id: "child",
      name: "Repairs",
      path: "Home / Repairs",
      kind: "EXPENSE",
      parentId: "root",
    },
    {
      id: "income",
      name: "Wages",
      path: "Income / Wages",
      kind: "INCOME",
      parentId: "income-root",
    },
  ];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(
      JSON.stringify(
        url === "/auth/status"
          ? { setupRequired: false, pinEnabled: false, unlocked: true }
          : {
              data: body.variables?.action
                ? { executeFinance: "Saved" }
                : {
                    financeSummary: {
                      accounts,
                      categories,
                      entries: [],
                      recurring: [],
                      budgets: [],
                      totals: [],
                      breakdown: [
                        {
                          categoryId: "root",
                          currency: "EUR",
                          direct: "29",
                          total: "129",
                        },
                        {
                          categoryId: "child",
                          currency: "EUR",
                          direct: "100",
                          total: "100",
                        },
                      ],
                    },
                  },
            },
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("creates a child with same-kind roots and adds starter categories explicitly", async () => {
  const fetcher = mockLedger();
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  await userEvent.click(screen.getByRole("button", { name: "Categories" }));
  await userEvent.selectOptions(screen.getByLabelText("Kind"), "EXPENSE");
  const parent = screen.getByLabelText("Parent category (optional)");
  expect(parent).toHaveTextContent("Home");
  expect(parent).not.toHaveTextContent("Wages");
  expect(parent).not.toHaveTextContent("Repairs");
  await userEvent.type(screen.getByLabelText("Category name"), "Utilities");
  await userEvent.selectOptions(parent, "root");
  await userEvent.click(
    screen.getByRole("button", { name: "Create category" }),
  );
  await screen.findByRole("status");
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"parentId":"root"'),
    ),
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Add starter categories" }),
  );
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"action":"starterCategories"'),
    ),
  ).toBe(true);
});

it("filters transaction and recurring category paths by kind and expands direct root spending", async () => {
  mockLedger();
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  await userEvent.click(screen.getByText(/Home · expense/));
  expect(screen.getByText(/Direct entries · €0.29/)).toBeVisible();
  expect(screen.getByText(/Home \/ Repairs · €1.00/)).toBeVisible();
  for (const tab of ["Add transaction", "Recurring"]) {
    await userEvent.click(screen.getByRole("button", { name: tab }));
    await userEvent.selectOptions(
      screen.getByLabelText("Kind", { exact: true }),
      "EXPENSE",
    );
    expect(
      screen.getByLabelText("Category (must match kind)"),
    ).toHaveTextContent("Home / Repairs");
    expect(
      screen.getByLabelText("Category (must match kind)"),
    ).not.toHaveTextContent("Wages");
    await userEvent.selectOptions(
      screen.getByLabelText("Kind", { exact: true }),
      "INCOME",
    );
    expect(
      screen.getByLabelText("Category (must match kind)"),
    ).toHaveTextContent("Income / Wages");
    expect(
      screen.getByLabelText("Category (must match kind)"),
    ).not.toHaveTextContent("Repairs");
  }
});

it("uses the single eligible destination and keeps only category ID references", async () => {
  const fetcher = mockLedger();
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  await userEvent.click(
    screen.getByRole("button", { name: "Import & export" }),
  );
  expect(screen.getByLabelText("Import into account")).toHaveValue("a");
  expect(
    screen.queryByRole("heading", { name: "Account IDs" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Home \/ Repairs \(EXPENSE\)/)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Use CSV template" }),
  );
  expect(screen.getByLabelText("CSV content")).toHaveValue(
    "date,kind,category_id,amount_cents,description\n",
  );
  await userEvent.type(
    screen.getByLabelText("CSV content"),
    "2026-10-17,EXPENSE,child,29,Test",
  );
  await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"accountId":"a"'),
    ),
  ).toBe(true);
});

it("requires a destination choice for multiple accounts and explains missing accounts", async () => {
  mockLedger([
    { id: "a", name: "One", currency: "EUR", type: "CASH", balance: "0" },
    { id: "b", name: "Two", currency: "USD", type: "CASH", balance: "0" },
  ]);
  const view = render(<FinanceApp />);
  await screen.findByText("One");
  await userEvent.click(
    screen.getByRole("button", { name: "Import & export" }),
  );
  expect(screen.getByLabelText("Import into account")).toHaveValue("");
  await userEvent.type(
    screen.getByLabelText("CSV content"),
    "date,kind,category_id,amount_cents,description\n2026-10-17,EXPENSE,child,29,Test",
  );
  expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText("Import into account"),
    "b",
  );
  expect(screen.getByRole("button", { name: "Import CSV" })).toBeEnabled();
  expect(screen.getByText("Destination: Two · USD")).toBeVisible();
  view.unmount();
  mockLedger([]);
  render(<FinanceApp />);
  await screen.findByText("A fresh start");
  await userEvent.click(
    screen.getByRole("button", { name: "Import & export" }),
  );
  expect(screen.getByText("Create an account before importing.")).toBeVisible();
});

it("separates recording from history, preserves exact cents, resets and refreshes on return", async () => {
  const base = mockLedger();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.query?.includes("entryHistory"))
      return new Response(
        JSON.stringify({
          data: {
            entryHistory: { entries: [], hasEntries: false, nextCursor: "" },
          },
        }),
      );
    return base(url, init);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  await userEvent.click(screen.getByRole("button", { name: "Transactions" }));
  await screen.findByText(/No transactions yet/);
  expect(
    screen.queryByRole("button", { name: "Save transaction" }),
  ).not.toBeInTheDocument();
  const add = screen.getByRole("button", { name: "Add transaction" });
  expect(add).toHaveClass("add-transaction");
  add.focus();
  await userEvent.keyboard("{Enter}");
  expect(add).toHaveAttribute("aria-current", "page");
  await userEvent.selectOptions(
    screen.getByLabelText("Kind", { exact: true }),
    "EXPENSE",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Account", { exact: true }),
    "a",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Category (must match kind)"),
    "child",
  );
  await userEvent.type(
    screen.getByLabelText("Amount (decimal, account currency)"),
    "0.29",
  );
  await userEvent.type(screen.getByLabelText("Description"), "Coffee");
  await userEvent.clear(
    screen.getByLabelText("Amount (decimal, account currency)"),
  );
  await userEvent.type(
    screen.getByLabelText("Amount (decimal, account currency)"),
    "0.001",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await screen.findByText("Use a number with up to two decimal places");
  await userEvent.clear(
    screen.getByLabelText("Amount (decimal, account currency)"),
  );
  await userEvent.type(
    screen.getByLabelText("Amount (decimal, account currency)"),
    "0.29",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save transaction" }),
  );
  await screen.findByText("Saved");
  expect(screen.getByLabelText("Description")).toHaveValue("");
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"amount":"29"'),
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Transactions" }));
  await screen.findByText(/No transactions yet/);
  expect(
    fetcher.mock.calls.filter(([, init]) =>
      String(init?.body).includes("entryHistory"),
    ),
  ).toHaveLength(2);
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes("{finance(month"),
    ),
  ).toBe(false);
});

it("confirms or cancels category deletion and displays server rejection", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  const base = mockLedger();
  let reject = true;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(init?.body).includes('"action":"deleteCategory"'))
      return new Response(
        JSON.stringify(
          reject
            ? { errors: [{ message: "Category is used by transactions" }] }
            : { data: { executeFinance: "Saved" } },
        ),
      );
    return base(url, init);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<FinanceApp />);
  await screen.findByText("Wallet");
  await userEvent.click(screen.getByRole("button", { name: "Categories" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Delete Home / Repairs" }),
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleName(
    "Delete Home / Repairs?",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"action":"deleteCategory"'),
    ),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "Delete Home / Repairs" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Delete category" }),
  );
  await screen.findByText("Category is used by transactions");
  reject = false;
  await userEvent.click(
    screen.getByRole("button", { name: "Delete category" }),
  );
  await screen.findByText("Category deleted");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  vi.restoreAllMocks();
});

it("removes deleted categories from history filters and clears the active child", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  let deleted = false;
  const categories = [
    { id: "root", name: "Home", path: "Home", kind: "EXPENSE", parentId: "" },
    {
      id: "child",
      name: "Repairs",
      path: "Home / Repairs",
      kind: "EXPENSE",
      parentId: "root",
    },
  ];
  const requests: Record<string, string>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url === "/auth/status")
        return new Response(
          JSON.stringify({
            setupRequired: false,
            pinEnabled: false,
            unlocked: true,
          }),
        );
      if (body.variables?.action === "deleteCategory") {
        deleted = true;
        return new Response(
          JSON.stringify({ data: { executeFinance: "Saved" } }),
        );
      }
      if (body.query.includes("entryHistory")) {
        requests.push(body.variables);
        return new Response(
          JSON.stringify({
            data: {
              entryHistory: { entries: [], hasEntries: false, nextCursor: "" },
            },
          }),
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            financeSummary: {
              accounts: [],
              categories: deleted ? categories.slice(0, 1) : categories,
              entries: [],
              recurring: [],
              budgets: [],
              totals: [],
            },
          },
        }),
      );
    }),
  );
  render(<FinanceApp />);
  await screen.findByText("A fresh start");
  await userEvent.click(screen.getByRole("button", { name: "Transactions" }));
  await userEvent.selectOptions(
    screen.getByLabelText("Category", { exact: true }),
    "root",
  );
  await userEvent.selectOptions(screen.getByLabelText("Subcategory"), "child");
  await userEvent.click(screen.getByRole("button", { name: "Categories" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Delete Home / Repairs" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Delete category" }),
  );
  await screen.findByText("Category deleted");
  await userEvent.click(screen.getByRole("button", { name: "Transactions" }));
  await screen.findByText(/No transactions yet/);
  expect(screen.getByLabelText("Category", { exact: true })).toHaveValue(
    "root",
  );
  expect(screen.getByLabelText("Subcategory")).toHaveValue("");
  expect(screen.getByLabelText("Subcategory")).toBeDisabled();
  expect(requests.at(-1)).toMatchObject({
    categoryId: "root",
    subcategoryId: "",
    after: "",
  });
});
