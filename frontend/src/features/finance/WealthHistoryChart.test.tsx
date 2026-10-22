import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { nearestWealthDay, WealthHistoryChart } from "./WealthHistoryChart";
const wealth = [
  { date: "2026-09-18", amount: "10000" },
  { date: "2026-10-18", amount: "9007199254740993" },
];
afterEach(() => vi.unstubAllGlobals());
function chart() {
  render(
    <WealthHistoryChart wealth={wealth} today="2026-10-18" currency="EUR" />,
  );
  const slider = screen.getByRole("slider", { name: "Wealth history day" });
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 0,
    width: 600,
    height: 96,
    right: 700,
    bottom: 96,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  class Pointer extends MouseEvent {
    pointerType = "mouse";
  }
  vi.stubGlobal("PointerEvent", Pointer);
  return slider;
}
it("selects the nearest calendar day across the entire plot height and does not substitute missing values", () => {
  const slider = chart();
  fireEvent.pointerMove(slider, { clientX: 112, clientY: 2 });
  expect(screen.getByRole("tooltip")).toHaveTextContent("18 Sept 2026");
  expect(screen.getByRole("tooltip")).toHaveTextContent("€100.00");
  fireEvent.pointerMove(slider, { clientX: 400, clientY: 94 });
  expect(screen.getByRole("tooltip")).toHaveTextContent("3 Oct 2026");
  expect(screen.getByRole("tooltip")).toHaveTextContent("Unavailable");
  expect(document.querySelector(".wealth-guide")?.getAttribute("x1")).toBe(
    "300",
  );
  expect(document.querySelector(".wealth-selection circle")).toBeNull();
  fireEvent.pointerMove(slider, { clientX: 400, clientY: 2 });
  expect(slider).toHaveAttribute("aria-valuenow", "15");
});
it("supports keyboard endpoints and missing days with exact large amounts in accessible output", () => {
  const slider = chart();
  fireEvent.focus(slider);
  expect(slider).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("€90,071,992,547,409.93"),
  );
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider).toHaveAttribute("aria-valuenow", "0");
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(slider).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("Unavailable"),
  );
  fireEvent.keyDown(slider, { key: "End" });
  expect(slider).toHaveAttribute("aria-valuenow", "30");
  fireEvent.keyDown(slider, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
it("keeps empty and singleton history honest and exposes the exact single date/value without a plot", () => {
  const { rerender } = render(
    <WealthHistoryChart wealth={[]} today="2026-10-18" currency="EUR" />,
  );
  expect(screen.getByText("No recorded balances yet.")).toBeVisible();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  rerender(
    <WealthHistoryChart
      wealth={wealth.slice(1)}
      today="2026-10-18"
      currency="EUR"
    />,
  );
  expect(screen.getByText(/One recorded balance/)).toHaveTextContent(
    "18 Oct 2026",
  );
  expect(screen.getByText(/One recorded balance/)).toHaveTextContent(
    "€90,071,992,547,409.93",
  );
  expect(document.querySelector("svg")).toBeNull();
});
it("maps resized plot coordinates and clamps to the first/last day", () => {
  expect(nearestWealthDay(100, 100, 300)).toBe(0);
  expect(nearestWealthDay(250, 100, 300)).toBe(15);
  expect(nearestWealthDay(400, 100, 300)).toBe(30);
  expect(nearestWealthDay(-100, 100, 300)).toBe(0);
  expect(nearestWealthDay(10000, 100, 300)).toBe(30);
});
it("inspects supplied historical endpoints and leaves missing periods unavailable", () => {
  render(<WealthHistoryChart wealth={[{date:"2016-12-31",amount:"9007199254740993"},{date:"2026-10-21",amount:"100"}]} today="2026-10-21" currency="EUR" dates={["2016-12-31","2020-12-31","2026-10-21"]} labels={["2016","2020","2026"]} />);
  const slider=screen.getByRole("slider");
  expect(slider).toHaveAttribute("aria-valuemax","2");
  fireEvent.keyDown(slider,{key:"Home"});
  expect(slider).toHaveAttribute("aria-valuetext",expect.stringContaining("€90,071,992,547,409.93"));
  fireEvent.keyDown(slider,{key:"ArrowRight"});
  expect(slider).toHaveAttribute("aria-valuetext",expect.stringContaining("Unavailable"));
  expect(screen.getByText("2020")).toBeVisible();
});
