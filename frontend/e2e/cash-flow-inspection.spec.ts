import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Period cash flow supports focus, touch, exact money and retry at ${width}px`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
    await page.setViewportSize({ width, height: 900 });
    let fail = false;
    await page.route("**/auth/status", route => route.fulfill({ json: { setupRequired: false, unlocked: true, pinEnabled: false } }));
    await page.route("**/graphql", route => {
      const body = route.request().postDataJSON();
      if (body.query.includes("analytics(")) return route.fulfill({ json: fail ? { errors: [{ message: "Analytics offline" }] } : { data: { analytics: { flows: [{ month: body.variables.start, currency: "EUR", income: "9007199254740993", expense: "0", net: "9007199254740993" }], breakdown: [] } } } });
      return route.fulfill({ json: { data: { overview: { currency: "EUR", today: "2026-10-21", wealth: [], change30: "", flows: [], rateError: "", converted: false }, financeSummary: { accounts: [{ currency: "EUR" }], categories: [], entries: [], totals: [], budgets: [], recurring: [] } } } });
    });
    await page.goto("/");
    const income = page.getByRole("button", { name: "2026-10-01 Income: €90,071,992,547,409.93", exact: true });
    await income.focus();
    await expect(page.getByRole("tooltip")).toHaveText("€90,071,992,547,409.93");
    await income.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByRole("button", { name: "2026-10-01 Expenses: €0.00", exact: true }).click();
    await expect(page.getByRole("tooltip")).toHaveText("€0.00");
    fail = true;
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Analytics offline");
    await expect(page.getByRole("heading", { name: "Categories", exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry analytics" }).click();
    await expect(page.locator(".category-chart .chart-note")).toContainText(/19.*21 Oct 2026/);
  });
}
