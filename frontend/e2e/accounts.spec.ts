import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function createAccount(page: Page, name: string, balance = "0.00") {
  await nav(page, "Settings");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Account name", { exact: true }).fill(name);
  await page.getByLabel("Account type", { exact: true }).selectOption("CASH");
  await page.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await page.getByLabel("Opening balance").fill(balance);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Account created" }),
  ).toBeVisible();
}
async function createCategory(page: Page, name: string, kind: string) {
  await nav(page, "Settings");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page.getByLabel("Category name").fill(name);
  await page.getByLabel("Kind", { exact: true }).selectOption(kind);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create category" })
    .click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
async function choose(page: Page, label: string, prefix: string) {
  const select = page.getByLabel(label, { exact: true });
  const option = await select
    .locator("option")
    .filter({
      hasText: new RegExp(
        "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: ·|$)",
      ),
    })
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
    page.getByRole("heading", { name: "Analytics", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Net cash flow · EUR/ })).toBeVisible();
  await expect(page.getByText("Unable to load analytics", { exact: true })).toHaveCount(0);
  await createAccount(page, "Daily wallet", "100.00");
  await createAccount(page, "Rainy day");
  await createCategory(page, "Food", "EXPENSE");
  await createCategory(page, "Salary", "INCOME");
  await nav(page, "Settings");
  await expect(page.getByRole("button", { name: "Add categories", exact: true })).toHaveCount(0);
  await expect(page.getByText("Vacations", { exact: true })).toBeVisible();
  await expect(page.getByText("Miscellaneous", { exact: true })).toBeVisible();
  await expect(page.getByText("Vacations / Food", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Wages", { exact: true })).toBeVisible();
  await expect(page.getByText("Income / Wages", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page.getByLabel("Category name").fill("Coffee shop");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  await choose(page, "Parent category (optional)", "Food");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create category" })
    .click();
  await expect(
    page.getByText("Food / Coffee shop", { exact: true }),
  ).toBeVisible();
  await nav(page, "Add transaction");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  const accountId = await choose(page, "Account", "Daily wallet");
  const categoryId = await choose(
    page,
    "Category (must match kind)",
    "Food / Coffee shop",
  );
  await page.getByLabel("Amount (decimal, account currency)").fill("0.29");
  await page.getByLabel("Description", { exact: true }).fill("Coffee");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await nav(page, "Transactions");
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
  await nav(page, "Settings");
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
  await expect(page.getByRole("heading", { name: "Needs confirmation (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Needs confirmation (0)" })).toBeVisible();
  await page.reload();
  await nav(page, "Recurring");
  await expect(page.getByRole("heading", { name: "Needs confirmation (0)" })).toBeVisible();
  await nav(page, "Import & export");
  const date = new Date().toISOString().slice(0, 10);
  const header = "date,kind,category_id,amount_cents,description\n";
  await page.getByLabel("Import into account").selectOption(accountId);
  await expect(page.getByRole("heading", { name: "Account IDs" })).toHaveCount(
    0,
  );
  await page
    .getByLabel("CSV content")
    .fill(
      header +
        `${date},EXPENSE,${categoryId},1,=formula\n${date},EXPENSE,${categoryId},0,invalid\n`,
    );
  await page.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("CSV record 3");
  await expect(page.getByRole("button", { name: "Import CSV", exact: true })).toBeDisabled();
  await page
    .getByLabel("CSV content")
    .fill(header + `${date},EXPENSE,${categoryId},1,=formula\n`);
  await page.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await expect(page.getByRole("region", { name: "CSV preview" })).toContainText("=formula");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("status").filter({ hasText: "Imported 1 transactions" }),
  ).toBeVisible();
  await page.getByRole("dialog", { name: "Import complete" }).getByRole("button", { name: "Close", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("gentum-transactions.zip");
  const exported = execFileSync("unzip", ["-p", (await download.path())!], {
    encoding: "utf8",
  });
  expect(exported).toContain("date,kind,category_id,amount_cents,description");
  expect(exported).not.toContain(accountId);
  expect(exported).toContain("'=formula");
  expect(exported).not.toContain("invalid");
  await nav(page, "Budgets");
  await expect(page.getByText("31% used")).toBeVisible();
  // Rename linked categories through the same dialog used by Settings.
  await nav(page, "Settings");
  const childRename = page.getByRole("button", { name: "Edit Food / Coffee shop", exact: true });
  await childRename.click();
  const renameDialog = page.getByRole("dialog", { name: "Edit category", exact: true });
  await expect(renameDialog.getByLabel("Category name")).toHaveValue("Coffee shop");
  await expect(renameDialog.getByLabel("Category name")).toBeFocused();
  await renameDialog.getByLabel("Category name").fill("Morning coffee");
  await renameDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(childRename).toBeFocused();
  await childRename.click();
  await renameDialog.getByLabel("Category name").fill("Morning coffee");
  await renameDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(renameDialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Food / Morning coffee", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Edit Food", exact: true }).click();
  await renameDialog.getByLabel("Category name").fill("Meals");
  await renameDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Meals / Morning coffee", { exact: true })).toBeVisible();
  await page.reload();
  await nav(page, "Transactions");
  const coffeeHistory = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Coffee", exact: true }) });
  await expect(coffeeHistory).toContainText("Meals / Morning coffee");
  await expect(coffeeHistory).toContainText("€0.29");
  await nav(page, "Budgets");
  await expect(page.getByRole("heading", { name: "Meals", exact: true })).toBeVisible();
  await expect(page.getByText("31% used")).toBeVisible();
  await nav(page, "Recurring");
  await expect(page.locator(".item-list li").filter({ hasText: "Monthly coffee" }).first()).toContainText("Daily wallet · Meals · Expense");
  await nav(page, "Add transaction");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  const renamedCategoryId = await choose(page, "Category (must match kind)", "Meals / Morning coffee");
  expect(renamedCategoryId).toBe(categoryId);
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
  await nav(page, "Settings");
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
  await nav(page, "Settings");
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  await nav(page, "Settings");
  await page.getByRole("button", { name: "Use without a PIN" }).click();
  await page.getByLabel("Current PIN").fill("5678");
  await page.getByRole("button", { name: "Disable PIN", exact: true }).click();
  await expect(
    page.getByText("This computer opens your wallet without a PIN."),
  ).toBeVisible();
  await page.reload();
  await nav(page, "Settings");
  await expect(page.getByText("Daily wallet", { exact: true })).toBeVisible();
  const direct = await browser.newContext();
  const directPage = await direct.newPage();
  await directPage.goto(new URL("/", page.url()).toString());
  await nav(directPage, "Settings");
  await expect(
    directPage.getByText("Daily wallet", { exact: true }),
  ).toBeVisible();
  await direct.close();
});

test("bounded history, separate recording and category deletion work with keyboard and narrow navigation", async ({
  page,
}) => {
  test.skip(
    process.env.GENTUM_VERIFICATION_FIXTURE !== "1",
    "Requires a disposable verification stack",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true, level: 1 }),
  ).toBeVisible();
  await createAccount(page, "History wallet");
  await createCategory(page, "History root", "EXPENSE");
  const api = async (query: string, variables: unknown = {}) =>
    page.evaluate(
      async ({ query, variables }) => {
        const status = await fetch("/auth/status").then(response => response.json());
        const response = await fetch("/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gentum-Database": status.databaseId },
          body: JSON.stringify({ query, variables }),
        });
        const result = await response.json();
        if (result.errors) throw new Error(JSON.stringify(result.errors));
        return result.data;
      },
      { query, variables },
    );
  const snapshot = (await api('{financeSummary(month:"2026-10")}'))
    .financeSummary;
  expect(snapshot.entries).toEqual([]);
  const root = snapshot.categories.find(
    (c: Record<string, string>) => c.name === "History root",
  ).id;
  const accountId = snapshot.accounts.find(
    (a: Record<string, string>) => a.name === "History wallet",
  ).id;
  const action = (action: string, input: Record<string, string>) =>
    api(
      "mutation($action:String!,$input:FinanceInput!){executeFinance(action:$action,input:$input)}",
      { action, input },
    );
  await action("category", {
    name: "History child",
    kind: "EXPENSE",
    parentId: root,
  });
  const categories = (await api('{financeSummary(month:"2026-10")}'))
    .financeSummary.categories;
  const child = categories.find(
    (c: Record<string, string>) => c.name === "History child",
  ).id;
  for (let i = 0; i < 23; i++)
    await action("transaction", {
      accountId,
      categoryId: i % 2 ? root : child,
      kind: "EXPENSE",
      amount: "29",
      date: "2020-01-01",
      description: `History fixture ${i}`,
    });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true, level: 1 }),
  ).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const add = page
      .getByRole("navigation")
      .getByRole("button", { name: "Add transaction" });
    await add.focus();
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Record a transaction" }),
    ).toBeVisible();
    await expect(add).toHaveAttribute("aria-current", "page");
    await expect(add.locator(".asset-icon")).toBeVisible();
    await expect(add.locator(".asset-icon")).not.toHaveCSS("mask-image", "none");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const actionBounds = await add.boundingBox();
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(width);
    const inactiveBackground = await page
      .getByRole("button", { name: "Transactions", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect.poll(() => add.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toEqual(inactiveBackground);
    await page.getByRole("button", { name: "Analytics", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Transactions", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Transaction history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save transaction" }),
    ).toHaveCount(0);
    await page.getByLabel("Category", { exact: true }).selectOption(root);
    await expect(page.locator("tbody tr")).toHaveCount(10);
    await expect(
      page.getByRole("cell", { name: "2020-01-01", exact: true }),
    ).toHaveCount(10);
    const first = await page.locator("tbody tr").allTextContents();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByRole("button", {name:"Page 2",exact:true})).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    await expect
      .poll(async () => {
        const second = await page.locator("tbody tr").allTextContents();
        return (
          second.length === 10 && !second.some((row) => first.includes(row))
        );
      })
      .toBe(true);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Next page", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", {name:"Page 1",exact:true}).click();
    await expect(page.getByRole("button", {name:"Page 1",exact:true})).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(10);
    await page.getByLabel("Start date").fill("2021-01-01");
    await expect(
      page.getByText("No transactions match these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByLabel("Subcategory")).toHaveCount(0);
    await page.screenshot({
      path: `test-results/history-${width}.png`,
      fullPage: true,
    });
  }
  await nav(page, "Settings");
  await page
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await page.getByLabel("Category name").fill("Delete fixture");
  await page.getByLabel("Kind", { exact: true }).selectOption("EXPENSE");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create category" })
    .click();
  const del = page.getByRole("button", {
    name: "Delete Delete fixture",
    exact: true,
  });
  await del.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveAccessibleName(
    "Delete Delete fixture?",
  );
  await page.keyboard.press("Escape");
  await expect(del).toBeFocused();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(del).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Delete History root / History child",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Category is used",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
