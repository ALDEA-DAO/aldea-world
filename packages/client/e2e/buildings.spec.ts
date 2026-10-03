import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Buildings under construction: what they will be, from the catalog, and "Anotarme". Guests are asked to sign in;
 * a soul signs up once per building, and signing up again (from a tab that did not know) says it already is.
 * Needs the local stack (`pnpm dev`).
 */

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const panel = (page: Page, name: RegExp) => page.getByRole("region", { name });

test("guests see what the Forge will be and are asked to sign in to sign up", async ({ page }) => {
  await page.goto("/#/b/forja");
  const forge = panel(page, /Forja de NPCs|NPC Forge/);
  await expect(forge.getByText(/En construcción|Under construction/)).toBeVisible();
  await expect(forge.getByText(/Crear NPCs con alma de agente|Create NPCs with an agent soul/)).toBeVisible();
  await expect(forge.getByText(/Fase 6|Phase 6/)).toBeVisible();
  await expect(forge.getByRole("button", { name: /Inicia sesión para anotarte|Sign in to sign up/ })).toBeVisible();
  await expect(forge.getByRole("button", { name: /^(Anotarme|Sign me up)$/ })).toHaveCount(0);
  await page.screenshot({ path: "test-results/forge-panel.png" });
});

test("a soul signs up once; signing up again says it already is", async ({ context, page }) => {
  await passkeyDevice(context, page);
  await page.goto("/#/b/archivo-velum");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page).toHaveURL(/#\/b\/archivo-velum$/);

  // A second tab opens the Archive before the sign-up, so it still offers "Anotarme"
  const other = await context.newPage();
  await other.goto("/#/b/archivo-velum");
  const otherSignUp = panel(other, /Archivo Velum|Velum Archive/).getByRole("button", { name: /^(Anotarme|Sign me up)$/ });
  await expect(otherSignUp).toBeVisible();

  const archive = panel(page, /Archivo Velum|Velum Archive/);
  await archive.getByRole("button", { name: /^(Anotarme|Sign me up)$/ }).click();
  await expect(archive.getByText(/Ya estás anotada|You're already signed up/)).toBeVisible();
  await page.reload();
  await expect(panel(page, /Archivo Velum|Velum Archive/).getByText(/Ya estás anotada|You're already signed up/)).toBeVisible();

  // The second sign-up gets a 409 from the Resolver and shows the same state, not an error
  await otherSignUp.click();
  await expect(panel(other, /Archivo Velum|Velum Archive/).getByText(/Ya estás anotada|You're already signed up/)).toBeVisible();
  await expect(other.getByRole("alert")).toHaveCount(0);

  // Each building has its own list
  await page.goto("/#/b/forja");
  const forgeSignUp = panel(page, /Forja de NPCs|NPC Forge/).getByRole("button", { name: /^(Anotarme|Sign me up)$/ });
  await expect(forgeSignUp).toBeVisible();

  // When the Resolver fails, a toast says so and "Anotarme" stays
  await page.route("**/v1/waitlist", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 503, json: { code: "unavailable", title: "Unavailable" } }) : route.fallback()));
  await forgeSignUp.click();
  await expect(page.getByRole("alert").filter({ hasText: /No pudimos anotarte|We couldn't sign you up/ })).toBeVisible();
  await expect(forgeSignUp).toBeEnabled();
});

test("the Portal lists ALDEA World with its last 24 h, and says so when Effectstream is down", async ({ page }) => {
  // Effectstream down first: the card stays, the activity line offers to retry
  await page.route("**/api/v1/activity/buildings**", (route) => route.fulfill({ status: 503, body: "down" }));
  await page.goto("/#/b/portal");
  const portal = panel(page, /Portal de los Mundos|Portal of Worlds/);
  const aldea = portal.getByRole("article", { name: "ALDEA World" });
  await expect(aldea.getByText(/Verificado|Verified/)).toBeVisible();
  await expect(aldea.getByText(/El Portal está nublado|The Portal is clouded over/)).toBeVisible();
  await expect(portal.getByText(/único mundo del Atlas|only world in the Atlas/)).toBeVisible();

  await page.unroute("**/api/v1/activity/buildings**");
  await aldea.getByRole("button", { name: /Reintentar|Retry/ }).click();
  await expect(aldea.getByTestId("world-activity")).toHaveText(/(Últimas 24 h|Last 24 h): \d+ (nacimientos|births) · \d+ (visitas|visits)/);

  // The full page shows the same world
  await page.goto("/#/portal");
  await expect(page.getByRole("heading", { level: 1, name: /Portal de los Mundos|Portal of Worlds/ })).toBeVisible();
  await expect(page.getByRole("article", { name: "ALDEA World" })).toBeVisible();
});

test("the Council says when it opens", async ({ page }) => {
  await page.goto("/#/b/consejo");
  const council = panel(page, /^(Consejo|Council)$/);
  await expect(council.getByRole("heading", { name: /El Acta de Génesis|The Genesis Charter/ })).toBeVisible();
  await expect(council.getByRole("status")).toHaveText(/El Consejo abrirá con el Acta de Génesis|The Council will open with the Genesis Charter/);
});
