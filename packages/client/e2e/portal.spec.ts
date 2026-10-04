import { expect, test, type Page } from "@playwright/test";
import { ALDEA_WORLD_ID, planFork, registerFork, verifyWorld } from "./atlas";

/**
 * The Portal of Worlds over the real Atlas: ALDEA World as registered by the local deploy, a fork that appears while
 * the Portal is open, the filters, traveling with and without the warning, and a world's detail. Needs the local
 * stack (`pnpm dev`).
 */

const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const card = (page: Page, name: string) => page.getByRole("article", { name });
const VERIFIED = /^(Verificados|Verified)$/;
const ALL = /^(Todos|All)$/;
const FORKS = /Forks de ALDEA|ALDEA forks/;
const TRAVEL = /^(Viajar|Travel)$/;

test("ALDEA World is the verified world you are in, with its activity and who is online", async ({ page }) => {
  await page.goto("/#/b/portal");
  const portal = page.getByRole("region", { name: /Portal de los Mundos|Portal of Worlds/ });
  await expect(tab(page, VERIFIED)).toHaveAttribute("aria-selected", "true");
  const aldea = portal.getByRole("article", { name: "ALDEA World" });
  await expect(aldea.getByText(/^(Verificado|Verified)$/)).toBeVisible();
  await expect(aldea.getByText("alma:main:org:aldea-world")).toBeVisible();
  await expect(aldea.getByTestId("world-activity")).toHaveText(/(Últimas 24 h|Last 24 h): \d+ (nacimientos|births) · \d+ (visitas|visits)/);
  await expect(aldea.getByTestId("world-presence")).toHaveText(/~\d+ (en línea, autorreportado|online, self-reported)/);
  await expect(aldea.getByText(/Estás aquí|You are here/)).toBeVisible();
  await expect(aldea.getByRole("button", { name: TRAVEL })).toHaveCount(0);

  // The full page shows the same world
  await page.goto("/#/portal");
  await expect(page.getByRole("heading", { level: 1, name: /Portal de los Mundos|Portal of Worlds/ })).toBeVisible();
  await expect(card(page, "ALDEA World")).toBeVisible();
});

