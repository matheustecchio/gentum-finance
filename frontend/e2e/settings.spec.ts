import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`Settings creation dialogs and category layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const accounts: Record<string, string>[] = [];
    const categories = [
      {
        id: "e",
        name: "Long expense",
        path: "Home and household purchases / " + "LongCategory".repeat(9),
        kind: "EXPENSE",
      },
      { id: "i", name: "Income", path: "Employment / Salary", kind: "INCOME" },
    ];
    let reject = true;
    let releaseSave: (() => void) | undefined;
    let blockSave = false;
    await page.route("**/auth/status", (route) =>
      route.fulfill({
        json: { setupRequired: false, unlocked: true, pinEnabled: false },
      }),
    );
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body.query.startsWith("mutation")) {
        if (blockSave)
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
        if (reject)
          return route.fulfill({
            json: { errors: [{ message: "Save rejected" }] },
          });
        if (body.query.includes("createAccount"))
          accounts.push({
            ...body.variables.input,
            id: "new",
            balance: body.variables.input.initialBalance,
          });
        else if (body.variables.action === "renameCategory") {
          const category = categories.find(c => c.id === body.variables.input.id)!;
          category.name = body.variables.input.name;
          category.path = category.name;
        } else categories.push({ ...body.variables.input, id: "new" });
        return route.fulfill({
          json: {
            data: body.query.includes("createAccount")
              ? { createAccount: { id: "new" } }
              : { executeFinance: "Saved" },
          },
        });
      }
      await route.fulfill({
        json: {
          data: {
            flowHistory: { buckets: [{ start: "2026-10-01", end: "2026-10-31", label: "October 2026" }], flows: [], hasEarlier: false },
            categorySpending: { breakdown: [] },
            financeSummary: {
              accounts,
              categories,
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
    await page.getByRole("button", { name: "Open Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Your accounts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your categories" }),
    ).toBeVisible();
    for (const kind of ["account", "category"]) {
      const trigger = page.getByRole("button", {
        name: `Create ${kind}`,
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: `Create ${kind}`,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByLabel(
          kind === "account" ? "Account name" : "Category name",
        ),
      ).toBeFocused();
      const cancel = dialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await cancel.focus();
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await dialog
        .getByLabel(kind === "account" ? "Account name" : "Category name")
        .fill(`New ${kind}`);
      if (kind === "account") {
        await dialog.getByLabel("Account type").selectOption("CASH");
        await dialog.getByLabel("Currency").selectOption("EUR");
      } else await dialog.getByLabel("Kind").selectOption("INCOME");
      reject = true;
      await dialog
        .getByRole("button", { name: `Create ${kind}`, exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toHaveText("Save rejected");
      await expect(
        dialog.getByLabel(
          kind === "account" ? "Account name" : "Category name",
        ),
      ).toHaveValue(`New ${kind}`);
      await page.screenshot({
        path: `test-results/${kind}-modal-${width}.png`,
        fullPage: true,
      });
      reject = false;
      blockSave = true;
      await dialog
        .getByRole("button", { name: `Create ${kind}`, exact: true })
        .click();
      await expect(cancel).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect.poll(() => !!releaseSave).toBe(true);
      releaseSave!();
      releaseSave = undefined;
      blockSave = false;
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(
        page.getByText(`New ${kind}`, { exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Add categories", exact: true })).toHaveCount(0);
    const renameTrigger = page.getByRole("button", { name: "Edit New category", exact: true });
    await renameTrigger.click();
    const renameDialog = page.getByRole("dialog", { name: "Edit category", exact: true });
    const renameInput = renameDialog.getByLabel("Category name");
    await expect(renameInput).toHaveValue("New category");
    await expect(renameInput).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(renameDialog).toHaveCount(0);
    await expect(renameTrigger).toBeFocused();
    await renameTrigger.click();
    await renameInput.fill("Renamed category");
    reject = true;
    await renameDialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(renameDialog.getByRole("alert")).toHaveText("Save rejected");
    await expect(renameInput).toHaveValue("Renamed category");
    await page.screenshot({ path: `test-results/rename-modal-${width}.png`, fullPage: true });
    reject = false;
    await renameDialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(renameDialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit Renamed category", exact: true })).toBeFocused();
    await expect(page.getByText("Renamed category", { exact: true })).toBeVisible();
    for (const row of await page.locator(".category-list li").all()) {
      const name = (await row.locator("strong").boundingBox())!;
      const badge = row.locator(".badge");
      const badgeBox = (await badge.boundingBox())!;
      const rename = (await row.getByRole("button", { name: /^Edit / }).boundingBox())!;
      const del = (await row.getByRole("button", { name: /^Delete / }).boundingBox())!;
      await expect(badge).toHaveText(/^(Expense|Income)$/);
      expect(name.x + name.width).toBeLessThanOrEqual(badgeBox.x);
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(rename.x);
      expect(rename.x + rename.width).toBeLessThanOrEqual(del.x);
      expect(
        await badge.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/settings-${width}.png`,
      fullPage: true,
    });
  });
}
