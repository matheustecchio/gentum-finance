import { expect, test, type Page } from "@playwright/test";
async function settings(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "Settings", exact: true }).click();
}
test("separate databases, protected switching, rename, tabs and reload", async ({ page, context, browser }) => {
  test.skip(process.env.GENTUM_VERIFICATION_FIXTURE !== "1", "Requires a disposable verification stack");
  await page.goto("/");
  const status = await page.request.get("/auth/status").then(r => r.json());
  if (status.setupRequired) await page.getByRole("button", { name: "Open local wallet", exact: true }).click();
  else if (!status.unlocked && status.pinEnabled) {
    await page.getByLabel("PIN (4 digits)", { exact: true }).fill("0123");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const initial = await page.request.get("/auth/status").then(r => r.json());
  const suffix = Date.now();
  const name = `Travel ${suffix}`;
  await settings(page);
  await page.getByRole("button", { name: "New database", exact: true }).click();
  await page.getByLabel("Database name", { exact: true }).fill(name);
  await page.getByLabel("Protect this database with a PIN").check();
  await page.getByLabel("New database PIN", { exact: true }).fill("0123");
  await page.getByLabel("Confirm database PIN", { exact: true }).fill("0123");
  await page.getByRole("button", { name: "Create database", exact: true }).click();
  await expect(page.locator(".recovery-code")).toBeVisible();
  const recovery = await page.locator(".recovery-code").innerText();
  expect((await page.request.get("/auth/status").then(r => r.json())).databaseId).toBe(initial.databaseId);
  await expect(page.getByRole("button", { name: "Continue to wallet" })).toBeDisabled();
  await page.getByLabel("I have saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await expect(secondTab.locator(".active-database")).toContainText(initial.databaseName);
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await page.getByLabel("Database PIN", { exact: true }).fill("9999");
  await page.getByRole("button", { name: "Unlock database", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid");
  await expect(page.locator(".active-database")).toContainText(initial.databaseName);
  await page.getByLabel("Database PIN", { exact: true }).fill("0123");
  await page.getByRole("button", { name: "Unlock database", exact: true }).click();
  await expect(page.locator(".active-database")).toContainText(name);
  await expect(secondTab.locator(".active-database")).toContainText(name);
  await settings(page);
  await expect(page.locator(".category-list li")).toHaveCount(32);
  await expect(page.getByText("Miscellaneous", { exact: true })).toBeVisible();
  await expect(page.getByText("Wages", { exact: true })).toBeVisible();
  await expect(page.getByText("Income / Wages", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Vacations", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add categories", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Rename ${name}`, exact: true }).click();
  const renamed = `Holiday ${suffix}`;
  await page.getByLabel("Database name", { exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Save database name", exact: true }).click();
  await expect(page.locator(".active-database")).toContainText(renamed);
  await page.reload();
  await expect(page.locator(".active-database")).toContainText(renamed);
  await settings(page);
  await page.getByRole("button", { name: `Open ${initial.databaseName}`, exact: true }).click();
  if (initial.pinEnabled) {
    await page.getByLabel("Database PIN", { exact: true }).fill("0123");
    await page.getByRole("button", { name: "Unlock database", exact: true }).click();
  }
  await expect(page.locator(".active-database")).toContainText(initial.databaseName);
  await settings(page);
  await page.getByRole("button", { name: `Open ${renamed}`, exact: true }).click();
  await page.getByRole("button", { name: "Forgot this database PIN?", exact: true }).click();
  await page.getByLabel("Database recovery code", { exact: true }).fill(recovery);
  await page.getByLabel("Replacement database PIN", { exact: true }).fill("5678");
  await page.getByLabel("Confirm replacement PIN", { exact: true }).fill("5678");
  await page.getByRole("button", { name: "Reset PIN and open database", exact: true }).click();
  await expect(page.locator(".recovery-code")).toBeVisible();
  expect(await page.locator(".recovery-code").innerText()).not.toBe(recovery);
  await page.getByLabel("I have saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  await expect(page.locator(".active-database")).toContainText(renamed);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/");
  expect((await otherPage.request.get("/auth/status").then(r => r.json())).databaseId).toBe(initial.databaseId);
  await other.close();
  await settings(page);
  await page.getByRole("button", { name: `Open ${initial.databaseName}`, exact: true }).click();
  if (initial.pinEnabled) {
    await page.getByLabel("Database PIN", { exact: true }).fill("0123");
    await page.getByRole("button", { name: "Unlock database", exact: true }).click();
  }
  await expect(page.locator(".active-database")).toContainText(initial.databaseName);
  await secondTab.close();
});
