import { expect, test } from "@playwright/test";

for (const width of [1280, 320]) {
  test(`recurring automation, review, linking and future edits at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.skip(
      process.env.GENTUM_VERIFICATION_FIXTURE !== "1",
      "Requires disposable data",
    );
    await page.setViewportSize({ width, height: 900 });
    let status = await page.request.get("/auth/status").then((r) => r.json());
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(path, {
        data,
        headers: {
          Origin: baseURL!,
          ...(status.databaseId
            ? { "X-Gentum-Database": status.databaseId }
            : {}),
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const result = await response.json();
      expect(result.errors).toBeUndefined();
      return result;
    };
    if (status.setupRequired)
      await post("/auth/setup", { source: "new", mode: "open" });
    else if (!status.unlocked) await post("/auth/open", {});
    status = await page.request.get("/auth/status").then((r) => r.json());
    const name = `Recurring fixture ${width} ${Date.now()}`;
    await post("/databases/create", { name, mode: "open" });
    const registry = await page.request
      .get("/databases", {
        headers: { "X-Gentum-Database": status.databaseId },
      })
      .then((r) => r.json());
    await post("/databases/select", {
      id: registry.databases.find((d: { name: string }) => d.name === name).id,
    });
    status = await page.request.get("/auth/status").then((r) => r.json());
    const gql = (query: string, variables = {}) =>
      post("/graphql", { query, variables });
    const execute = (action: string, input: Record<string, string>) =>
      gql(
        "mutation($action:String!,$input:FinanceInput!){executeFinance(action:$action,input:$input)}",
        { action, input },
      );
    const account = (
      await gql(
        'mutation{createAccount(input:{name:"Recurring wallet",type:CASH,currency:"EUR",initialBalance:"100000"}){id}}',
      )
    ).data.createAccount.id;
    const today = new Date().toISOString().slice(0, 10);
    const summary = async () =>
      (
        await gql("query($month:String!){financeSummary(month:$month)}", {
          month: today.slice(0, 7),
        })
      ).data.financeSummary;
    const category = (await summary()).categories.find(
      (c: { kind: string }) => c.kind === "EXPENSE",
    ).id;
    const common = {
      accountId: account,
      categoryId: category,
      kind: "EXPENSE",
      amount: "1500",
      date: today,
      frequency: "monthly",
    };
    await execute("recurring", {
      ...common,
      description: "Automatic subscription",
      mode: "automatic",
    });
    await execute("recurring", {
      ...common,
      description: "Variable bill",
      mode: "manual",
    });
    await page.goto("/");
    const nav = async (name: string) =>
      page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    await nav("Recurring");
    await expect(
      page.getByRole("heading", { name: "Needs confirmation (1)" }),
    ).toBeVisible();
    expect((await summary()).accounts[0].balance).toBe("98500");
    expect(
      (await summary()).occurrences.filter(
        (o: { status: string }) => o.status === "posted",
      ),
    ).toHaveLength(1);
    // Confirm a variable amount through the modal.
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).fill("18.29");
    await dialog
      .getByRole("button", { name: "Confirm transaction", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs confirmation (0)" }),
    ).toBeVisible();
    expect((await summary()).accounts[0].balance).toBe("96671");
    // CSV preview and the background importer reuse the automatic charge.
    await nav("Import & export");
    await page
      .getByLabel("Choose CSV file")
      .setInputFiles({
        name: "recurring.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `date,kind,category_id,amount_cents,description\n${today},EXPENSE,${category},1500,Automatic subscription\n`,
        ),
      });
    await page
      .getByRole("button", { name: "Preview CSV", exact: true })
      .click();
    await expect(page.getByText("Links to recurring occurrence")).toBeVisible();
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect((await summary()).accounts[0].balance).toBe("96671");
    await nav("Recurring");
    // Edit only future occurrences, then stop/resume the schedule.
    const schedules = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Schedules", exact: true }),
      });
    const row = schedules.locator("li").filter({ hasText: "Variable bill" });
    await row.getByRole("button", { name: "Edit schedule" }).click();
    await page.getByLabel("Frequency", { exact: true }).selectOption("yearly");
    await page
      .getByLabel("When due", { exact: true })
      .selectOption("automatic");
    await page.getByRole("button", { name: "Save future occurrences" }).click();
    await expect(row).toContainText("Yearly · Automatic");
    await row.getByRole("button", { name: "Stop schedule" }).click();
    await expect(row).toContainText("Stopped");
    await row.getByRole("button", { name: "Resume schedule" }).click();
    await expect(row).toContainText("Next");
    await page.reload();
    await nav("Recurring");
    expect((await summary()).accounts[0].balance).toBe("96671");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/gentum-recurring-${width}.png`,
      fullPage: true,
    });
  });
}
