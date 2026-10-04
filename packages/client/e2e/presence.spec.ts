import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Self-reported presence: every signed-in tab that is open counts as one "online" at the Resolver; guests do not.
 * (Exact counts and the 90 s after which a tab stops counting are covered by the Resolver's own tests.) Needs the
 * local stack.
 */

const PRESENCE_URL = "http://localhost:8787/v1/presence/aldea";

async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const isHeartbeat = (url: string) => url.endsWith("/v1/presence/heartbeat");

/** Signs in with a new soul and returns the tab id of the heartbeat the Resolver accepted. */
async function signInAndReport(context: BrowserContext, page: Page) {
  await passkeyDevice(context, page);
  await page.goto("/#/b/archivo-velum");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  const heartbeat = page.waitForResponse((res) => isHeartbeat(res.url()) && res.request().method() === "POST");
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  const response = await heartbeat;
  expect(response.status()).toBe(204);
  return (response.request().postDataJSON() as { sessionId: string }).sessionId;
}

test("each signed-in tab reports itself and counts as online; a guest does not", async ({ browser, request }) => {
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  let guestHeartbeats = 0;
  guestPage.on("request", (req) => {
    if (isHeartbeat(req.url())) guestHeartbeats++;
  });
  await guestPage.goto("/");

  const first = await browser.newContext();
  const second = await browser.newContext();
  const tabs = [await signInAndReport(first, await first.newPage()), await signInAndReport(second, await second.newPage())];
  expect(new Set(tabs).size).toBe(2);

  // Other tests' tabs may still be counted (for 90 s), so the figure is at least these two
  const { online } = (await (await request.get(PRESENCE_URL)).json()) as { online: number };
  expect(online).toBeGreaterThanOrEqual(2);
  expect(guestHeartbeats).toBe(0);

  await Promise.all([guest.close(), first.close(), second.close()]);
});
