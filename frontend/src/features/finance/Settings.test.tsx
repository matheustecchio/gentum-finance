import { render, screen, within, waitFor } from "@testing-library/react";
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
const account = {
  id: "a",
  name: "Wallet",
  type: "CASH",
  currency: "EUR",
  balance: "0",
};
const category = { id: "c", name: "Food", kind: "EXPENSE" };
function ledger(
  accounts: (typeof account)[],
  categories: (typeof category)[],
  failure = "",
) {
  let rejectSave = true;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/auth/status")
      return new Response(
        JSON.stringify({
          setupRequired: false,
          unlocked: true,
          pinEnabled: false,
        }),
      );
    const body = JSON.parse(String(init?.body));
    if (body.query.startsWith("mutation")) {
      if (rejectSave)
        return new Response(
          JSON.stringify({ errors: [{ message: "Try again" }] }),
        );
      if (body.query.includes("createAccount"))
        accounts.push({
          ...account,
          ...body.variables.input,
          balance: body.variables.input.initialBalance,
        });
      else categories.push({ ...category, ...body.variables.input, id: "new" });
      return new Response(
        JSON.stringify({
          data: body.query.includes("createAccount")
            ? { createAccount: { id: "new" } }
            : { executeFinance: "Saved" },
        }),
      );
    }
    return new Response(
      JSON.stringify(
        failure
          ? { errors: [{ message: failure }] }
          : {
              data: {
                financeSummary: {
                  accounts,
                  categories,
                  entries: [],
                  budgets: [],
                  recurring: [],
                  totals: [],
                },
              },
            },
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return {
    fetcher,
    allowSave: () => {
      rejectSave = false;
    },
  };
}
for (const [hasAccount, hasCategory] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
]) {
  it(`invites incomplete setup once per visit: account ${hasAccount}, category ${hasCategory}`, async () => {
    ledger(hasAccount ? [account] : [], hasCategory ? [category] : []);
    const view = render(<FinanceApp />);
    expect(
      screen.queryByText("Complete your wallet setup"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument(),
    );
    if (hasAccount && hasCategory) {
      expect(
        screen.queryByText("Complete your wallet setup"),
      ).not.toBeInTheDocument();
      return;
    }
    await screen.findByText("Complete your wallet setup");
    await userEvent.click(
      screen.getByRole("button", { name: "Configure later" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByLabelText("Reporting month")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Complete your wallet setup"),
    ).not.toBeInTheDocument();
    view.unmount();
    render(<FinanceApp />);
    await screen.findByText("Complete your wallet setup");
    await userEvent.click(
      screen.getByRole("button", { name: "Open Settings" }),
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(
      screen.queryByText("Complete your wallet setup"),
    ).not.toBeInTheDocument();
  });
}
it("suppresses setup invitation on load failure", async () => {
  ledger([], [], "Load failed");
  render(<FinanceApp />);
  await screen.findByText("Load failed");
  expect(
    screen.queryByText("Complete your wallet setup"),
  ).not.toBeInTheDocument();
});
for (const kind of ["account", "category"] as const) {
  it(`keeps ${kind} values on save errors, closes and refreshes after success`, async () => {
    const { fetcher, allowSave } = ledger([], []);
    render(<FinanceApp />);
    await screen.findByText("Complete your wallet setup");
    await userEvent.click(
      screen.getByRole("button", { name: "Create your first account" }),
    );
    expect(
      screen.queryByRole("button", { name: "Accounts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Categories" }),
    ).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: `Create ${kind}` });
    await userEvent.click(trigger);
    let dialog = screen.getByRole("dialog", { name: `Create ${kind}` });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    dialog = screen.getByRole("dialog", { name: `Create ${kind}` });
    await userEvent.type(
      screen.getByLabelText(
        kind === "account" ? "Account name" : "Category name",
      ),
      "New fixture",
    );
    if (kind === "account") {
      await userEvent.selectOptions(
        screen.getByLabelText("Account type"),
        "CASH",
      );
      await userEvent.selectOptions(screen.getByLabelText("Currency"), "EUR");
      await userEvent.clear(screen.getByLabelText("Opening balance"));
      await userEvent.type(
        screen.getByLabelText("Opening balance"),
        "90071992547409.93",
      );
    } else
      await userEvent.selectOptions(screen.getByLabelText("Kind"), "EXPENSE");
    await userEvent.click(
      within(dialog).getByRole("button", { name: `Create ${kind}` }),
    );
    await within(dialog).findByText("Try again");
    expect(
      screen.getByLabelText(
        kind === "account" ? "Account name" : "Category name",
      ),
    ).toHaveValue("New fixture");
    allowSave();
    await userEvent.click(
      within(dialog).getByRole("button", { name: `Create ${kind}` }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("New fixture")).toBeVisible();
    expect(trigger).toHaveFocus();
    if (kind === "account")
      expect(
        fetcher.mock.calls.some(([, init]) =>
          String(init?.body).includes('"initialBalance":"9007199254740993"'),
        ),
      ).toBe(true);
  });
}

it("keeps setup dismissed through PIN recovery acknowledgement and lock/unlock in the same visit", async () => {
  const { fetcher } = ledger([], []);
  let pinEnabled = false;
  let unlocked = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/auth/status")
        return new Response(
          JSON.stringify({ setupRequired: false, pinEnabled, unlocked }),
        );
      if (url === "/auth/pin") {
        pinEnabled = true;
        return new Response(
          JSON.stringify({ recoveryCode: "fictional-recovery-code" }),
        );
      }
      if (url === "/auth/lock" || url === "/auth/unlock") {
        unlocked = url === "/auth/unlock";
        return new Response("{}");
      }
      return fetcher(url, init);
    }),
  );
  render(<FinanceApp />);
  await screen.findByText("Complete your wallet setup");
  await userEvent.click(
    screen.getByRole("button", { name: "Configure later" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await userEvent.type(screen.getByLabelText("PIN (4 digits)"), "0123");
  await userEvent.type(screen.getByLabelText("Confirm PIN"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Enable PIN" }));
  await screen.findByText("Save your recovery code");
  await userEvent.click(screen.getByLabelText("I have saved my recovery code"));
  await userEvent.click(
    screen.getByRole("button", { name: "Continue to wallet" }),
  );
  await screen.findByText("A fresh start");
  expect(
    screen.queryByText("Complete your wallet setup"),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Lock now" }));
  await userEvent.type(await screen.findByLabelText("PIN (4 digits)"), "0123");
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("A fresh start");
  expect(
    screen.queryByText("Complete your wallet setup"),
  ).not.toBeInTheDocument();
});