test("a new fork appears without reloading; the filters, the warning before traveling and its detail", async ({ page, context }) => {
  await page.goto("/#/portal");
  await tab(page, ALL).click();
  await expect(card(page, "ALDEA World")).toBeVisible();

  // Its client answers with a manifest and a presence figure. Another world's Portal reads both from its own
  // origin, so the client has to allow it (CORS).
  const plan = planFork();
  const manifest = {
    schema: "aldea-world-client/v1",
    worldId: `0x${"ab".repeat(32)}`,
    versionId: `0x${"cd".repeat(32)}`,
    name: plan.name,
    operator: plan.org,
    clientCid: "bafynocturna",
    gitCommit: "c0c0c0c",
    presenceUrl: `${plan.clientUrl}/presence`,
    locale: ["es"],
  };
  await context.route(`${plan.clientUrl}/**`, (route) => {
    const headers = { "access-control-allow-origin": "*" };
    const { pathname } = new URL(route.request().url());
    if (pathname === "/.well-known/aldea-world.json") return route.fulfill({ headers, json: manifest });
    if (pathname === "/presence") return route.fulfill({ headers, json: { online: 8, updatedAt: new Date().toISOString() } });
    return route.fulfill({ contentType: "text/html", body: `<title>${plan.name}</title>` });
  });
  const fork = await registerFork(plan);

  // Live: no reload
  const nocturna = card(page, fork.name);
  await expect(nocturna).toBeVisible({ timeout: 30_000 });
  await expect(nocturna.getByText(/fork de ALDEA World|fork of ALDEA World/)).toBeVisible();
  await expect(nocturna.getByText(fork.org)).toBeVisible({ timeout: 15_000 });
  await expect(nocturna.getByText(/^(Verificado|Verified)$/)).toHaveCount(0);
  await expect(nocturna.getByTestId("world-version")).toHaveText(/Sin versión oficial todavía|No official version yet/);
  await expect(nocturna.getByTestId("world-activity")).toHaveText(/no medible|not measurable/);
  await expect(nocturna.getByTestId("world-presence")).toHaveText(/~8 (en línea, autorreportado|online, self-reported)/, { timeout: 15_000 });

  // Filters: verified hides it, ALDEA's forks shows only it
  await tab(page, VERIFIED).click();
  await expect(card(page, "ALDEA World")).toBeVisible();
  await expect(nocturna).toHaveCount(0);
  await tab(page, FORKS).click();
  await expect(nocturna).toBeVisible();
  await expect(card(page, "ALDEA World")).toHaveCount(0);

  // Unverified: the warning cannot be skipped
  const events: unknown[] = [];
  await page.exposeFunction("recordAnalytics", (detail: unknown) => events.push(detail));
  await page.evaluate(() => window.addEventListener("aldea:analytics", (e) => (window as unknown as { recordAnalytics: (d: unknown) => void }).recordAnalytics((e as CustomEvent).detail)));
  await nocturna.getByRole("button", { name: TRAVEL }).click();
  const warning = page.getByRole("dialog", { name: /Mundo sin verificar|Unverified world/ });
  await expect(warning.getByText(fork.clientUrl)).toBeVisible();
  const go = warning.getByRole("button", { name: /Viajar igualmente|Travel anyway/ });
  await expect(go).toBeDisabled();
  await warning.getByRole("checkbox").check();
  const [popup] = await Promise.all([context.waitForEvent("page"), go.click()]);
  expect(popup.url()).toContain(new URL(fork.clientUrl).host);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await expect(warning).toBeHidden();
  expect(events).toEqual([{ event: "world_travel_clicked", props: { verified: false } }]);

  // Once the curator verifies it, the card updates by itself and traveling asks nothing
  await verifyWorld(fork.worldId);
  await expect(nocturna.getByText(/^(Verificado|Verified)$/)).toBeVisible({ timeout: 30_000 });
  const [direct] = await Promise.all([context.waitForEvent("page"), nocturna.getByRole("button", { name: TRAVEL }).click()]);
  await direct.close();
  await expect(warning).toBeHidden();
  expect(events.at(-1)).toEqual({ event: "world_travel_clicked", props: { verified: true } });

  // Its detail: lineage, versions and clients
  await nocturna.getByRole("link", { name: fork.name }).click();
  await expect(page).toHaveURL(new RegExp(`#/portal/${fork.worldId}$`));
  await expect(page.getByRole("heading", { level: 1, name: fork.name })).toBeVisible();
  const lineage = page.getByRole("navigation", { name: /Linaje|Lineage/ });
  await expect(lineage.getByRole("link", { name: "ALDEA World" })).toHaveAttribute("href", `#/portal/${ALDEA_WORLD_ID.toLowerCase()}`);
  await expect(lineage.getByText(fork.name)).toHaveAttribute("aria-current", "page");
  const version = page.getByRole("row", { name: /0\.1\.0/ });
  await expect(version.getByText(/^(Candidata|Candidate)$/)).toBeVisible();
  await expect(version.getByText("c0c0c0c")).toBeVisible();
  await expect(page.getByText(fork.clientUrl)).toBeVisible();
  await expect(page.getByText(new RegExp(`(Operado por|Operated by) ${fork.org}`))).toBeVisible();
});

test("a world the Atlas does not know, and one without versions", async ({ page }) => {
  await page.goto(`/#/portal/0x${"ee".repeat(32)}`);
  await expect(page.getByRole("status")).toHaveText(/No encontramos ese mundo en el Atlas|We couldn't find that world in the Atlas/);

  await page.goto(`/#/portal/${ALDEA_WORLD_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "ALDEA World" })).toBeVisible();
  await expect(page.getByText(/todavía no publicó versiones|hasn't published any versions yet/)).toBeVisible();
});

test("without Effectstream the Portal says so, offers to retry, and keeps the list it already had", async ({ page }) => {
  let down = true;
  await page.route("**/api/v1/atlas/worlds**", (route) => (down ? route.fulfill({ status: 503, body: "down" }) : route.fallback()));
  await page.goto("/#/portal");
  const clouded = page.getByText(/El Portal está nublado|The Portal is clouded over/);
  await expect(clouded).toBeVisible();

  down = false;
  await page.getByRole("button", { name: /Reintentar|Retry/ }).click();
  await expect(card(page, "ALDEA World")).toBeVisible();

  // Down again while a change arrives: the list stays, with a notice
  down = true;
  await registerFork();
  await expect(page.getByText(/Actualizando…|Updating…/)).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "ALDEA World")).toBeVisible();
  await expect(clouded).toHaveCount(0);
});
