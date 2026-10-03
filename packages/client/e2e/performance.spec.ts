import { expect, test } from "@playwright/test";

/**
 * Lite mode: when the device cannot keep 20 fps for more than a second, the village drops its particles and ambient
 * animations and says so. Simulated with the CPU throttled 6× (headless Chromium draws with a software renderer, so
 * its normal frame rate is already modest).
 */
test("a slow device switches the village to lite mode", async ({ page }) => {
  await page.goto("/#/");
  const village = page.getByTestId("village");
  await expect(village).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  // At its normal pace the village stays as it is
  await page.waitForTimeout(4_000);
  await expect(village).toHaveAttribute("data-lite", "false");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await expect(village).toHaveAttribute("data-lite", "true", { timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: /^(Modo liviano|Lite mode)$/ })).toBeVisible();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});
