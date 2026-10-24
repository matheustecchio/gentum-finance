import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Analytics, calendarDay, validRange } from "./Analytics";
import { bucketLabel } from "./CashFlowChart";
import { calendarBucketLabel } from "./CalendarFlowChart";
import type { Snapshot } from "./client";
const snapshot: Snapshot = {
  accounts: [{ currency: "EUR" }],
  categories: [],
  entries: [],
  totals: [],
  budgets: [],
  recurring: [],
};
const buckets = [
  { start: "2026-10-12", end: "2026-10-18" },
  { start: "2026-10-19", end: "2026-10-25" },
];
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const income = {
  categoryId: "salary",
  name: "Salary",
  currency: "EUR",
  amount: "9007199254740993",
  count: "2",
  percentage: "100%",
  color: "#ad5e84",
};
const expense = {
  categoryId: "food",
  name: "Groceries",
  currency: "EUR",
  amount: "100",
  count: "1",
  percentage: "100%",
  color: "#ecc05b",
};
function page(selected = "") {
  return {
    start: "2026-10-19",
    end: "2026-10-25",
    today: "2026-10-21",
    grouping: "day",
    previous: "2026-10-18",
    next: "",
    selectedStart: selected || "2026-10-19",
    selectedEnd: selected || "2026-10-25",
    buckets: Array.from({ length: 7 }, (_, i) => ({
      start: `2026-10-${19 + i}`,
      end: `2026-10-${19 + i}`,
    })),
    flows: [
      {
        month: "2026-10-19",
        currency: "EUR",
        income: "9007199254740993",
        expense: "100",
      },
    ],
    totals: [
      {
        currency: "EUR",
        income: "9007199254740993",
        expense: "100",
        net: "9007199254740893",
      },
    ],
    incoming: [income],
    outgoing: [expense],
    entries: [
      {
        id: "tx",
        date: "2026-10-19",
        description: "Fictional salary",
        account: "Wallet",
        kind: "INCOME",
        currency: "EUR",
        amount: "9007199254740993",
      },
    ],
    trendBuckets: [{ start: "2026-10-19", end: "2026-10-19" }],
    trendFlows: [
      {
        month: "2026-10-19",
        currency: "EUR",
        income: "9007199254740993",
        expense: "100",
        cumulativeIncome: "9007199254740993",
        cumulativeExpense: "100",
      },
    ],
  };
}
function fixture() {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ data: { cashFlowPage: page(b.variables.selected) } }),
    );
  });
}
async function openCash() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Net cash flow · EUR/ }),
  );
  await screen.findByRole("heading", { name: "Money In" });
}
it("uses Dublin dates, readable labels and custom ranges beyond five years", () => {
  expect(calendarDay(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  expect(
    bucketLabel(
      { start: "2026-10-01", end: "2026-10-21" },
      "month",
      "2026-10-21",
    ),
  ).toBe("October 2026 · current");
  expect(bucketLabel(buckets[0], "week", "2026-10-21")).toBe("18 Oct 2026");
  expect(
    bucketLabel(
      { start: "2026-07-01", end: "2026-12-31" },
      "halfYear",
      "2027-01-01",
    ),
  ).toBe("S2 2026");
  expect(
    bucketLabel(
      { start: "2026-01-01", end: "2026-06-30" },
      "halfYear",
      "2027-01-01",
    ),
  ).toBe("S1 2026");
  for (let k = 1; k <= 4; k++)
    expect(
      bucketLabel(
        {
          start: `2026-${String(k * 3 - 2).padStart(2, "0")}-01`,
          end: "2026-12-31",
        },
        "quarter",
        "2027-01-01",
      ),
    ).toBe(`K${k} 2026`);
  expect(validRange("2026-02-30", "2026-03-01", "2026-10-21")).toBe(false);
  expect(validRange("2016-01-01", "2026-10-21", "2026-10-21")).toBe(true);
});

it("opens the financial dashboard and exposes separate income and expense bars with exact amounts", async () => {
  vi.stubGlobal("fetch", fixture());
  render(<Analytics snapshot={snapshot} />);
  expect(
    await screen.findByRole("button", { name: /Spent · EUR/ }),
  ).toBeVisible();
  await openCash();
  expect(screen.getByLabelText("Net cash flow in EUR")).toHaveTextContent(
    "€90,071,992,547,408.93",
  );
  expect(document.querySelectorAll(".calendar-slot")).toHaveLength(7);
  expect(document.querySelector(".calendar-bar.flow-net")).toBeNull();
  expect(
    calendarBucketLabel(
      { start: "2026-10-19", end: "2026-10-19" },
      "day",
      "week",
      900,
    ),
  ).toBe("Monday");
  const bar = screen.getByRole("button", { name: /19 Oct 2026 Income/ });
  fireEvent.focus(bar);
  expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
    "€90,071,992,547,409.93",
  );
  fireEvent.keyDown(bar, { key: "Escape" });
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
});
it("selects a date, clears it and opens dated category transactions", async () => {
  const fetcher = fixture();
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  await openCash();
  fireEvent.click(screen.getByRole("button", { name: /19 Oct 2026 Income/ }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (c) =>
          JSON.parse(String(c[1]?.body)).variables.selected === "2026-10-19",
      ),
    ).toBe(true),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Show full period" }),
  );
  await screen.findByRole("heading", { name: "Money In" });
  fireEvent.click(
    screen.getByRole("button", { name: "Open Salary transactions" }),
  );
  expect(await screen.findByText("Fictional salary")).toBeVisible();
  expect(
    JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables
      .categoryId,
  ).toBe("salary");
  fireEvent.click(screen.getByRole("button", { name: "Clear category" }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Transactions" })).toBeNull(),
  );
});
it("changes calendar presets and saves Monday or Sunday week starts", async () => {
  const fetcher = fixture();
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  await openCash();
  for (const label of ["Week", "Month", "Semester", "Year"]) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await screen.findByRole("heading", { name: "Money In" });
  }
  fireEvent.click(
    screen.getByRole("button", { name: "More cash flow periods" }),
  );
  fireEvent.change(screen.getByLabelText("Week starts on"), {
    target: { value: "0" },
  });
  expect(localStorage.getItem("gentum:week-start")).toBe("0");
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (c) => JSON.parse(String(c[1]?.body)).variables.weekStart === 0,
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
  await screen.findByRole("heading", { name: "Money In" });
  expect(screen.queryByRole("button", { name: "4 months" })).toBeNull();
});
it("opens Custom in a modal and restores focus without requesting on cancel", async () => {
  const fetcher = fixture();
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  await openCash();
  const more = screen.getByRole("button", { name: "More cash flow periods" });
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  expect(
    screen.getByRole("dialog", { name: "Custom date range" }),
  ).toBeVisible();
  const count = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(more).toHaveFocus();
  expect(fetcher).toHaveBeenCalledTimes(count);
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2016-01-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(
      JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables,
    ).toMatchObject({ period: "custom", start: "2016-01-01" }),
  );
  expect(more).toHaveFocus();
});
it("ignores a stale page and retries the current calendar filter", async () => {
  let resolve: ((value: Response) => void) | undefined;
  let count = 0;
  const fetcher = vi.fn(async () => {
    count++;
    if (count === 1)
      return new Promise<Response>((r) => {
        resolve = r;
      });
    if (count === 2) throw new Error("Offline");
    return new Response(JSON.stringify({ data: { cashFlowPage: page() } }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "Year" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  await act(async () => {
    resolve?.(
      new Response(
        JSON.stringify({
          data: {
            cashFlowPage: {
              ...page(),
              totals: [
                { currency: "EUR", income: "1", expense: "0", net: "1" },
              ],
            },
          },
        }),
      ),
    );
  });
  expect(
    screen.queryByRole("button", { name: /Net cash flow · EUR/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry cash flow" }));
  expect(
    await screen.findByRole("button", { name: /Net cash flow · EUR/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Year" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("opens Spent and Income, switches chart styles and returns to the dashboard", async () => {
  vi.stubGlobal("fetch", fixture());
  render(<Analytics snapshot={snapshot} />);
  fireEvent.click(await screen.findByRole("button", { name: /Spent · EUR/ }));
  expect(
    screen.getByRole("img", { name: "Cumulative expense in EUR" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "pie chart" }));
  expect(screen.getByRole("img", { name: "Categories in EUR" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Income" }));
  expect(screen.getByRole("button", { name: "bar chart" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to Analytics" }));
  expect(
    await screen.findByRole("button", { name: /Spent · EUR/ }),
  ).toBeVisible();
});
it("navigates whole periods by keyboard and keeps future navigation disabled", async () => {
  const fetcher = fixture();
  vi.stubGlobal("fetch", fetcher);
  render(<Analytics snapshot={snapshot} />);
  await openCash();
  expect(screen.getByRole("button", { name: "Next period" })).toBeDisabled();
  fireEvent.keyDown(
    screen.getByRole("group", { name: "Cash flow period navigation" }),
    { key: "ArrowLeft" },
  );
  await waitFor(() =>
    expect(
      JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables.anchor,
    ).toBe("2026-10-18"),
  );
});
it("shows exact category counts, percentages and all categories on demand", async () => {
  const data = page();
  data.incoming = Array.from({ length: 4 }, (_, i) => ({
    ...income,
    categoryId: String(i),
    name: `Income ${i}`,
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { cashFlowPage: data } })),
    ),
  );
  render(<Analytics snapshot={snapshot} />);
  await openCash();
  const list = screen.getByRole("list", { name: "Money In categories in EUR" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(list).toHaveTextContent("2 transactions");
  expect(list).toHaveTextContent("100%");
  fireEvent.click(screen.getByRole("button", { name: "See all" }));
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
});

it("labels the dashboard current wealth with its FX date and cached quote status", async () => {
  vi.stubGlobal("fetch", fixture());
  const overview = {
    currency: "EUR",
    today: "2026-10-21",
    wealth: [{ date: "2026-10-21", amount: "100" }],
    flows: [],
    rateDate: "2026-10-20",
    rateCached: true,
    rateError: "",
    converted: true,
  };
  const view = render(<Analytics snapshot={snapshot} overview={overview} />);
  expect(
    screen.getByText(
      "Current total estimated · ECB rates 2026-10-20 · Cached rates (refresh unavailable)",
    ),
  ).toBeVisible();
  view.rerender(
    <Analytics
      snapshot={snapshot}
      overview={{ ...overview, converted: false }}
    />,
  );
  expect(screen.queryByText(/Current total estimated/)).toBeNull();
});

it("labels every semester month, keeps missing months in place and leaves future income unplotted", async () => {
  const semester = Array.from({ length: 6 }, (_, i) => ({
    start: `2026-${String(i + 7).padStart(2, "0")}-01`,
    end: `2026-${String(i + 7).padStart(2, "0")}-${[31, 31, 30, 31, 30, 31][i]}`,
  }));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body));
    return Response.json({ data: { cashFlowPage: variables.period === "halfYear" ? {
      ...page(), start: "2026-07-01", end: "2026-12-31", grouping: "month",
      buckets: semester, trendBuckets: semester,
      trendFlows: [
        { month: "2026-07-01", currency: "EUR", income: "100", cumulativeExpense: "20" },
        { month: "2026-09-01", currency: "EUR", income: "300", cumulativeExpense: "60" },
      ],
    } : page() } });
  }));
  render(<Analytics snapshot={snapshot} overview={{
    currency: "EUR", today: "2026-10-21", rateDate: "", rateError: "", converted: false, flows: [],
    wealth: [{ date: "2026-10-01", amount: "100" }, { date: "2026-10-21", amount: "400" }],
  }} />);
  await screen.findByRole("button", { name: /Income · EUR/ });
  fireEvent.click(screen.getByRole("button", { name: "Semester" }));
  const incomeChart = await screen.findByRole("img", { name: /Income:.*Jul.*Dec/ });
  expect([...incomeChart.querySelectorAll(".summary-axis span")].map((node) => node.textContent))
    .toEqual(["Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]);
  expect(incomeChart.querySelectorAll("rect")).toHaveLength(2);
  const titles = [...incomeChart.querySelectorAll("rect title")].map((node) => node.textContent);
  expect(titles[0]).toMatch(/Jul.*€1.00/);
  expect(titles[1]).toMatch(/Sept.*€3.00/);
  expect(incomeChart.querySelectorAll(".is-future")).toHaveLength(2);
  const wealth = screen.getByRole("img", { name: /Wealth:.*Oct/ });
  expect(wealth).toHaveTextContent("1 Oct");
  expect(wealth).toHaveTextContent("21 Oct");
});


it("keeps the wealth card available when an unsupported history amount cannot be formatted", async () => {
  vi.stubGlobal("fetch", fixture());
  render(<Analytics snapshot={snapshot} overview={{
    currency: "EUR", today: "2026-10-21", rateDate: "", rateError: "", converted: false, flows: [],
    wealth: [{ date: "2026-10-01", amount: "9223372036857491017" }, { date: "2026-10-21", amount: "100" }],
  }} />);
  const wealth = await screen.findByRole("button", { name: /Total Wealth/ });
  expect(wealth).toHaveTextContent("€1.00");
  expect(wealth.querySelectorAll(".summary-point")).toHaveLength(1);
});
