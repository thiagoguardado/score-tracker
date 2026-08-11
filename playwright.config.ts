import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    // Use a mobile viewport without isMobile/touch emulation. This keeps the
    // responsive layout coverage deterministic on Linux CI and Windows.
    { name: "mobile-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 412, height: 915 } } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
