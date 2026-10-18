import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CategoryChart,
  FlowChart,
  dublinMonth,
  OverviewCharts,
  PrimaryCurrency,
  WealthCard,
  position,
  shiftMonth,
  type OverviewData,
} from "./Overview";
import type { Snapshot } from "./client";
const snapshot: Snapshot = {
  accounts: [{ currency: "EUR" }],
  categories: [
    { id: "root", name: "Food", kind: "EXPENSE" },
    {
      id: "child",
      name: "Coffee",
      path: "Food / Coffee",
      parentId: "root",
      kind: "EXPENSE",
    },
  ],
  entries: [],
  budgets: [],
  recurring: [],
  totals: [],
  breakdown: [
    { categoryId: "root", currency: "EUR", direct: "29", total: "129" },
    { categoryId: "child", currency: "EUR", direct: "100", total: "100" },
  ],
};
const data: OverviewData = {
  change30: "-1000",
  currency: "EUR",
  today: "2026-10-18",
  wealth: [
    { date: "2026-09-18", amount: "10000" },
    { date: "2026-10-18", amount: "9000" },
  ],
  flows: [
    {
      month: "2026-10",
      currency: "EUR",
      income: "100",
      expense: "200",
      net: "-100",
    },
  ],
  rateDate: "2026-10-16",
  rateError: "",
  converted: true,
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shows an exact signed 30-day delta and leaves missing observations disconnected", () => {
  render(<WealthCard data={data} />);
  expect(screen.getByText(/-€10.00/)).toBeVisible();
  expect(screen.getByText(/2026-10-16/)).toBeVisible();
  expect(document.querySelectorAll("circle")).toHaveLength(2);
  expect(document.querySelectorAll("path[fill='none']")).toHaveLength(2);
});
it("does not invent wealth or a 30-day delta when data is unavailable", () => {
  const { rerender } = render(
    <WealthCard
      data={{ ...data, wealth: data.wealth.slice(1), change30: "" }}
    />,
  );
  expect(screen.getByText(/One recorded balance/)).toBeVisible();
  expect(document.querySelector(".wealth-card svg")).toBeNull();
  rerender(
    <WealthCard
      data={{ ...data, wealth: [], rateError: "Rates unavailable" }}
    />,
  );
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Rates unavailable");
});
it("moves continuously before pointer release, loads at the edge, and preserves the visible month when prepending", async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { overview: data } })),
  );
  vi.stubGlobal("fetch", fetcher);
  class MousePointer extends MouseEvent {
    pointerType = "mouse";
  }
  vi.stubGlobal("PointerEvent", MousePointer);
  render(<OverviewCharts snapshot={snapshot} month="2026-10" />);
  const bar = await screen.findByRole("button", {
    name: "2026-10 Net: -€1.00",
  });
  const baseline = Number(
    document.querySelector(".zero-line")?.getAttribute("y1"),
  );
  expect(Number(bar.previousElementSibling?.getAttribute("y"))).toBe(baseline);
  const nav = screen.getByRole("group", { name: "Cash flow month navigation" });
  Object.defineProperty(nav, "clientWidth", { value: 300 });
  Object.defineProperty(nav, "scrollWidth", {
    get: () => parseInt((nav.firstElementChild as HTMLElement).style.width),
  });
  nav.scrollLeft = 400;
  fireEvent.pointerDown(nav, { clientX: 100 });
  fireEvent.pointerMove(nav, { clientX: 180 });
  expect(nav.scrollLeft).toBe(320); // Before pointerup, not pagination on release.
  fireEvent.pointerUp(nav);
  expect(
    screen.queryByRole("button", { name: "Earlier months" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(nav, { key: "ArrowLeft" });
  expect(nav.scrollLeft).toBe(180);
  nav.scrollLeft = 40;
  fireEvent.scroll(nav);
  await waitFor(() =>
    expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain(
      '"month":"2026-04"',
    ),
  );
  await waitFor(() => expect(nav.scrollLeft).toBe(880));
  expect(
    screen.getByRole("button", { name: "2026-10 Net: -€1.00" }),
  ).toBeInTheDocument();
});
it("keeps existing chart data and offers retry when history fails", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (String(init?.body).includes('"month":"2026-04"'))
      throw new Error("Offline");
    return new Response(JSON.stringify({ data: { overview: data } }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<OverviewCharts snapshot={snapshot} month="2026-10" />);
  await screen.findByRole("heading", { name: "Total Wealth" });
  const nav = screen.getByRole("group", { name: "Cash flow month navigation" });
  fireEvent.keyDown(nav, { key: "ArrowLeft" });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load more months",
  );
  expect(screen.getByRole("button", { name: "Retry history" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Total Wealth" })).toBeVisible();
});
it("shows category names and exact direct spending on focus and touch/click without counting child spending twice", async () => {
  render(<CategoryChart snapshot={snapshot} month="2026-10" />);
  const parent = screen.getByRole("button", { name: "Food: €0.29" });
  fireEvent.focus(parent);
  expect(screen.getByRole("status")).toHaveTextContent("Food: €0.29");
  await userEvent.click(
    screen.getByRole("button", { name: "Food / Coffee: €1.00" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Food / Coffee: €1.00");
});
it("persists primary currency and keeps the previous selection on save failure", async () => {
  const fetcher = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(init?.body).includes("mutation")
            ? { errors: [{ message: "Rejected" }] }
            : { data: { overview: data } },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PrimaryCurrency />);
  const select = screen.getByLabelText("Primary currency");
  await waitFor(() => expect(select).toHaveValue("EUR"));
  await userEvent.selectOptions(select, "USD");
  expect(
    await screen.findByText("Unable to save primary currency"),
  ).toBeVisible();
  expect(select).toHaveValue("EUR");
  expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain(
    '"currency":"USD"',
  );
});
it("keeps chart geometry bounded above Number precision and month navigation crosses years", () => {
  expect(
    position(9007199254740994n, 9007199254740993n, 9007199254740995n),
  ).toBe(75);
  expect(shiftMonth("2026-01", -3)).toBe("2025-10");
});
it("explains a 30-day difference overflow while keeping supported current wealth visible", () => {
  render(
    <WealthCard
      data={{
        ...data,
        change30: "",
        changeError:
          "30-day change unavailable: the difference exceeds the supported amount.",
        wealth: [
          { date: "2026-09-18", amount: "-1" },
          { date: "2026-10-18", amount: "9223372036854775807" },
        ],
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "difference exceeds the supported amount",
  );
  expect(screen.getAllByText(/92,233,720,368,547,758.07/)[0]).toBeVisible();
});
it("saves the selected currency and reads it back after remount", async () => {
  let saved = "EUR";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.startsWith("mutation")) {
        saved = body.variables.input.currency;
        return new Response(
          JSON.stringify({ data: { executeFinance: "Saved" } }),
        );
      }
      return new Response(
        JSON.stringify({ data: { overview: { ...data, currency: saved } } }),
      );
    }),
  );
  const first = render(<PrimaryCurrency />);
  await waitFor(() =>
    expect(screen.getByLabelText("Primary currency")).toHaveValue("EUR"),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Primary currency"),
    "USD",
  );
  expect(await screen.findByText("Primary currency saved")).toBeVisible();
  first.unmount();
  render(<PrimaryCurrency />);
  await waitFor(() =>
    expect(screen.getByLabelText("Primary currency")).toHaveValue("USD"),
  );
});
it("does not draw a plot or fictional curve with no recorded balances", () => {
  render(<WealthCard data={{ ...data, wealth: [], change30: "" }} />);
  expect(screen.getByText("No recorded balances yet.")).toBeVisible();
  expect(document.querySelector(".wealth-card svg")).toBeNull();
});

it("uses the Dublin calendar month at summer midnight and year rollover", () => {
  expect(dublinMonth(new Date("2026-06-30T22:59:59Z"))).toBe("2026-06");
  expect(dublinMonth(new Date("2026-06-30T23:00:00Z"))).toBe("2026-07");
  expect(dublinMonth(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  expect(dublinMonth(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
});
it("shows only the exact selected amount and exposes zero bars to keyboard and touch", () => {
  render(
    <FlowChart
      months={["2026-10"]}
      currency="EUR"
      rows={[
        {
          month: "2026-10",
          currency: "EUR",
          income: "9007199254740993",
          expense: "0",
          net: "-1",
        },
      ]}
    />,
  );
  const income = screen.getByRole("button", { name: /Income/ });
  fireEvent.focus(income);
  expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
    "€90,071,992,547,409.93",
  );
  expect(screen.getByRole("tooltip", { hidden: true })).not.toHaveTextContent(
    "2026",
  );
  const zero = screen.getByRole("button", { name: "2026-10 Expenses: €0.00" });
  expect(Number(zero.getAttribute("height"))).toBeGreaterThan(0);
  fireEvent.click(zero);
  expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
    "€0.00",
  );
  fireEvent.keyDown(zero, { key: "Escape" });
  expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
});
it("clamps a future reporting month before requesting or rendering cash flow", async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { overview: data } })),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<OverviewCharts snapshot={snapshot} month="2027-12" />);
  await screen.findByRole("button", { name: "2026-10 Net: -€1.00" });
  expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain(
    '"month":"2026-10"',
  );
  const nav = screen.getByRole("group", { name: "Cash flow month navigation" });
  fireEvent.keyDown(nav, { key: "ArrowRight" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("2027-12", { selector: "svg text" })).toBeNull();
});
