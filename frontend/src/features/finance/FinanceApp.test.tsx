import { render, screen, waitFor } from "@testing-library/react";
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
            url === "/auth/me"
              ? { email: "fiction@example.test" }
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
it("offers registration when there is no valid session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Authentication required", { status: 401 })),
  );
  render(<FinanceApp />);
  await screen.findByRole("button", { name: "Sign in" });
  await userEvent.click(screen.getByText("New here? Create a local profile"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create profile" }),
    ).toBeInTheDocument(),
  );
});
