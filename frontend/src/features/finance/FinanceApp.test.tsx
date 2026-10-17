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
                  legacyRequired: false,
                  pinEnabled: false,
                  unlocked: true,
                }
              : {
                  data: {
                    finance: {
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
            legacyRequired: false,
            pinEnabled: false,
            unlocked: false,
          }),
        ),
    ),
  );
  render(<FinanceApp />);
  await screen.findByRole("heading", { name: "Set up your local ledger" });
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Use without a PIN")).toBeChecked();
  await userEvent.click(screen.getByLabelText("Protect with a PIN"));
  expect(screen.getByLabelText("PIN (4 digits)")).toHaveAttribute(
    "type",
    "password",
  );
});
