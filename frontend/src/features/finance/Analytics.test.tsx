import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Analytics, calendarDay, periodRange, rangeBuckets, validRange } from "./Analytics";
import type { Snapshot } from "./client";
const snapshot: Snapshot = { accounts: [{ currency: "EUR" }], categories: [{ id: "food", name: "Food", kind: "EXPENSE" }], entries: [], totals: [], budgets: [], recurring: [] };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-21T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("handles Monday weeks, leap years, year boundaries and Dublin dates", () => {
  expect(periodRange("week", "2026-01-01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
  expect(periodRange("month", "2024-02-12")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  expect(periodRange("sixMonths", "2026-02-12")).toEqual({ start: "2025-09-01", end: "2026-02-28" });
  expect(periodRange("year", "2026-10-21")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  expect(calendarDay(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  expect(rangeBuckets("2024-02-28", "2024-03-01")).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  expect(rangeBuckets("2026-01-15", "2026-04-02")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
});
it("defaults to this month and updates both charts together across presets and navigation", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const { start } = JSON.parse(String(init?.body)).variables;
    return new Response(JSON.stringify({ data: { analytics: { flows: [{ month: start, currency: "EUR", income: "0", expense: "9007199254740993", net: "-9007199254740993" }], breakdown: [{ categoryId: "food", currency: "EUR", direct: "9007199254740993" }] } } }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} month="2026-10" />);
  await screen.findByRole("button", { name: "Food: €90,071,992,547,409.93" });
  expect(screen.getByRole("button", { name: "Next period" })).toBeDisabled();
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-10-01", end: "2026-10-21" });
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-10-19", end: "2026-10-21" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-10-12", end: "2026-10-18" }));
  fireEvent.click(screen.getByRole("button", { name: "6 months" }));
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-05-01", end: "2026-10-21" }));
  fireEvent.click(screen.getByRole("button", { name: "Year" }));
  await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-01-01", end: "2026-10-21" }));
});
it("validates custom dates and suppresses stale responses and offers retry", async () => {
  let complete: ((value: Response) => void) | undefined;
  const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} month="2026-10" />);
  const first = complete!;
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-22" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose valid dates");
  first(new Response(JSON.stringify({ data: { analytics: { flows: [], breakdown: [{ categoryId: "food", currency: "EUR", direct: "123" }] } } })));
  expect(screen.queryByRole("button", { name: "Food: €1.23" })).toBeNull();
  fetcher.mockImplementation(async () => { throw new Error("Offline"); });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-20" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: { analytics: { flows: [], breakdown: [] } } })));
  fireEvent.click(screen.getByRole("button", { name: "Retry analytics" }));
  expect(await screen.findByText("No spending in this period.")).toBeVisible();
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables).toEqual({ start: "2026-09-20", end: "2026-10-21" });
});

it("rejects impossible dates and enforces the server's calendar-year limit", () => {
  expect(validRange("2026-02-30", "2026-03-01", "2026-10-21")).toBe(false);
  expect(validRange("2021-01-01", "2026-01-01", "2026-10-21")).toBe(true);
  expect(validRange("2021-01-01", "2026-01-02", "2026-10-21")).toBe(false);
});
