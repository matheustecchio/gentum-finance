import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.GENTUM_E2E_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    ...(process.env.GENTUM_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.GENTUM_CHROME_PATH } }
      : {}),
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
