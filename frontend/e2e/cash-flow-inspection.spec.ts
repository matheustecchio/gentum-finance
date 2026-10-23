import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Calendar selection, exact amounts and retry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
    let fail = false;
    await page.route("**/auth/status", (r) =>
      r.fulfill({
        json: { setupRequired: false, unlocked: true, pinEnabled: false },
      }),
    );
    await page.route("**/graphql", (r) => {
      const body = r.request().postDataJSON();
      if (body.query.includes("cashFlowPage("))
        return r.fulfill({
          json: fail
            ? { errors: [{ message: "Cash flow offline" }] }
            : {
                data: {
                  cashFlowPage: {
                    start: "2026-10-19",
                    end: "2026-10-25",
                    today: "2026-10-21",
                    selectedStart: "2026-10-19",
                    selectedEnd: "2026-10-25",
                    previous: "2026-10-18",
                    next: "",
                    grouping: "day",
                    buckets: Array.from({ length: 7 }, (_, i) => ({
                      start: `2026-10-${19 + i}`,
                      end: `2026-10-${19 + i}`,
                    })),
                    flows: [
                      {
                        month: "2026-10-19",
                        currency: "EUR",
                        income: "9007199254740993",
                        expense: "0",
                      },
                    ],
                    totals: [
                      {
                        currency: "EUR",
                        income: "9007199254740993",
                        expense: "0",
                        net: "9007199254740993",
                      },
                    ],
                    incoming: [],
                    outgoing: [],
                    entries: [],
                  },
                },
              },
        });
      return r.fulfill({
        json: {
          data: {
            overview: {
              currency: "EUR",
              today: "2026-10-21",
              wealth: [],
              flows: [],
              change30: "",
              rateError: "",
            },
            financeSummary: {
              accounts: [{ currency: "EUR" }],
              categories: [],
              entries: [],
              totals: [],
              budgets: [],
              recurring: [],
            },
          },
        },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Net cash flow · EUR/ }).click();
    const income = page.getByRole("button", { name: /19 Oct 2026 Income/ });
    await income.focus();
    await expect(page.getByRole("tooltip")).toHaveText(
      "€90,071,992,547,409.93",
    );
    await income.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    fail = true;
    await page
      .getByRole("button", { name: "Previous period", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Cash flow offline");
    fail = false;
    await page.getByRole("button", { name: "Retry cash flow" }).click();
    await expect(page.getByLabel("Net cash flow in EUR")).toHaveText(
      "€90,071,992,547,409.93",
    );
    const brand = page.locator("img.brand-mark");
    await expect(brand).toBeVisible();
    await expect.poll(() => brand.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("type", "image/svg+xml");
    for (const view of ["Spent", "Income", "Net cash flow"]) {
      await page.getByRole("group", { name: "Analytics view", exact: true })
        .getByRole("button", { name: view, exact: true }).click();
      const styles = page.getByRole("group", { name: "Chart style", exact: true });
      if (view !== "Net cash flow") {
        for (const style of ["line", "pie", "bar"]) {
          await styles.getByRole("button", { name: `${style} chart`, exact: true }).click();
          await expect(page.getByText(/View amounts/)).toHaveCount(0);
        }
      }
      for (const group of await page.locator(".analytics-view-switch").all()) {
        for (const button of await group.getByRole("button").all()) {
          await expect(button).toHaveCSS("border-radius", "4px");
          const geometry = await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const icon = element.querySelector(".asset-icon, svg")!.getBoundingClientRect();
            return { width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height,
              dx: Math.abs(box.x + box.width / 2 - icon.x - icon.width / 2),
              dy: Math.abs(box.y + box.height / 2 - icon.y - icon.height / 2) };
          });
          expect(geometry.width).toBe(40);
          expect(geometry.height).toBe(40);
          expect(geometry.iconWidth).toBe(20);
          expect(geometry.iconHeight).toBe(20);
          expect(geometry.dx).toBeLessThan(1);
          expect(geometry.dy).toBeLessThan(1);
        }
      }
      const bar = page.locator('.calendar-slot rect[role="button"]').first();
      await bar.focus();
      await expect(bar).toHaveCSS("outline-style", "none");
      await expect(bar).toHaveCSS("stroke", "none");
      await expect(page.getByRole("tooltip")).toBeVisible();
      await bar.click();
      await expect(bar).toHaveCSS("outline-style", "none");
      await expect(bar).toHaveCSS("stroke", "none");
      await expect(page.getByText(/View amounts/)).toHaveCount(0);
      await expect(page.getByRole("table", { name: "Cash flow amounts in EUR" })).toHaveCount(1);
      await page.screenshot({ path: `test-results/chart-controls-${view.replaceAll(" ", "-")}-${width}.png`, fullPage: true, animations: "disabled" });
    }

  });
}
