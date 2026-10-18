import { expect, test, type Page } from "@playwright/test";
import { formatMoney } from "../src/features/accounts/money";
function fixture(change = "-7410", gap = false) {
  const current = 2715209n,
    delta = BigInt(change);
  const wealth = Array.from({ length: 31 }, (_, i) => {
    const day = new Date("2026-09-18T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + i);
    return {
      date: day.toISOString().slice(0, 10),
      amount: (current - delta + (delta * BigInt(i)) / 30n).toString(),
    };
  }).filter((_, i) => !gap || i !== 15);
  return {
    currency: "EUR",
    today: "2026-10-18",
    wealth,
    change30: change,
    flows: [],
    converted: false,
    rateDate: "",
    rateError: "",
    historyNote: "Reconstructed ledger history. Missing days are unavailable.",
  };
}
async function setup(page: Page, change = "-7410", gap = false) {
  const overview = fixture(change, gap);
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { setupRequired: false, unlocked: true, pinEnabled: false },
    }),
  );
  await page.route("**/graphql", (route) =>
    route.fulfill({
      json: {
        data: {
          overview,
          financeSummary: {
            accounts: [{ id: "a", currency: "EUR" }],
            categories: [{ id: "food", name: "Food", kind: "EXPENSE" }],
            entries: [],
            budgets: [],
            recurring: [],
            totals: [],
          },
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("slider", { name: "Wealth history day" }).waitFor();
  return overview;
}
for (const width of [1280, 390])
  for (const change of [
    "-7410",
    "0",
    "12345",
    "123456789",
    "9223372036854775807",
    "-9223372036854775808",
  ]) {
    test(`Inline wealth change at ${width}px: ${change}, normal and enlarged text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, change);
      const group = page.locator(".wealth-change"),
        amount = group.locator(".wealth-change-amount"),
        label = group.locator("small");
      await expect(amount).toHaveText(
        `${BigInt(change) >= 0n ? "+" : ""}${formatMoney(change, "EUR")}`,
      );
      await expect(group).toHaveClass(
        new RegExp(BigInt(change) < 0n ? "loss" : "gain"),
      );
      for (const fontSize of ["100%", "200%"]) {
        await page.locator("html").evaluate((e, size) => {
          e.style.fontSize = size;
        }, fontSize);
        const a = (await amount.boundingBox())!,
          l = (await label.boundingBox())!;
        expect(l.x).toBeGreaterThanOrEqual(a.x + a.width);
        expect(l.y).toBeLessThan(a.y + a.height);
        expect(a.y).toBeLessThan(l.y + l.height);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await expect(
        page.getByText("History details", { exact: true }),
      ).toHaveCount(0);
    });
  }
test("Pointer selects by x throughout plot height, shows gaps honestly and leaves the total unchanged", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const data = await setup(page, "-7410", true);
  const slider = page.getByRole("slider", { name: "Wealth history day" });
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const x = (i: number) => box.x + ((12 + i * 19.2) / 600) * box.width;
  await page.mouse.move(x(5), box.y + 2);
  await expect(slider).toHaveAttribute("aria-valuenow", "5");
  await expect(page.getByRole("tooltip")).toContainText(
    formatMoney(
      data.wealth.find((w) => w.date === "2026-09-23")!.amount,
      "EUR",
    ),
  );
  await page.mouse.move(x(5), box.y + box.height - 2);
  await expect(slider).toHaveAttribute("aria-valuenow", "5");
  await page.mouse.move(x(15), box.y + 2);
  await expect(page.getByRole("tooltip")).toHaveText(/3 Oct 2026Unavailable/);
  await expect(page.locator(".wealth-selection circle")).toHaveCount(0);
  await expect(page.locator(".wealth-guide")).toHaveAttribute("x1", "300");
  await expect(page.locator(".wealth-value > strong")).toHaveText("€27,152.09");
  for (const i of [0, 30]) {
    await page.mouse.move(x(i), box.y + box.height - 2);
    await expect(slider).toHaveAttribute("aria-valuenow", String(i));
    const tip = (await page.getByRole("tooltip").boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(tip.x + tip.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await page.screenshot({ path: "/tmp/issue21-pointer.png", fullPage: true });
});
test("Keyboard exposes dates and values, includes missing days and dismisses the tooltip", async ({
  page,
}) => {
  await setup(page, "-7410", true);
  const slider = page.getByRole("slider", { name: "Wealth history day" });
  await slider.focus();
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    /18 Oct 2026: €27,152.09/,
  );
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "3 Oct 2026: Unavailable",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tooltip")).toContainText("€27,152.09");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(slider).not.toBeFocused();
});
test("Native touch tap/drag selects days and a vertical swipe still scrolls the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page);
  const slider = page.getByRole("slider", { name: "Wealth history day" });
  await slider.scrollIntoViewIfNeeded();
  let box = (await slider.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const x = (i: number) => box.x + ((12 + i * 19.2) / 600) * box.width,
    y = box.y + box.height - 3;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x(2), y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x(2), y }],
  });
  for (let i = 4; i <= 24; i += 2) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x(i), y }],
    });
    await page.waitForTimeout(20);
  }
  await expect(slider).toHaveAttribute("aria-valuenow", "24");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByRole("tooltip")).toContainText("12 Oct 2026");
  await slider.scrollIntoViewIfNeeded();
  box = (await slider.boundingBox())!;
  const scrollBefore = await page.evaluate(() => scrollY),
    tx = box.x + box.width / 2,
    ty = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: tx, y: ty }],
  });
  for (let i = 10; i <= 90; i += 10) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: tx, y: ty - i }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scrollBefore + 20);
  await cdp.detach();
  await page.screenshot({ path: "/tmp/issue21-touch.png", fullPage: true });
});
