import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the local stack: the client on :3000 (`pnpm dev:client`) and the ALMA Resolver on :8787
 * with its database (`pnpm dev` or `pnpm dev:lite`). Run with `pnpm --filter client test:e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // The tests share one chain and one World (one pauses it): run them one at a time
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
