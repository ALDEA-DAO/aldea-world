import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { registerFork } from "./atlas";

/**
 * Accessibility with axe (WCAG 2.1 A and AA rules): no serious or critical violations on the village, List mode,
 * the Soul Registry, a soul's public view and the Portal of Worlds. The canvas itself is one labelled, focusable
 * application; everything it offers is also in List mode. Needs the local stack (`pnpm dev`).
 */

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function expectNoSeriousViolations(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${name}\n${report}`).toEqual([]);
}

test("the village, List mode and the Soul Registry, as a guest", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByTestId("village")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expectNoSeriousViolations(page, "#/");

  await page.goto("/#/lista");
  await expect(page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ })).toBeVisible();
  await expectNoSeriousViolations(page, "#/lista");

  await page.goto("/#/b/registro-de-almas");
  await expect(page.getByRole("region", { name: /Registro de Almas|Soul Registry/ })).toBeVisible();
  await expectNoSeriousViolations(page, "#/b/registro-de-almas (guest)");
});

test("your own Soul Registry and a soul's public view", async ({ browser, context, page }) => {
  await passkeyDevice(context, page);
  await page.goto("/#/b/registro-de-almas");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page.getByTestId("soul-registry")).toBeVisible();
  await expectNoSeriousViolations(page, "#/b/registro-de-almas (soul)");

  const almaId = (await page.getByTitle(/^alma:main:human:/).first().getAttribute("title"))!;
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/#/alma/${encodeURIComponent(almaId)}`);
  await expect(visitor.getByTestId("soul-registry")).toBeVisible();
  await expectNoSeriousViolations(visitor, "#/alma/:almaId");
});

test("the Portal of Worlds, a world's detail and the warning before traveling", async ({ page }) => {
  const fork = await registerFork();
  await page.goto("/#/portal");
  await page.getByRole("tab", { name: /^(Todos|All)$/ }).click();
  const nocturna = page.getByRole("article", { name: fork.name });
  await expect(nocturna.getByRole("button", { name: /^(Viajar|Travel)$/ })).toBeVisible({ timeout: 30_000 });
  await expectNoSeriousViolations(page, "#/portal");

  await nocturna.getByRole("button", { name: /^(Viajar|Travel)$/ }).click();
  await expect(page.getByRole("dialog", { name: /Mundo sin verificar|Unverified world/ })).toBeVisible();
  await expectNoSeriousViolations(page, "#/portal (travel warning)");

  await page.goto(`/#/portal/${fork.worldId}`);
  await expect(page.getByRole("row", { name: /0\.1\.0/ })).toBeVisible();
  await expectNoSeriousViolations(page, "#/portal/:worldId");
});
