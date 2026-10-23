import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AnalyticsLineChart } from "./AnalyticsLineChart";
const buckets = [{ start: "2026-10-19", end: "2026-10-19" }, { start: "2026-10-20", end: "2026-10-20" }, { start: "2026-10-21", end: "2026-10-21" }];
it.each(["income", "expense"] as const)("inspects exact %s values and dates with a zero-based scale", kind => {
  render(<AnalyticsLineChart buckets={buckets} rows={[{ month: buckets[0].start, currency: "EUR", cumulativeIncome: "9007199254740993", cumulativeExpense: "9007199254740993" }]} currency="EUR" kind={kind} today="2026-10-20" period="week" comparisonBuckets={[{ start: "2026-10-12", end: "2026-10-12" }]} comparisonRows={[{ month: "2026-10-12", currency: "EUR", cumulativeIncome: "12000", cumulativeExpense: "12000" }]} />);
  expect(screen.getByText("Monday")).toBeVisible();
  expect(screen.getByText("€0.00")).toBeVisible();
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(screen.getByRole("tooltip")).toHaveTextContent("Selected: €90,071,992,547,409.93");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Previous: €120.00");
  expect(screen.getByRole("tooltip")).toHaveTextContent("12 Oct 2026");
  expect(slider).toHaveAttribute("max", "1");
  fireEvent.keyDown(slider, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
it("keeps inspection in range when changing to fewer buckets", () => {
  const props = { buckets, rows: [], currency: "EUR", kind: "expense" as const, today: "2026-10-21" };
  const { rerender } = render(<AnalyticsLineChart {...props} />);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
  rerender(<AnalyticsLineChart {...props} buckets={buckets.slice(0, 1)} />);
  expect(screen.getByRole("tooltip")).toHaveTextContent("19 Oct 2026");
});
