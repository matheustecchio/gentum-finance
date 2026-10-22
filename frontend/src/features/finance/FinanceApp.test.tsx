import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceApp } from "./FinanceApp";
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value: function (this: HTMLDialogElement) {
    this.open = true;
  },
});
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
                    flowHistory: { buckets: [{ start: "2026-10-19", end: "2026-10-21" }], flows: [], hasEarlier: false },
                    categorySpending: { breakdown: [{ categoryId: "root", currency: "EUR", direct: "29" }, { categoryId: "child", currency: "EUR", direct: "100" }] },
                    overview: {
                      currency: "EUR",
                      today: "2026-10-18",
                      wealth: [
                        { date: "2026-10-18", amount: "9007199254740993" },
                      ],
                      flows: [],
                      rateDate: "",
                      rateError: "",
                      converted: false,
                    },
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
  await screen.findByRole("heading", { name: "Total Wealth" });
  expect(screen.getAllByText(/90,071,992,547,409.93/)[0]).toBeVisible();
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
                    flowHistory: { buckets: [{ start: "2026-10-19", end: "2026-10-21" }], flows: [], hasEarlier: false },
                    categorySpending: { breakdown: [{ categoryId: "root", currency: "EUR", direct: "29" }, { categoryId: "child", currency: "EUR", direct: "100" }] },
                    overview: {
                      currency: "EUR",
                      today: "2026-10-18",
                      wealth: [
                        { date: "2026-10-18", amount: "9007199254740993" },
                      ],
                      flows: [],
                      rateDate: "",
                      rateError: "",
                      converted: false,
                    },
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

it("creates a child with same-kind roots without offering manual defaults", async () => {
  const fetcher = mockLedger();
  render(<FinanceApp />);
  await screen.findByRole("heading", { name: "Total Wealth" });
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    screen.getAllByRole("combobox", { name: "Primary currency" }),
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Create category" }),
  );
  await userEvent.selectOptions(screen.getByLabelText("Kind"), "EXPENSE");
  const parent = screen.getByLabelText("Parent category (optional)");
  expect(parent).toHaveTextContent("Home");
  expect(parent).not.toHaveTextContent("Wages");
  expect(parent).not.toHaveTextContent("Repairs");
  await userEvent.type(screen.getByLabelText("Category name"), "Utilities");
  await userEvent.selectOptions(parent, "root");
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Create category",
    }),
  );
  await screen.findByText("Saved");
  expect(
    fetcher.mock.calls.some(([, init]) =>
      String(init?.body).includes('"parentId":"root"'),
    ),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Add categories" })).not.toBeInTheDocument();
});

