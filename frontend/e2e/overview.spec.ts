import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Overview charts and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const wealth = Array.from({ length: 31 }, (_, i) => {
      const day = new Date("2026-09-18T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + i);
      return {
        date: day.toISOString().slice(0, 10),
        amount: String(1900000 + i * 1800 - (i > 19 ? 40000 : 0)),
      };
    });
    const requested: string[] = [];
    await page.route("**/auth/status", (route) =>
      route.fulfill({
        json: { setupRequired: false, unlocked: true, pinEnabled: false },
      }),
    );
    await page.route("**/graphql", (route) => {
      const body = route.request().postDataJSON();
      const month = body.variables.month;
      if (body.query.includes("overview(")) {
        requested.push(month);
        return route.fulfill({
          json: {
            data: {
              overview: {
                currency: "EUR",
                today: "2026-10-18",
                wealth,
                change30: "14000",
                converted: true,
                rateDate: "2026-10-16",
                rateError: "",
                flows: [
                  {
                    month,
                    currency: "EUR",
                    income: "300000",
                    expense: "340000",
                    net: "-40000",
                  },
                ],
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
              categories: [
                { id: "food", name: "Food and groceries", kind: "EXPENSE" },
                { id: "travel", name: "Travel", kind: "EXPENSE" },
              ],
              breakdown: [
                {
                  categoryId: "food",
                  currency: "EUR",
                  direct: "23450",
                  total: "23450",
                },
                {
                  categoryId: "travel",
                  currency: "EUR",
                  direct: "7800",
                  total: "7800",
                },
              ],
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
    await page.getByLabel("Reporting month").fill("2026-10");
    await expect(
      page.getByRole("heading", { name: "Total Wealth" }),
    ).toBeVisible();
    await expect(page.getByText("+€140.00", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "2026-10 Net: -€400.00" }).click();
    await expect(page.locator(".currency-flow .bar-inspection")).toHaveText(
      "2026-10 Net: -€400.00",
    );
    await page
      .getByRole("button", { name: "Food and groceries: €234.50" })
      .click();
    await expect(page.locator(".category-chart [role=status]")).toContainText(
      "Food and groceries: €234.50",
    );
    await page.getByRole("button", { name: "Earlier months" }).click();
    await expect.poll(() => requested.at(-1)).toBe("2026-07");
    const nav = page.getByRole("group", { name: "Cash flow month navigation" });
    await nav.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => requested.at(-1)).toBe("2026-10");
    await nav.scrollIntoViewIfNeeded();
    const box = await nav.locator("svg").boundingBox();
    if (!box) throw new Error("Missing navigation chart");
    await page.mouse.move(box.x + box.width * 0.3, box.y + 45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3 + 90, box.y + 45, {
      steps: 8,
    });
    await page.mouse.up();
    await expect.poll(() => requested.at(-1)).toBe("2026-07");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Later months" }).click();
    await expect.poll(() => requested.at(-1)).toBe("2026-10");
    await page.screenshot({
      path: `/tmp/overview-${width}.png`,
      fullPage: true,
    });
  });
}
