import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Sign in with ALMA end to end, with Chromium's virtual passkey: guests browse freely, a passkey creates the soul,
 * a reload keeps the session without a new passkey, and signing out ends it in every tab.
 */

async function withPasskeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const signIn = (page: Page) => page.getByRole("button", { name: /^(Entrar|Sign in)$/ });
const signOut = (page: Page) => page.getByRole("button", { name: /^(Salir|Sign out)$/ });

test("guests browse every read-only screen without being asked to sign in", async ({ page }) => {
  for (const route of ["#/", "#/portal", "#/lista"]) {
    await page.goto(`/${route}`);
    await expect(signIn(page)).toBeVisible();
    expect(new URL(page.url()).port).toBe("3000");
  }
});

test("a passkey creates the soul, survives a reload and signing out ends it in every tab", async ({ context, page }) => {
  await withPasskeyDevice(context, page);
  await page.goto("/#/portal");
  await signIn(page).click();

  // ALMA Auth's page: no passkey yet on this device, so it offers to create the soul with one
  await page.getByRole("button", { name: /Entrar con mi passkey|Sign in with my passkey/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();

  await expect(signOut(page)).toBeVisible();
  await expect(page).toHaveURL(/localhost:3000\/#\/portal$/);
  await expect(page.getByTitle(/^alma:main:human:[0-9a-f]{32}$/).first()).toBeAttached();

  // A reload renews the session from the refresh token: no trip to ALMA Auth
  const visitedAuth: string[] = [];
  page.on("framenavigated", (frame) => frame.url().includes(":8787") && visitedAuth.push(frame.url()));
  await page.reload();
  await expect(signOut(page)).toBeVisible();
  expect(visitedAuth).toEqual([]);

  // Another tab shares the session; signing out in the first ends it in both
  const other = await context.newPage();
  await other.goto("/#/");
  await expect(signOut(other)).toBeVisible();
  await signOut(page).click();
  await expect(signIn(other)).toBeVisible();
  await expect(signIn(page)).toBeVisible();
});
