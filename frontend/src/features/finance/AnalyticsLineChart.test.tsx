import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AnalyticsLineChart } from "./AnalyticsLineChart";
const buckets = [{ start: "2026-10-19", end: "2026-10-19" }, { start: "2026-10-20", end: "2026-10-20" }, { start: "2026-10-21", end: "2026-10-21" }];
it.each(["income", "expense"] as const)("inspects exact %s values and dates with a zero-based scale", kind => {
  render(<AnalyticsLineChart buckets={buckets} rows={[{ month: buckets[0].start, currency: "EUR", cumulativeIncome: "9007199254740993", cumulativeExpense: "9007199254740993" }]} currency="EUR" kind={kind} today="2026-10-20" period="week" comparisonBuckets={[{ start: "2026-10-12", end: "2026-10-12" }]} comparisonRows={[{ month: "2026-10-12", currency: "EUR", cumulativeIncome: "12000", cumulativeExpense: "12000" }]} />);
  expect(screen.getByText("Monday")).toBeVisible();
  expect(screen.getByText("€0.00")).toBeVisible();
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(screen.getByRole("tooltip")).toHaveTextContent("€90,071,992,547,409.93");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Previous: €120.00");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("12 Oct 2026");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("Selected:");
  expect(document.querySelector("input[type=range]")).toBeNull();
  expect(slider).toHaveAttribute("aria-valuemax", "1");
  fireEvent.keyDown(slider, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
it("keeps inspection in range when changing to fewer buckets", () => {
  const props = { buckets, rows: [], currency: "EUR", kind: "expense" as const, today: "2026-10-21" };
  const { rerender } = render(<AnalyticsLineChart {...props} />);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  rerender(<AnalyticsLineChart {...props} buckets={buckets.slice(0, 1)} />);
  expect(screen.getByRole("tooltip")).toHaveTextContent("19 Oct 2026");
});

it("keeps the previous endpoint visible and inspectable across unequal periods", () => {
  const previous = buckets.slice(0, 2);
  render(<AnalyticsLineChart buckets={buckets} rows={[]} currency="EUR" kind="expense" today="2026-10-21" comparisonBuckets={previous} comparisonRows={[{ month: previous[1].start, currency: "EUR", cumulativeExpense: "12345" }]} width={320} />);
  fireEvent.focus(screen.getByRole("slider"));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Previous: €123.45");
  expect(screen.getByRole("tooltip")).toHaveTextContent("21 Oct 2026");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("20 Oct 2026");
  expect(document.querySelector(".analytics-comparison-line")).toHaveAttribute("points", expect.stringMatching(/300,35$/));
  expect(screen.getByRole("img")).toHaveAttribute("viewBox", "0 0 320 250");
});
