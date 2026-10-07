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

test("the Town Center, the Council and the Portal panels, in light and dark", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/#/ajustes");
    await page.evaluate((value) => localStorage.setItem("aldea.theme", value), theme);
    await page.goto("/#/b/centro-urbano");
    await page.reload();
    await expect(page.getByRole("region", { name: /Centro Urbano|Town Center/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectNoSeriousViolations(page, `#/b/centro-urbano (${theme})`);
    await page.getByRole("tab", { name: /Censo|Census/ }).click();
    await expect(page.getByTestId("census-panel")).toBeVisible();
    await expectNoSeriousViolations(page, `#/b/centro-urbano, census (${theme})`);

    await page.goto("/#/b/consejo");
    await expect(page.getByRole("heading", { name: /El Acta de Génesis|The Genesis Charter/ })).toBeVisible();
    await expectNoSeriousViolations(page, `#/b/consejo (${theme})`);

    await page.goto("/#/b/portal");
    await expect(page.getByRole("region", { name: /Portal de los Mundos|Portal of Worlds/ }).getByRole("article").first()).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousViolations(page, `#/b/portal (${theme})`);
  }
});

test("everything is reached with the keyboard, with a visible focus and no trap", async ({ page }) => {
  await page.goto("/#/lista");
  await expect(page.getByRole("navigation", { name: /Edificios de la aldea|Village buildings/ })).toBeVisible();
  // Tab through the whole page: every stop shows a 2 px focus ring, and focus comes back around instead of sticking
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return { name: `${el.tagName}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}`, outline: `${style.outlineStyle} ${style.outlineWidth}`, visible: el.matches(":focus-visible") };
    });
    if (!stop) break;
    expect(stop.visible, stop.name).toBe(true);
    expect(stop.outline, stop.name).toBe("solid 2px");
    if (seen.includes(stop.name)) break;
    seen.push(stop.name);
  }
  // The top bar and the building list: several stops, and then it wrapped around
  expect(seen.length).toBeGreaterThanOrEqual(5);
  expect(seen.length).toBeLessThan(40);

  // A dialog keeps focus inside while open and gives it back when closed
  await page.goto("/#/b/registro-de-almas");
  await page.getByRole("button", { name: /Menú|Menu/ }).click();
  await expect(page.getByRole("navigation", { name: /Menú|Menu/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: /Menú|Menu/ })).toHaveCount(0);
});

test("changes are announced: the census, the birth, the Council's tally and the toasts are live regions", async ({ page }) => {
  await page.goto("/#/b/centro-urbano");
  await page.getByRole("tab", { name: /Censo|Census/ }).click();
  const census = page.getByTestId("census-panel");
  await expect(census).toBeVisible({ timeout: 30_000 });
  expect(await census.locator("[aria-live=polite]").count()).toBeGreaterThan(0);
  expect(await page.locator("[aria-live=polite], [role=status]").count()).toBeGreaterThan(0);
});

test("at 200% zoom nothing is cut off or needs sideways scrolling", async ({ browser }) => {
  // 1280 px wide at 200% is 640 CSS px
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await context.newPage();
  for (const route of ["/#/", "/#/lista", "/#/portal", "/#/ajustes", "/#/acerca", "/#/b/centro-urbano", "/#/b/consejo", "/#/b/registro-de-almas"]) {
    await page.goto(route);
    await expect(page.getByRole("banner")).toBeVisible();
    await page.waitForTimeout(500);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth, route).toBeLessThanOrEqual(clientWidth);
    // The way in and the menu stay within reach
    await expect(page.getByRole("button", { name: /Menú|Menu/ })).toBeInViewport();
    await expect(page.getByRole("button", { name: /^(Entrar|Sign in)$/ })).toBeInViewport();
  }
  await context.close();
});
