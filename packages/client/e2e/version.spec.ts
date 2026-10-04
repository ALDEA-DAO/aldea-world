import { expect, test, type Page } from "@playwright/test";
import { registerAldeaVersion } from "./atlas";

/**
 * The version badge: what the client claims to be (`/version.json`, mocked here: a dev server has none) against what
 * the Atlas on the local chain says. A fork's client and the rule itself are covered by @aldea/shared's tests.
 * Needs the local stack (`pnpm dev`).
 */

const badge = (page: Page) => page.getByTestId("version-badge");
const about = (page: Page) => page.getByRole("region", { name: /Acerca de esta versión|About this version/ });
const claim = (page: Page, version: { versionId: string; clientCid: string; gitCommit: string; semver: string }) => page.route("**/version.json", (route) => route.fulfill({ json: version }));

test("a dev server claims no version: no badge, and the settings say so", async ({ page }) => {
  await page.goto("/#/ajustes");
  await expect(about(page).getByText(/Versión de desarrollo|Development version/)).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
});

test("the official version, a candidate and an unofficial one", async ({ page }) => {
  // Official: what the Atlas has as ALDEA World's official version
  const official = await registerAldeaVersion({ official: true });
  await claim(page, official);
  await page.goto("/#/");
  await expect(badge(page)).toHaveText(/Versión oficial ✓|Official version ✓/);
  await badge(page).click();
  await expect(page).toHaveURL(/#\/ajustes$/);
  await expect(about(page).getByText(official.semver)).toBeVisible();
  await expect(about(page).getByText(official.clientCid)).toBeVisible();
  await expect(about(page).getByText(official.gitCommit)).toBeVisible();

  // The same version id with another build's CID is not that version
  await page.unroute("**/version.json");
  await claim(page, { ...official, clientCid: "bafytampered" });
  await page.reload();
  await expect(badge(page)).toHaveText(/Versión no oficial|Unofficial version/);

  // Candidate: registered, not official
  const candidate = await registerAldeaVersion({ official: false });
  await page.unroute("**/version.json");
  await claim(page, candidate);
  await page.reload();
  await expect(badge(page)).toHaveText(/^(Candidata|Candidate)$/);

  // Once another version is official, the previous official one is not any more
  await registerAldeaVersion({ official: true });
  await page.unroute("**/version.json");
  await claim(page, official);
  await page.reload();
  await expect(badge(page)).toHaveText(/Versión no oficial|Unofficial version/);
  await expect(about(page).getByText(/no reconoce este cliente|does not recognize this client/)).toBeVisible();

  // A version the Atlas never heard of
  await page.unroute("**/version.json");
  await claim(page, { ...official, versionId: `0x${"ee".repeat(32)}` });
  await page.reload();
  await expect(badge(page)).toHaveText(/Versión no oficial|Unofficial version/);
});