it("filters transaction and recurring category paths by kind and shows direct spending amounts", async () => {
  mockLedger();
  render(<FinanceApp />);
  await screen.findByRole("heading", { name: "Total Wealth" });
  const rootSpending = await screen.findByRole("listitem", { name: "Home: €0.29" });
  expect(within(rootSpending).getByText("€0.29", { exact: true })).toBeVisible();
  const childSpending = screen.getByRole("listitem", { name: "Home / Repairs: €1.00" });
  expect(within(childSpending).getByText("€1.00", { exact: true })).toBeVisible();
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
  await screen.findByRole("heading", { name: "Total Wealth" });
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
  await screen.findByRole("heading", { name: "Total Wealth" });
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
  await screen.findByRole("heading", { name: "Total Wealth" });
  await userEvent.click(screen.getByRole("button", { name: "Transactions" }));
  await screen.findByText(/No transactions yet/);
  expect(
    screen.queryByRole("button", { name: "Save transaction" }),
  ).not.toBeInTheDocument();
  const add = screen.getByRole("button", { name: "Add transaction" });
  expect(
    screen.getAllByRole("button", { name: "Add transaction" }),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("navigation"))
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual([
    "Overview",
    "Transactions",
    "Transfers",
    "Budgets",
    "Recurring",
    "Import & export",
    "Settings",
    "+ Add transaction",
  ]);
  expect(
    add.compareDocumentPosition(screen.getByText(/Local wallet/)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(add).toHaveClass("add-transaction");
  screen.getByRole("button", { name: "Settings" }).focus();
  await userEvent.tab();
  expect(add).toHaveFocus();
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
  await screen.findByRole("heading", { name: "Total Wealth" });
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
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
            overview: {
              currency: "EUR",
              today: "2026-10-18",
              wealth: [{ date: "2026-10-18", amount: "9007199254740993" }],
              flows: [],
              rateDate: "",
              rateError: "",
              converted: false,
            },
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
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
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

for (const pinEnabled of [false, true]) {
  it(`shows the development version and preserves the lock control with PIN ${pinEnabled}`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url === "/auth/status"
                ? { setupRequired: false, pinEnabled, unlocked: true }
                : {
                    data: {
                      flowHistory: { buckets: [{ start: "2026-10-19", end: "2026-10-21" }], flows: [], hasEarlier: false },
                    categorySpending: { breakdown: [{ categoryId: "root", currency: "EUR", direct: "29" }, { categoryId: "child", currency: "EUR", direct: "100" }] },
                    overview: {
                        currency: "EUR",
                        today: "2026-10-18",
                        wealth: [
                          { date: "2026-10-18", amount: "9007199254740993" },
                        ],
                        flows: [],
                        rateDate: "",
                        rateError: "",
                        converted: false,
                      },
                      financeSummary: {
                        accounts: [],
                        categories: [],
                        entries: [],
                        budgets: [],
                        recurring: [],
                        totals: [],
                      },
                    },
                  },
            ),
          ),
      ),
    );
    render(<FinanceApp />);
    await screen.findByText("Local wallet");
    expect(screen.getByText(`v${__APP_VERSION__} (dev)`)).toBeInTheDocument();
    expect(screen.queryByText(/No PIN|PIN enabled/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Lock now" })).toHaveLength(
      pinEnabled ? 1 : 0,
    );
  });
}


it("renames a category with a prefilled dialog and restores focus on cancel and save", async () => {
 const fetcher = mockLedger();
 render(<FinanceApp />);
 await screen.findByRole("heading", { name: "Total Wealth" });
 await userEvent.click(screen.getByRole("button", { name: "Settings" }));
 const trigger = screen.getByRole("button", { name: "Edit Home / Repairs" });
 await userEvent.click(trigger);
 const input = screen.getByLabelText("Category name");
 expect(input).toHaveValue("Repairs");
 expect(input).toHaveFocus();
 await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
 expect(trigger).toHaveFocus();
 await userEvent.click(trigger);
 await userEvent.clear(screen.getByLabelText("Category name"));
 await userEvent.type(screen.getByLabelText("Category name"), "Maintenance");
 await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
 await screen.findByText("Saved");
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(trigger).toHaveFocus();
 expect(fetcher.mock.calls.some(([,init]) => { const body = JSON.parse(String(init?.body || "{}")); return body.variables?.action === "renameCategory" && body.variables.input.id === "child" && body.variables.input.name === "Maintenance"; })).toBe(true);
});


it("retains the rename text after a server error and closes with Escape", async () => {
 const fetcher = mockLedger();
 const original = fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async (url, init) => {
  if (String(init?.body).includes('"action":"renameCategory"')) return new Response(JSON.stringify({ errors: [{ message: "A category with this name already exists in this group" }] }));
  return original(url, init);
 });
 render(<FinanceApp />);
 await screen.findByRole("heading", { name: "Total Wealth" });
 await userEvent.click(screen.getByRole("button", { name: "Settings" }));
 const trigger = screen.getByRole("button", { name: "Edit Home" });
 await userEvent.click(trigger);
 await userEvent.clear(screen.getByLabelText("Category name"));
 await userEvent.type(screen.getByLabelText("Category name"), "Duplicate");
 await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
 expect(screen.getByLabelText("Category name")).toHaveValue("Duplicate");
 fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 expect(trigger).toHaveFocus();
});
