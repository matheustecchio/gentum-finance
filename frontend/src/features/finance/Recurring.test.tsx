import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Recurring } from "./Recurring";
import { execute, graphql, type Snapshot } from "./client";
vi.mock("./client", () => ({ execute: vi.fn(), graphql: vi.fn() }));
const schedule = {
  id: "s",
  accountId: "a",
  categoryId: "c",
  kind: "EXPENSE",
  amount: "1500",
  description: "Internet",
  nextDate: "2026-11-10",
  frequency: "monthly",
  mode: "manual",
  active: "true",
};
const occurrence = {
  ...schedule,
  id: "o",
  recurringId: "s",
  date: "2026-10-10",
  status: "pending",
};
const data: Snapshot = {
  accounts: [{ id: "a", name: "Wallet", currency: "EUR" }],
  categories: [{ id: "c", name: "Bills", kind: "EXPENSE" }],
  entries: [],
  budgets: [],
  recurring: [schedule],
  occurrences: [occurrence],
  totals: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(execute).mockResolvedValue("Saved");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});
it("creates an automatic fortnightly schedule with exact cents", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <Recurring
      data={{ ...data, recurring: [], occurrences: [] }}
      refresh={refresh}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Account"), "a");
  await userEvent.selectOptions(
    screen.getByLabelText("Category (must match kind)"),
    "c",
  );
  await userEvent.type(
    screen.getByLabelText("Amount (decimal, account currency)"),
    "90071992547409.93",
  );
  await userEvent.type(screen.getByLabelText("Description"), "Payday expense");
  await userEvent.selectOptions(
    screen.getByLabelText("Frequency"),
    "fortnightly",
  );
  await userEvent.selectOptions(screen.getByLabelText("When due"), "automatic");
  await userEvent.click(
    screen.getByRole("button", { name: "Create recurring schedule" }),
  );
  expect(execute).toHaveBeenCalledWith(
    "recurring",
    expect.objectContaining({
      amount: "9007199254740993",
      frequency: "fortnightly",
      mode: "automatic",
    }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
it("confirms an adjusted amount for one occurrence and restores focus", async () => {
  render(
    <Recurring data={data} refresh={vi.fn().mockResolvedValue(undefined)} />,
  );
  const trigger = screen.getByRole("button", { name: /^Confirm$/ });
  await userEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  const amount = within(dialog).getByLabelText("Amount");
  await userEvent.clear(amount);
  await userEvent.type(amount, "18.29");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Confirm transaction" }),
  );
  expect(execute).toHaveBeenCalledWith("confirmOccurrence", {
    occurrenceId: "o",
    amount: "1829",
    description: "Internet",
  });
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("preserves an occurrence after a failed save and exposes retry", async () => {
  vi.mocked(execute).mockRejectedValueOnce(new Error("Account is archived"));
  render(<Recurring data={data} refresh={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Adjust" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save this occurrence" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Account is archived",
  );
  expect(
    within(dialog).getByRole("button", { name: "Save this occurrence" }),
  ).toBeEnabled();
});
it("edits future occurrences separately and skips a pending occurrence", async () => {
  render(
    <Recurring data={data} refresh={vi.fn().mockResolvedValue(undefined)} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
  expect(
    screen.getByRole("heading", { name: "Edit future occurrences" }),
  ).toHaveFocus();
  await userEvent.selectOptions(screen.getByLabelText("Frequency"), "yearly");
  await userEvent.click(
    screen.getByRole("button", { name: "Save future occurrences" }),
  );
  expect(execute).toHaveBeenCalledWith(
    "editRecurring",
    expect.objectContaining({
      id: "s",
      frequency: "yearly",
      amount: "1500",
      date: "2026-11-10",
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: /^Skip$/ }));
  expect(execute).toHaveBeenCalledWith("skipOccurrence", { occurrenceId: "o" });
});
it("loads all candidate pages and links only eligible entries", async () => {
  vi.mocked(graphql)
    .mockResolvedValueOnce({
      entryHistory: {
        entries: [{ id: "foreign", accountId: "b", kind: "EXPENSE" }],
        nextCursor: "next",
      },
    })
    .mockResolvedValueOnce({
      entryHistory: {
        entries: [
          {
            id: "actual",
            accountId: "a",
            categoryId: "c",
            kind: "EXPENSE",
            amount: "1599",
            description: "Actual internet",
            date: "2026-10-11",
          },
        ],
        nextCursor: "",
      },
    });
  render(
    <Recurring data={data} refresh={vi.fn().mockResolvedValue(undefined)} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Link transaction" }),
  );
  const dialog = screen.getByRole("dialog");
  const select = await within(dialog).findByLabelText("Transaction");
  await userEvent.selectOptions(select, "actual");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Link transaction" }),
  );
  expect(execute).toHaveBeenCalledWith("linkOccurrence", {
    occurrenceId: "o",
    entryId: "actual",
  });
  expect(graphql).toHaveBeenLastCalledWith(
    expect.stringContaining("entryHistory(start:"),
    expect.objectContaining({ after: "next" }),
  );
});

it("focuses the pending section when confirmation removes its trigger", async () => {
  const refresh = vi.fn(async () => {
    view.rerender(<Recurring data={{ ...data, occurrences: [] }} refresh={refresh} />);
  });
  const view = render(<Recurring data={data} refresh={refresh} />);
  await userEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm transaction" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Needs confirmation (0)" })).toHaveFocus());
});
