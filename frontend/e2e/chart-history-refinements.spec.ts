import { expect, test } from "@playwright/test";

for (const width of [390, 1280, 2560, 3840]) {
  test(`chart markers, compact inspection and transaction modal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    await page.clock.install({ time: new Date("2026-10-24T12:00:00Z") });
    const buckets = Array.from({ length: 6 }, (_, i) => ({ start: `2026-10-${19 + i}`, end: `2026-10-${19 + i}` }));
    const categories = [{ id: "expense", name: "Food", kind: "EXPENSE" }];
    let edited = { id: "entry-1", date: "2026-10-24", accountId: "wallet", categoryId: "expense", kind: "EXPENSE", amount: "1234", currency: "EUR", description: "Fictional transaction" };
    await page.route("**/auth/status", route => route.fulfill({ json: { setupRequired: false, unlocked: true, pinEnabled: false } }));
    await page.route("**/graphql", route => {
      const { query, variables } = route.request().postDataJSON();
      if (query.includes("mutation")) {
        edited = { ...edited, ...variables.input };
        return route.fulfill({ json: { data: { executeFinance: "Saved" } } });
      }
      return route.fulfill({ json: { data: {
        financeSummary: { accounts: [{ id: "wallet", name: "Wallet", currency: "EUR" }], categories, entries: [], budgets: [], recurring: [], totals: [] },
        overview: { currency: "EUR", today: "2026-10-24", wealth: buckets.map((b, i) => ({ date: b.start, amount: String((i + 1) * 10000) })), flows: [], converted: false, rateDate: "", rateError: "" },
        cashFlowPage: {
          start: "2026-10-01", end: "2026-10-31", today: "2026-10-24", grouping: "day", previous: "", next: "", selectedStart: "2026-10-01", selectedEnd: "2026-10-31",
          buckets, trendBuckets: buckets, flows: [], incoming: [], outgoing: [], entries: [],
          totals: [{ currency: "EUR", income: "0", expense: "6000", net: "-6000" }],
          trendFlows: buckets.map((b, i) => ({ month: b.start, currency: "EUR", cumulativeExpense: String((i + 1) * 1000), income: "0" })),
          comparisonBuckets: buckets.map(b => ({ start: b.start.replace("-10-", "-09-"), end: b.end.replace("-10-", "-09-") })),
          comparisonFlows: buckets.map((b, i) => ({ month: b.start.replace("-10-", "-09-"), currency: "EUR", cumulativeExpense: String((i + 1) * 900) })),
        },
        entryHistory: { entries: [edited], hasEntries: true, totalCount: 120 },
      } } });
    });
    await page.goto("/");
    const dots = page.locator(".summary-point");
    await expect(dots).toHaveCount(12);
    for (const dot of await dots.all()) {
      const box = (await dot.boundingBox())!;
      expect(box.width).toBe(8);
      expect(box.height).toBe(8);
      await expect(dot).toHaveCSS("border-radius", "50%");
      expect(await dot.evaluate(el => el.closest("svg"))).toBeNull();
      await expect(dot).toHaveAttribute("title", /€/);
    }
    await page.screenshot({ path: `test-results/round-markers-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: /Spent · EUR/ }).click();
    const chart = page.getByRole("slider", { name: "Inspect expense history in EUR" });
    await chart.focus();
    await chart.press("Home");
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("19 Oct 2026");
    await expect(tooltip).toContainText("€10.00");
    await expect(tooltip).toContainText("Previous: €9.00");
    await expect(tooltip).not.toContainText(/Selected:|Sept/);
    await expect(tooltip.locator("time")).toHaveCount(1);
    await expect(page.locator("input[type=range]")).toHaveCount(0);
    await chart.press("End");
    await expect(tooltip).toContainText("€60.00");
    await chart.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Transactions", exact: true }).click();
    const clear = page.getByRole("button", { name: "Clear filters" });
    const size = page.getByLabel("Rows per page");
    await expect(size).toBeVisible();
    await expect(page.getByText("Rows per page", { exact: true })).toHaveCount(0);
    const clearBox = (await clear.boundingBox())!, sizeBox = (await size.boundingBox())!;
    expect(sizeBox.width).toBe(clearBox.width);
    expect(sizeBox.height).toBe(clearBox.height);
    const pages = page.getByRole("navigation", { name: "History pages" });
    await expect(pages.locator("[aria-label^='Page ']")).toHaveText(["1", "2", "3", "4", "5", "12"]);
    const edit = page.getByRole("button", { name: "Edit transaction", exact: true });
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "Edit transaction", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.matches(":modal"))).toBe(true);
    expect(await dialog.evaluate(el => getComputedStyle(el, "::backdrop").backgroundColor)).toBe("rgba(0, 0, 0, 0.76)");
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x + bounds.width / 2).toBeCloseTo(width / 2, 0);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(540, 0);
    await expect(dialog.getByLabel("Amount", { exact: true })).toBeFocused();
    await page.screenshot({ path: `test-results/edit-modal-${width}.png`, fullPage: true });
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.click();
    await dialog.getByLabel("Description", { exact: true }).fill("Corrected in modal");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Corrected in modal", exact: true })).toBeVisible();
  });
}
