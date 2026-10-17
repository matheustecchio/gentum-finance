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
  await expect(page.getByRole("status")).toHaveText("Account created");
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
test("complete local ledger journey: exact money, transfers, budgets, recurrence, CSV and logout isolation", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByText("New here? Create a local profile").click();
  const email = `e2e-${Date.now()}@example.test`;
  const password = "fictional-local-password";
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password (12 characters minimum)").fill(password);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
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
  await expect(page.getByRole("status")).toHaveText("Saved");
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
  await expect(page.getByRole("status")).toHaveText(
    "Created 1 due transactions",
  );
  await page.getByRole("button", { name: "Run due transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Created 0 due transactions",
  );
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
  await expect(page.getByRole("status")).toHaveText("Imported 1 transactions");
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
    isolated.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await other.close();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password (12 characters minimum)").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("€89.69", { exact: true })).toBeVisible();
});
