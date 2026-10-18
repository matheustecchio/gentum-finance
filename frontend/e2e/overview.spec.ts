import { expect, test } from "@playwright/test";
for (const width of [1280, 390])
  for (const empty of [false, true]) {
    test(`Continuous cash flow at ${width}px, empty=${empty}`, async ({
      page,
    }) => {
      await page.clock.install({ time: new Date("2026-10-18T12:00:00Z") });
      await page.setViewportSize({ width, height: 900 });
      const wealth = Array.from({ length: 31 }, (_, i) => {
        const day = new Date("2026-09-18T00:00:00Z");
        day.setUTCDate(day.getUTCDate() + i);
        return {
          date: day.toISOString().slice(0, 10),
          amount: String(1900000 + i * 1800 - (i > 19 ? 40000 : 0)),
        };
      });
      const requested: string[] = [];
      await page.route("**/auth/status", (route) =>
        route.fulfill({
          json: { setupRequired: false, unlocked: true, pinEnabled: false },
        }),
      );
      await page.route("**/graphql", (route) => {
        const body = route.request().postDataJSON();
        const month = body.variables.month;
        if (body.query.includes("overview(")) {
          requested.push(month);
          return route.fulfill({
            json: {
              data: {
                overview: {
                  currency: "EUR",
                  today: "2026-10-18",
                  wealth,
                  change30: "14000",
                  converted: true,
                  rateDate: "2026-10-16",
                  rateError: "",
                  flows: [
                    {
                      month,
                      currency: "EUR",
                      income: empty ? "0" : "300000",
                      expense: empty ? "0" : "340000",
                      net: empty ? "0" : "-40000",
                    },
                  ],
                },
              },
            },
          });
        }
        return route.fulfill({
          json: {
            data: {
              financeSummary: {
                accounts: [{ id: "a", currency: "EUR" }],
                categories: [
                  { id: "food", name: "Food and groceries", kind: "EXPENSE" },
                  { id: "travel", name: "Travel", kind: "EXPENSE" },
                ],
                breakdown: [
                  {
                    categoryId: "food",
                    currency: "EUR",
                    direct: "23450",
                    total: "23450",
                  },
                  {
                    categoryId: "travel",
                    currency: "EUR",
                    direct: "7800",
                    total: "7800",
                  },
                ],
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
      await page.getByLabel("Reporting month").fill("2026-10");
      await expect(
        page.getByRole("heading", { name: "Total Wealth" }),
      ).toBeVisible();
      await expect(page.getByText("+€140.00", { exact: false })).toBeVisible();
      const nav = page.getByRole("group", {
        name: "Cash flow month navigation",
      });
      await expect
        .poll(() => nav.evaluate((e) => e.scrollWidth > e.clientWidth))
        .toBe(true);
      await expect(
        page.getByRole("button", { name: "Earlier months" }),
      ).toHaveCount(0);
      if (!empty) {
        await page
          .getByRole("button", { name: "2026-10 Net: -€400.00" })
          .click();
        await expect(page.getByRole("tooltip")).toHaveText("-€400.00");
      }
      await nav.scrollIntoViewIfNeeded();
      const box = await nav.boundingBox();
      if (!box) throw new Error("Missing scroll viewport");
      const before = await nav.evaluate((e) => e.scrollLeft);
      if (width === 390) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: true,
          maxTouchPoints: 1,
        });
        const x = box.x + 70,
          y = box.y + 90;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        for (let distance = 10; distance <= 100; distance += 10) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: x + distance, y }],
          });
          await page.waitForTimeout(20);
        }
        expect(await nav.evaluate((e) => e.scrollLeft)).toBeLessThan(
          before - 30,
        );
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(box.x + 200, box.y + 90);
        await page.mouse.down();
        await page.mouse.move(box.x + 300, box.y + 90, { steps: 8 });
        expect(await nav.evaluate((e) => e.scrollLeft)).toBeLessThan(
          before - 80,
        );
        await page.mouse.up();
      }
      // Force the previously loaded edge into view, then use real keyboard scroll
      // to cross it. Verify prepending keeps a visible date at the same position.
      await nav.evaluate((e) => {
        e.scrollLeft = 150;
      });
      await nav.focus();
      const oldFirst = await nav.locator("svg text").first().textContent();
      const oldWidth = await nav.evaluate((e) => e.scrollWidth);
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(() => nav.evaluate((e) => e.scrollWidth))
        .toBeGreaterThan(oldWidth);
      await expect
        .poll(() => nav.evaluate((e) => e.scrollLeft))
        .toBeGreaterThan(700);
      await expect(
        nav.locator("svg text", { hasText: oldFirst! }),
      ).toBeAttached();
      const loadedMonths = await nav.locator("svg text").count();
      const last = await nav.evaluate((e) => {
        e.scrollLeft = e.scrollWidth - e.clientWidth - 150;
        return e.scrollLeft;
      });
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => nav.locator("svg text").count())
        .toBe(loadedMonths);
      expect(requested.every((m) => m <= "2026-10")).toBe(true);
      expect(await nav.evaluate((e) => e.scrollLeft)).toBeGreaterThanOrEqual(
        last,
      );
      await expect(
        page.getByRole("heading", { name: "Total Wealth" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/overview-${width}.png`,
        fullPage: true,
      });
    });
  }
for (const width of [1280, 390])
  for (const count of [0, 1, 31]) {
    test(`Compact wealth at ${width}px with ${count} observations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const wealth = Array.from({ length: count }, (_, i) => {
        const d = new Date("2026-10-18T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - count + 1 + i);
        return {
          date: d.toISOString().slice(0, 10),
          amount: String(100000 + i * 100),
        };
      });
      await page.route("**/auth/status", (route) =>
        route.fulfill({
          json: { setupRequired: false, unlocked: true, pinEnabled: false },
        }),
      );
      await page.route("**/graphql", (route) =>
        route.fulfill({
          json: {
            data: {
              overview: {
                currency: "EUR",
                today: "2026-10-18",
                wealth,
                flows: [],
                converted: false,
                rateError: "",
                rateDate: "",
                change30: count === 31 ? "3000" : "",
              },
              financeSummary: {
                accounts: [{ id: "a", currency: "EUR" }],
                categories: [],
                entries: [],
                budgets: [],
                recurring: [],
                totals: [],
              },
            },
          },
        }),
      );
      await page.goto("/");
      const card = page.getByRole("region", { name: "Total Wealth" });
      await card.waitFor();
      if (count < 2) {
        await expect(card.locator("svg")).toHaveCount(0);
        await expect(
          card.getByText(
            count ? /One recorded balance/ : "No recorded balances yet.",
          ),
        ).toBeVisible();
      } else {
        await expect(card.locator("svg")).toBeVisible();
        expect(
          (await card.locator("svg").boundingBox())!.height,
        ).toBeLessThanOrEqual(100);
      }
      expect((await card.boundingBox())!.height).toBeLessThan(
        count < 2 ? 280 : 380,
      );
      await page.screenshot({
        path: `/tmp/wealth-fixed-${width}-${count}.png`,
        fullPage: true,
      });
    });
  }
