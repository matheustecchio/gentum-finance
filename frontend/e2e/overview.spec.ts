import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Overview periods and shared chart ranges at ${width}px`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
    await page.setViewportSize({ width, height: 900 });
    const requested: { start: string; end: string }[] = [];
    await page.route("**/auth/status", route => route.fulfill({ json: { setupRequired: false, unlocked: true, pinEnabled: false } }));
    await page.route("**/graphql", route => {
      const body = route.request().postDataJSON();
      if (body.query.includes("analytics(")) {
        requested.push(body.variables);
        return route.fulfill({ json: { data: { analytics: { flows: [{ month: body.variables.start, currency: "EUR", income: "100", expense: "29", net: "71" }], breakdown: [{ categoryId: "food", currency: "EUR", direct: "29" }] } } } });
      }
      return route.fulfill({ json: { data: {
        overview: { currency: "EUR", today: "2026-10-21", wealth: [], change30: "", flows: [], rateError: "", converted: false },
        financeSummary: { accounts: [{ id: "a", currency: "EUR" }], categories: [{ id: "food", name: "Food", kind: "EXPENSE" }], entries: [], totals: [], budgets: [], recurring: [] },
      } } });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Food: €0.29" })).toBeVisible();
    expect(requested.at(-1)).toEqual({ start: "2026-10-01", end: "2026-10-21" });
    await expect(page.getByLabel("Reporting month")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next period" })).toBeDisabled();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(page.locator(".category-chart .chart-note")).toContainText(/19.*21 Oct 2026/);
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page.locator(".category-chart .chart-note")).toContainText(/12.*18 Oct 2026/);
    await page.getByRole("button", { name: "6 months", exact: true }).click();
    await expect(page.locator(".category-chart .chart-note")).toContainText(/1 May.*21 Oct 2026/);
    await page.getByRole("button", { name: "Year", exact: true }).click();
    await expect(page.locator(".category-chart .chart-note")).toContainText(/1 Jan.*21 Oct 2026/);
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.getByLabel("Start date", { exact: true }).fill("2026-09-30");
    await page.getByLabel("End date", { exact: true }).fill("2026-10-02");
    await expect(page.locator(".category-chart .chart-note")).toContainText(/30 Sept.*2 Oct 2026/);
    expect(requested.at(-1)).toEqual({ start: "2026-09-30", end: "2026-10-02" });
    await expect(page.getByText("Every amount accounted for. Your wealth in perspective.")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/gentum-period-${width}.png`, fullPage: true });
  });
}
