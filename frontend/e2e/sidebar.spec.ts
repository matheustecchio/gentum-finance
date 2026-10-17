import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 480 },
  { width: 851, height: 400 },
  { width: 850, height: 700 },
  { width: 390, height: 844 },
]) {
  for (const pinEnabled of [false, true]) {
    test(`sidebar placement and keyboard at ${viewport.width}x${viewport.height}, PIN ${pinEnabled}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route("**/auth/status", (route) => route.fulfill({
        json: { setupRequired: false, unlocked: true, pinEnabled },
      }));
      await page.route("**/graphql", (route) => route.fulfill({
        json: { data: { financeSummary: {
          accounts: [], categories: [], entries: [], budgets: [], recurring: [], totals: [],
        } } },
      }));
      await page.goto("/");
      const sidebar = page.locator(".sidebar");
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      const add = page.getByRole("button", { name: "Add transaction", exact: true });
      await expect(add).toHaveCount(1);
      await expect(nav.getByRole("button")).toHaveText([
        "Overview", "Transactions", "Transfers",
        "Budgets", "Recurring", "Import & export", "Settings", "+ Add transaction",
      ]);
      await expect(add).toHaveCSS("background-color", "rgb(228, 193, 111)");
      await sidebar.getByRole("link").focus();
      for (const button of await nav.getByRole("button").all()) {
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      await expect(add).toHaveCSS("outline-style", "solid");
      await expect(add).toHaveCSS("outline-width", "3px");
      await page.keyboard.press("Enter");
      await expect(add).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name: "Record a transaction" })).toBeVisible();
      const addBox = (await add.boundingBox())!;
      await expect(sidebar.locator(".app-version")).toHaveText(`v${version}`);
      await expect(sidebar.locator(".profile small")).toContainText("Local wallet");
      await expect(sidebar.locator(".profile small")).not.toContainText(/No PIN|PIN enabled/);
      await expect(sidebar.locator(".app-version")).toHaveCSS("display", "block");
      await expect(page.getByRole("button", { name: "Lock now" })).toHaveCount(pinEnabled ? 1 : 0);
      const profileBox = (await sidebar.locator(".profile").boundingBox())!;
      const settingsBox = (await nav.getByRole("button", { name: "Settings", exact: true }).boundingBox())!;
      expect(profileBox.y).toBeGreaterThan(addBox.y + addBox.height);
      if (viewport.width === 1440) {
        expect(profileBox.y + profileBox.height).toBeCloseTo(viewport.height - 32, 0);
        expect(profileBox.y - addBox.y - addBox.height).toBeCloseTo(24, 0);
      }
      if (viewport.width > 850) {
        expect(addBox.y - settingsBox.y - settingsBox.height).toBeGreaterThanOrEqual(24);
        await sidebar.locator(".profile").scrollIntoViewIfNeeded();
        const bottom = (await sidebar.locator(".profile").boundingBox())!;
        expect(bottom.y + bottom.height).toBeLessThanOrEqual(viewport.height);
      } else {
        await expect(nav).toHaveCSS("flex-direction", "row");
        await expect(nav).toHaveCSS("flex-wrap", "wrap");
        expect(profileBox.y + profileBox.height).toBeLessThan(viewport.height);
        expect(await page.locator("body").evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      }
      if (pinEnabled) {
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "Lock now" })).toBeFocused();
        await expect(page.getByRole("button", { name: "Lock now" })).toBeInViewport({ ratio: 1 });
      }
      await add.focus();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(add).not.toHaveAttribute("aria-current");
      await add.focus();
      await page.keyboard.press("Space");
      await expect(add).toHaveAttribute("aria-current", "page");
      await page.context().setOffline(true);
      await expect(sidebar.locator(".app-version")).toHaveText(`v${version}`);
    });
  }
}
