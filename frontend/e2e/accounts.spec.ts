import { expect, test, type Page } from "@playwright/test";
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function createAccount(page: Page, name: string, balance = "0.00") {
  await nav(page, "Accounts");
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel("Account type", { exact: true }).selectOption("CASH");
  await page.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await page.getByLabel("Opening balance").fill(balance);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Account created" }),
  ).toBeVisible();
}
async function createCategory(page: Page, name: string, kind: string) {
  await nav(page, "Categories");
  await page.getByLabel("Category name").fill(name);
  await page.getByLabel("Kind", { exact: true }).selectOption(kind);
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
async function choose(page: Page, label: string, prefix: string) {
  const select = page.getByLabel(label, { exact: true });
  const option = await select
    .locator("option")
    .filter({ hasText: prefix })
    .getAttribute("value");
  await select.selectOption(option!);
  return option!;
}
test("complete local wallet journey: exact money, transfers, budgets, recurrence, CSV and PIN isolation", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.GENTUM_VERIFICATION_FIXTURE !== "1",
    "Requires a disposable verification stack",
  );
  await page.goto("/");
  const accessStatus = await page.request
    .get("/auth/status")
    .then((response) => response.json());
  if (accessStatus.existingProfilesAvailable) {
    await expect(page.getByLabel("Create a new wallet")).toBeChecked();
    await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Existing password")).toHaveCount(0);
  }
  await page.getByLabel("Protect with a PIN").check();
  await page.getByLabel("PIN (4 digits)", { exact: true }).fill("0123");
  await page.getByLabel("Confirm PIN").fill("0123");
  await page
    .getByRole("button", { name: "Open local wallet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Save your recovery code" }),
  ).toBeVisible();
  let recovery = await page.locator(".recovery-code").innerText();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Continue to wallet" }),
  ).toBeDisabled();
  await expect(page.locator(".recovery-code")).toHaveText(recovery);
  await page.getByLabel("I have saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await createAccount(page, "Daily wallet", "100.00");
  await createAccount(page, "Rainy day");
  await createCategory(page, "Food", "EXPENSE");
  await createCategory(page, "Salary", "INCOME");
  await nav(page, "Transactions");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  const accountId = await choose(page, "Account", "Daily wallet");
  const categoryId = await choose(page, "Category (must match kind)", "Food");
  await page.getByLabel("Amount (decimal, account currency)").fill("0.29");
  await page.getByLabel("Description", { exact: true }).fill("Coffee");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("cell", { name: "Coffee", exact: true }),
  ).toBeVisible();
  await nav(page, "Transfers");
  await choose(page, "From account", "Daily wallet");
  await choose(page, "To account (same currency)", "Rainy day");
  await page.getByLabel("Amount", { exact: true }).fill("10.00");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await nav(page, "Accounts");
  await expect(page.getByText("€89.71", { exact: true })).toBeVisible();
  await expect(page.getByText("€10.00", { exact: true })).toBeVisible();
  await nav(page, "Budgets");
  await choose(page, "Expense category", "Food");
  await page.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await page.getByLabel("Monthly limit").fill("1.00");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("29% used")).toBeVisible();
  await nav(page, "Recurring");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  await choose(page, "Account", "Daily wallet");
  await choose(page, "Category (must match kind)", "Food");
  await page.getByLabel("Amount (decimal, account currency)").fill("0.01");
  await page.getByLabel("Description", { exact: true }).fill("Monthly coffee");
  await page.getByRole("button", { name: "Create recurring schedule" }).click();
  await expect(page.getByText("Monthly coffee", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run due transactions" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Created 1 due transactions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run due transactions" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Created 0 due transactions" }),
  ).toBeVisible();
  await nav(page, "Import & export");
  const date = new Date().toISOString().slice(0, 10);
  const header = "date,account_id,category_id,kind,amount_cents,description\n";
  await page
    .getByLabel("CSV content")
    .fill(
      header +
        `${date},${accountId},${categoryId},EXPENSE,1,=formula\n${date},${accountId},${categoryId},EXPENSE,0,invalid\n`,
    );
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByLabel("CSV content")
    .fill(header + `${date},${accountId},${categoryId},EXPENSE,1,=formula\n`);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Imported 1 transactions" }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream!) exported += chunk.toString();
  expect(exported).toContain("'=formula");
  expect(exported).not.toContain("invalid");
  await nav(page, "Budgets");
  await expect(page.getByText("31% used")).toBeVisible();
  const other = await browser.newContext();
  const isolated = await other.newPage();
  await isolated.goto(new URL("/", page.url()).toString());
  await expect(
    isolated.getByRole("button", { name: "Unlock", exact: true }),
  ).toBeVisible();
  await other.close();
  await page.getByRole("button", { name: "Lock now" }).click();
  await expect(
    page.getByRole("button", { name: "Unlock", exact: true }),
  ).toBeVisible();
  await page.getByLabel("PIN (4 digits)").fill("9999");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid PIN");
  await page.getByLabel("PIN (4 digits)").fill("0123");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("€89.69", { exact: true })).toBeVisible();
  await nav(page, "Settings");
  await page.getByLabel("Current PIN").fill("0123");
  await page.getByLabel("New PIN").fill("2345");
  await page.getByLabel("Confirm PIN").fill("2345");
  await page.getByRole("button", { name: "Change PIN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save your recovery code" }),
  ).toBeVisible();
  recovery = await page.locator(".recovery-code").innerText();
  await page.getByLabel("I have saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.getByRole("button", { name: "Forgot your PIN?" }).click();
  await page.getByLabel("Recovery code", { exact: true }).fill(recovery);
  await page.getByLabel("New PIN").fill("5678");
  await page.getByLabel("Confirm PIN").fill("5678");
  await page.getByRole("button", { name: "Reset PIN", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save your recovery code" }),
  ).toBeVisible();
  expect(await page.locator(".recovery-code").innerText()).not.toEqual(
    recovery,
  );
  await page.getByLabel("I have saved my recovery code").check();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  await nav(page, "Settings");
  await page.getByRole("button", { name: "Use without a PIN" }).click();
  await page.getByLabel("Current PIN").fill("5678");
  await page.getByRole("button", { name: "Disable PIN", exact: true }).click();
  await expect(
    page.getByText("This computer opens your wallet without a PIN."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  const direct = await browser.newContext();
  const directPage = await direct.newPage();
  await directPage.goto(new URL("/", page.url()).toString());
  await expect(
    directPage.getByText("Daily wallet", { exact: true }),
  ).toBeVisible();
  await direct.close();
});
