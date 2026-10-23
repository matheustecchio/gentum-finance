import { expect, test } from "@playwright/test";
for (const width of [1280, 390, 320]) {
  test(`Calendar Analytics workflow at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.skip(
      process.env.GENTUM_VERIFICATION_FIXTURE !== "1",
      "Requires a disposable full stack",
    );
    await page.setViewportSize({ width, height: 900 });
    const origin = baseURL!;
    let status = await page.request.get("/auth/status").then((r) => r.json());
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post(path, {
        data,
        headers: {
          Origin: origin,
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
    const name = `Overview fixture ${width} ${Date.now()}`;
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
        'mutation{createAccount(input:{name:"Chart fixture",type:CASH,currency:"EUR",initialBalance:"1000000"}){id}}',
      )
    ).data.createAccount.id;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Dublin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const day = (offset: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const summary = (
      await gql(`{financeSummary(month:"${today.slice(0, 7)}")}`)
    ).data.financeSummary;
    const category = (name: string) =>
      summary.categories.find((c: { name: string }) => c.name === name).id;
    for (const [label, color] of [
      ["Rent", "#ecc05b"],
      ["Dining out", "#ad5e84"],
    ])
      await execute("categoryColor", { id: category(label), color });
    for (const [label, amount] of [
      ["Rent", "120000"],
      ["Dining out", "7230"],
    ])
      await execute("transaction", {
        accountId: account,
        categoryId: category(label),
        kind: "EXPENSE",
        amount,
        date: today,
        description: "Fictional current-week expense",
      });
    for (let i = 1; i <= 15; i++)
      await execute("transaction", {
        accountId: account,
        categoryId: category("Groceries"),
        kind: "EXPENSE",
        amount: "1000",
        date: day(-i * 7),
        description: "Fictional previous-week expense",
      });
    await execute("transaction", {
      accountId: account,
      categoryId: category("Groceries"),
      kind: "EXPENSE",
      amount: "100",
      date: "2017-01-01",
      description: "Fictional old history",
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveCount(0);
    await expect(page.locator(".spent-summary > strong")).toHaveCSS("color", "rgb(255, 130, 144)");
    await expect(page.locator(".income-summary > strong")).toHaveCSS("color", "rgb(101, 214, 160)");
    await expect(page.locator(".cash-summary > strong")).toHaveCSS("color", "rgb(134, 180, 255)");
    await expect(page.locator(".summary-flow-bars i").first()).toHaveCSS("background-color", "rgb(101, 214, 160)");
    await expect(page.locator(".summary-flow-bars i").last()).toHaveCSS("background-color", "rgb(255, 130, 144)");
    await expect(page.locator("main")).toHaveCSS("max-width", "none");
    await page.getByRole("button", { name: "Semester", exact: true }).click();
    const firstMonth = Number(today.slice(5, 7)) <= 6 ? 0 : 6;
    const months = Array.from({ length: 6 }, (_, index) => new Intl.DateTimeFormat("en-IE", {
      month: "short", timeZone: "UTC",
    }).format(new Date(Date.UTC(Number(today.slice(0, 4)), firstMonth + index, 1))));
    await expect(page.locator(".income-summary .summary-axis span")).toHaveText(months);
    const labelBounds = await page.locator(".income-summary .summary-axis span").evaluateAll((labels) => labels.map((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const bounds = range.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    }));
    for (let index = 1; index < labelBounds.length; index++) {
      expect(labelBounds[index].left).toBeGreaterThanOrEqual(labelBounds[index - 1].right);
    }
    await expect(page.locator(".spent-summary .summary-axis span")).toHaveText(months);
    await expect(page.locator(".wealth-summary .summary-axis")).not.toBeEmpty();
    await expect(page.locator(".profile .active-database")).toContainText("Local database:");
    await expect(page.locator(".page-header .active-database")).toHaveCount(0);
    const wealthBox = (await page.locator(".wealth-summary").boundingBox())!;
    const controlsBox = (await page.locator(".cash-period-controls").boundingBox())!;
    expect(wealthBox.y - controlsBox.y - controlsBox.height).toBeGreaterThanOrEqual(28);
    await page.getByRole("button", { name: /Net cash flow · EUR/ }).click();
    await expect(page.locator(".cash-net")).toHaveCSS("color", "rgb(134, 180, 255)");
    const cash = page.locator(".cash-chart");
    await cash.getByRole("button", { name: "Week", exact: true }).click();
    await expect(cash.locator(".calendar-slot")).toHaveCount(7);
    await expect(cash.locator(".calendar-label").first()).toHaveText(
      width === 1280 ? "Monday" : "Mon",
    );
    await expect(cash.locator(".calendar-label").last()).toHaveText(
      width === 1280 ? "Sunday" : "Sun",
    );
    await expect(
      page.getByRole("button", { name: "Open Rent transactions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open Rent transactions" }).click();
    await expect(
      page.getByRole("heading", { name: "Transactions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fictional current-week expense"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear category" }).click();
    await expect(
      page.getByRole("heading", { name: "Transactions", exact: true }),
    ).toHaveCount(0);
    await cash.getByRole("button", { name: "Year", exact: true }).click();
    await expect(cash.locator(".calendar-slot")).toHaveCount(12);
    const year = Number(today.slice(0, 4));
    await expect(cash.locator(".cash-page-navigation")).toContainText(
      String(year),
    );
    const nav = page.getByRole("group", {
      name: "Cash flow period navigation",
    });
    await nav.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(cash.locator(".cash-page-navigation")).toContainText(
      String(year - 1),
    );
    await cash
      .getByRole("button", { name: "Next period", exact: true })
      .click();
    await expect(cash.locator(".cash-page-navigation")).toContainText(
      String(year),
    );
    const box = (await nav.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4 + 100, box.y + 90, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(cash.locator(".cash-page-navigation")).toContainText(
      String(year - 1),
    );
    if (width === 390) {
      await cash
        .getByRole("button", { name: "Next period", exact: true })
        .click();
      await expect(cash.locator(".cash-page-navigation")).toContainText(
        String(year),
      );
      const touchBox = (await nav.boundingBox())!;
      const x = touchBox.x + touchBox.width * 0.3,
        y = touchBox.y + 70;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + i * 12, y }],
        });
        await page.waitForTimeout(20);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(cash.locator(".cash-page-navigation")).toContainText(
        String(year - 1),
      );
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
    }
    await cash.getByRole("button", { name: "More cash flow periods" }).click();
    await page.getByLabel("Week starts on").selectOption("0");
    await page.getByRole("button", { name: "Quarter", exact: true }).click();
    await expect(cash.locator(".calendar-slot")).toHaveCount(3);
    await cash.getByRole("button", { name: "More cash flow periods" }).click();
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Custom date range" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveCSS(
      "color",
      "rgb(240, 240, 240)",
    );
    await page.keyboard.press("Escape");
    await expect(
      cash.getByRole("button", { name: "More cash flow periods" }),
    ).toBeFocused();
    await cash.getByRole("button", { name: "More cash flow periods" }).click();
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.getByLabel("Start date", { exact: true }).fill("2017-01-01");
    await page.getByLabel("End date", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      cash.getByRole("button", { name: "More cash flow periods" }),
    ).toBeFocused();
    await expect(cash.locator(".cash-period-range")).toContainText("2017");
    await page.getByRole("button", { name: "Spent", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Cumulative expense in EUR" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "pie chart", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "Categories in EUR" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to Analytics" }).click();
    await page.getByRole("button", { name: /Total Wealth/ }).click();
    const wealth = page.getByRole("region", {
      name: "Total Wealth",
      exact: true,
    });
    await wealth.getByRole("button", { name: "Year", exact: true }).click();
    await expect(
      page.getByRole("group", { name: "Wealth period navigation" }),
    ).toBeVisible();
    await expect(wealth.getByRole("slider")).toBeVisible();
    await wealth
      .getByRole("button", { name: "Previous wealth period" })
      .click();
    await expect(wealth.locator(".cash-page-navigation")).toContainText(
      String(year - 1),
    );
    await wealth.getByRole("button", { name: "More wealth periods" }).click();
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveCSS(
      "color",
      "rgb(240, 240, 240)",
    );
    await page.keyboard.press("Escape");
    await expect(
      wealth.getByRole("button", { name: "More wealth periods" }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/gentum-calendar-wealth-${width}.png`,
      fullPage: true,
    });
  });
}
