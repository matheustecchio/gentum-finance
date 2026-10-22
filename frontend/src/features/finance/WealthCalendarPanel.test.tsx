import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WealthCalendarPanel } from "./WealthCalendarPanel";
const data = {
  currency: "EUR",
  today: "2026-10-21",
  wealth: [],
  flows: [],
  converted: false,
  rateDate: "",
  rateError: "",
};
const history = {
  ...data,
  start: "2026-01-01",
  end: "2026-12-31",
  previous: "2025-12-31",
  next: "",
  buckets: [
    { start: "2026-01-01", end: "2026-01-31" },
    { start: "2026-10-01", end: "2026-10-21" },
  ],
  wealth: [
    { date: "2026-01-31", amount: "9007199254740993" },
    { date: "2026-10-21", amount: "100" },
  ],
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("ignores stale wealth pages and retries the selected year without changing current figures", async () => {
  let first: ((r: Response) => void) | undefined;
  let calls = 0;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    calls++;
    if (calls === 1)
      return new Promise<Response>((resolve) => {
        first = resolve;
      });
    if (calls === 2) throw new Error("Offline");
    return new Response(JSON.stringify({ data: { wealthCalendar: history } }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <WealthCalendarPanel data={data}>
      <strong>Current total remains independent</strong>
    </WealthCalendarPanel>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Year" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  await act(async () => {
    first?.(
      new Response(
        JSON.stringify({
          data: { wealthCalendar: { ...history, wealth: [] } },
        }),
      ),
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry wealth history" }));
  expect(await screen.findByRole("slider")).toBeVisible();
  expect(screen.getByText("Current total remains independent")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Next wealth period" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Previous wealth period" }),
  );
  await waitFor(() =>
    expect(
      JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).variables,
    ).toMatchObject({ period: "year", anchor: "2025-12-31" }),
  );
});
