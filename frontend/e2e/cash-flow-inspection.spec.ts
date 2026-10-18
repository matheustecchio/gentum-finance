import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

function shift(month: string, count: number) {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7);
}
async function setup(
  page: Page,
  now = "2026-10-18T12:00:00Z",
  failHistory = false,
  expense = "340000",
) {
  const requested: string[] = [];
  let failed = false;
  await page.clock.install({ time: new Date(now) });
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { setupRequired: false, unlocked: true, pinEnabled: false },
    }),
  );
  await page.route("**/graphql", (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes("overview(")) {
      const month = body.variables.month;
      requested.push(month);
      if (
        failHistory &&
        !failed &&
        month < (page.viewportSize()!.width > 1000 ? "2026-01" : "2026-05")
      ) {
        failed = true;
        return route.fulfill({
          json: { errors: [{ message: "Fixture history offline" }] },
        });
      }
      return route.fulfill({
        json: {
          data: {
            overview: {
              currency: "EUR",
              today: "2026-10-18",
              wealth: [],
              change30: "",
              converted: false,
              rateError: "",
              rateDate: "",
              flows: Array.from({ length: 6 }, (_, i) => ({
                month: shift(month, i - 5),
                currency: "EUR",
                income: "300000",
                expense: i === 4 ? "300000" : expense,
                net: i === 4 ? "0" : (300000n - BigInt(expense)).toString(),
              })),
            },
          },
        },
      });
    }
    return route.fulfill({
      json: {
        data: {
          financeSummary: {
            accounts: [{ id: "a", currency: "EUR" }],
            categories: [],
            breakdown: [],
            entries: [],
            budgets: [],
            recurring: [],
            totals: [],
          },
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "Cash flow month navigation" })
    .waitFor();
  return requested;
}
const navOf = (page: Page) =>
  page.getByRole("group", { name: "Cash flow month navigation" });
for (const width of [1280, 390]) {
  test(`Amount tooltip stays above each series and within bounds at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    const nav = navOf(page);
    await expect(page.locator(".chart-legend span")).toHaveText([
      "Income",
      "Expenses",
      "Net flow",
    ]);
    await expect(page.locator(".currency-flow .bar-inspection")).toHaveCount(0);
    for (const [series, value, color] of [
      ["Income", "€3,000.00", "rgb(21, 153, 108)"],
      ["Expenses", "€3,400.00", "rgb(215, 67, 86)"],
      ["Net", "-€400.00", "rgb(52, 119, 217)"],
    ]) {
      const bar = nav.getByRole("button", {
        name: `2026-10 ${series}: ${value}`,
        exact: true,
      });
      await bar.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(value);
      await expect(tooltip).toHaveCSS("color", color);
      const a = (await bar.boundingBox())!,
        t = (await tooltip.boundingBox())!,
        v = (await nav.boundingBox())!;
      expect(t.y + t.height).toBeLessThanOrEqual(a.y);
      expect(t.x).toBeGreaterThanOrEqual(v.x - 1);
      expect(t.x + t.width).toBeLessThanOrEqual(v.x + v.width + 1);
    }
    await page.locator("html").evaluate((e) => {
      e.style.fontSize = "200%";
    });
    const zero = nav.getByRole("button", {
      name: "2026-09 Net: €0.00",
      exact: true,
    });
    await zero.focus();
    await expect(page.getByRole("tooltip")).toHaveText("€0.00");
    const z = (await zero.boundingBox())!,
      t = (await page.getByRole("tooltip").boundingBox())!;
    expect(z.height).toBeGreaterThan(0);
    expect(t.y + t.height).toBeLessThanOrEqual(z.y);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(page.getByRole("tooltip")).toHaveText("€0.00");
    await page.keyboard.press("Tab");
    await expect(zero).not.toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/issue22-tooltip-${width}.png`,
      fullPage: true,
    });
  });
  test(`Past loading, retry, anchor and current-month stop at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const requested = await setup(page, undefined, true),
      nav = navOf(page);
    // Start at the current month. Rightward keyboard attempts must be inert.
    await expect
      .poll(() => nav.evaluate((e) => e.scrollWidth > e.clientWidth + 140))
      .toBe(true);
    await nav.focus();
    await page.keyboard.press("ArrowRight");
    expect(requested.every((m) => m <= "2026-10")).toBe(true);
    await nav.evaluate((e) => {
      e.scrollLeft = 150;
    });
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByRole("button", { name: "Retry history" }),
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "2026-10 Net: -€400.00", exact: true }),
    ).toBeAttached();
    const oldWidth = await nav.evaluate((e) => e.scrollWidth);
    const oldLeft = await nav.evaluate((e) => e.scrollLeft);
    await page.getByRole("button", { name: "Retry history" }).click();
    await expect
      .poll(() => nav.evaluate((e) => e.scrollWidth))
      .toBe(oldWidth + 840);
    expect(await nav.evaluate((e) => e.scrollLeft)).toBeCloseTo(
      oldLeft + 840,
      0,
    );
    await nav.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await nav.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    const widthBefore = await nav.evaluate((e) => e.scrollWidth);
    const box = (await nav.boundingBox())!;
    await page.mouse.move(box.x + box.width - 70, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 100, { steps: 10 });
    await page.mouse.up();
    expect(await nav.evaluate((e) => e.scrollWidth)).toBe(widthBefore);
    expect(
      (await nav.locator("svg text").allTextContents()).every(
        (m) => m <= "2026-10",
      ),
    ).toBe(true);
    expect(requested.every((m) => m <= "2026-10")).toBe(true);
    // A past selection can load forward only as far as current month.
    await page.getByLabel("Reporting month").fill("2026-07");
    await expect(nav.locator("svg text").last()).toHaveText("2026-07");
    await nav.evaluate((e) => {
      e.scrollLeft = e.scrollWidth;
    });
    await nav.focus();
    await page.keyboard.press("ArrowRight");
    await expect(nav.locator("svg text").last()).toHaveText("2026-10");
    expect(requested.every((m) => m <= "2026-10")).toBe(true);
    await page.getByLabel("Reporting month").fill("2027-12");
    await expect(nav.locator("svg text").last()).toHaveText("2026-10");
    expect(requested.every((m) => m <= "2026-10")).toBe(true);
  });
}
test("Native touch selects a bar, swipes history and cannot move beyond current month", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const requested = await setup(page),
    nav = navOf(page);
  const bar = nav.getByRole("button", {
    name: "2026-10 Expenses: €3,400.00",
    exact: true,
  });
  await bar.scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const b = (await bar.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByRole("tooltip")).toHaveText("€3,400.00");
  const box = (await nav.boundingBox())!;
  const swipe = async (from: number, to: number) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from, y: box.y + 120 }],
    });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from + ((to - from) * i) / 10, y: box.y + 120 }],
      });
      await page.waitForTimeout(20);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const before = await nav.evaluate((e) => e.scrollLeft);
  await swipe(box.x + 40, box.x + 200);
  expect(await nav.evaluate((e) => e.scrollLeft)).toBeLessThan(before - 30);
  await nav.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  await swipe(box.x + 220, box.x + 40);
  expect(requested.every((m) => m <= "2026-10")).toBe(true);
  expect(
    (await nav.locator("svg text").allTextContents()).every(
      (m) => m <= "2026-10",
    ),
  ).toBe(true);
  await cdp.detach();
});
for (const [now, before, after] of [
  ["2026-06-30T22:59:30Z", "2026-06", "2026-07"],
  ["2026-12-31T23:59:30Z", "2026-12", "2027-01"],
]) {
  test(`Dynamic Dublin month boundary ${before} to ${after}`, async ({
    page,
  }) => {
    const requested = await setup(page, now),
      nav = navOf(page);
    await page.getByLabel("Reporting month").fill("2028-12");
    await expect(nav.locator("svg text").last()).toHaveText(before);
    expect(requested.every((m) => m <= before)).toBe(true);
    await page.clock.runFor(60_000);
    await expect(nav.locator("svg text").last()).toHaveText(after);
    expect(requested).toContain(after);
    expect(requested.every((m) => m <= after)).toBe(true);
  });
}

test("Large exact amount tooltip fits a narrow viewport with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, undefined, false, "9223372036854775807");
  await page.locator("html").evaluate((e) => {
    e.style.fontSize = "200%";
  });
  const bar = navOf(page).getByRole("button", {
    name: "2026-10 Expenses: €92,233,720,368,547,758.07",
    exact: true,
  });
  await bar.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("€92,233,720,368,547,758.07");
  const t = (await tooltip.boundingBox())!,
    b = (await bar.boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(390);
  expect(t.y + t.height).toBeLessThanOrEqual(b.y);
  expect(t.y).toBeGreaterThanOrEqual(0);
});
