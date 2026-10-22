import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Analytics, calendarDay, validRange } from "./Analytics";
import { bucketLabel } from "./CashFlowChart";
import type { Snapshot } from "./client";
const snapshot: Snapshot = { accounts: [{ currency: "EUR" }], categories: [{ id: "food", name: "Food", kind: "EXPENSE", color: "#ffcc00" }], entries: [], totals: [], budgets: [], recurring: [] };
const buckets = [{ start: "2026-10-12", end: "2026-10-18" }, { start: "2026-10-19", end: "2026-10-21" }];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-21T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ data: body.query.includes("query FlowHistory") ? { flowHistory: { buckets, flows: [{ month: "2026-10-19", currency: "EUR", income: "0", expense: "9007199254740993", net: "-9007199254740993" }], hasEarlier: false } } : { categorySpending: { breakdown: [{ categoryId: "food", currency: "EUR", direct: body.variables.start === "2026-10-12" ? "100" : "9007199254740993" }] } } }));
  });
}
it("uses Dublin dates, readable labels and custom ranges beyond five years", () => {
  expect(calendarDay(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  expect(bucketLabel({ start: "2026-10-01", end: "2026-10-21" }, "month", "2026-10-21")).toBe("October 2026 · current");
  expect(bucketLabel(buckets[0], "week", "2026-10-21")).toBe("18 Oct 2026");
  expect(validRange("2026-02-30", "2026-03-01", "2026-10-21")).toBe(false);
  expect(validRange("2016-01-01", "2026-10-21", "2026-10-21")).toBe(true);
});
it("starts with the current week and selects a whole period to update ranked category spending", async () => {
  const fetcher = fixture(); vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  expect(await screen.findByRole("listitem", { name: "Food: €90,071,992,547,409.93" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "Previous period" })).toBeNull();
  const old = screen.getByRole("button", { name: "Select 12–18 Oct 2026 in EUR" });
  fireEvent.click(old.querySelector(".period-hit")!);
  expect(await screen.findByRole("listitem", { name: "Food: €1.00" })).toBeVisible();
  expect(old).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Select 19–21 Oct 2026 in EUR" })).toHaveClass("is-muted");
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual(buckets[0]);
});
it("changes aggregation and the week ending day without a paging strip", async () => {
  const fetcher = fixture(); vi.stubGlobal("fetch", fetcher); render(<Analytics snapshot={snapshot} />);
  await screen.findByRole("heading", { name: "Categories" });
  for (const [name, grouping] of [["Month", "month"], ["Quarter", "quarter"], ["4 months", "fourMonths"], ["Half-year", "halfYear"], ["Year", "year"], ["5 years", "fiveYears"], ["All", "all"]]) {
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => { const body = JSON.parse(String(call[1]?.body)); return body.query.includes("query FlowHistory") && body.variables.grouping === grouping; })).toBe(true));
  }
  fireEvent.click(screen.getByRole("button", { name: "Week settings" }));
  fireEvent.change(screen.getByLabelText("Week ends on"), { target: { value: "3" } });
  await waitFor(() => expect(fetcher.mock.calls.some(call => JSON.parse(String(call[1]?.body)).variables.weekEnd === 3)).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2016-01-01" } });
  await waitFor(() => expect(fetcher.mock.calls.some(call => JSON.parse(String(call[1]?.body)).variables.start === "2016-01-01")).toBe(true));
});
it("ignores late category responses and retains the selected dates on retry", async () => {
  let first: ((value: Response) => void) | undefined;
  let categoryCalls = 0;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.query.includes("query FlowHistory")) return new Response(JSON.stringify({ data: { flowHistory: { buckets, flows: [], hasEarlier: false } } }));
    categoryCalls++;
    if (categoryCalls === 1) return new Promise<Response>(resolve => { first = resolve; });
    if (categoryCalls === 2) throw new Error("Offline");
    return new Response(JSON.stringify({ data: { categorySpending: { breakdown: [] } } }));
  });
  vi.stubGlobal("fetch", fetcher); render(<Analytics snapshot={snapshot} />);
  fireEvent.click(await screen.findByRole("button", { name: "Select 12–18 Oct 2026 in EUR" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  first?.(new Response(JSON.stringify({ data: { categorySpending: { breakdown: [{ categoryId: "food", currency: "EUR", direct: "123" }] } } })));
  fireEvent.click(screen.getByRole("button", { name: "Retry categories" }));
  expect(await screen.findByText("No spending in this period.")).toBeVisible();
  expect(screen.queryByText("€1.23")).toBeNull();
});
