import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  CategoryChart,
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
afterEach(() => vi.unstubAllGlobals());
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
  expect(screen.getByText(/30-day change unavailable/)).toBeVisible();
  rerender(
    <WealthCard
      data={{ ...data, wealth: [], rateError: "Rates unavailable" }}
    />,
  );
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Rates unavailable");
});
it("loads earlier and later six-month windows by button, keyboard and swipe and displays negative net below zero", async () => {
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { overview: data } })),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<OverviewCharts snapshot={snapshot} month="2026-10" />);
  const bar = await screen.findByRole("button", {
    name: "2026-10 Net: -€1.00",
  });
  const baseline = Number(
    document.querySelector(".zero-line")?.getAttribute("y1"),
  );
  expect(Number(bar.getAttribute("y"))).toBe(baseline);
  await userEvent.click(bar);
  expect(
    screen.getByText("2026-10 Net: -€1.00", { selector: "p" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Earlier months" }));
  await waitFor(() =>
    expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain(
      '"month":"2026-07"',
    ),
  );
  const navigation = screen.getByRole("group", {
    name: "Cash flow month navigation",
  });
  fireEvent.keyDown(navigation, { key: "ArrowRight" });
  await waitFor(() =>
    expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain(
      '"month":"2026-10"',
    ),
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  fireEvent.pointerDown(navigation, { clientX: 100 });
  fireEvent.pointerUp(navigation, { clientX: 240 });
  await waitFor(() =>
    expect(String(fetcher.mock.calls.at(-1)?.[1]?.body)).toContain(
      '"month":"2026-07"',
    ),
  );
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
