import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { canonicalHash, tallyIsConsistent, type CouncilTally } from "@aldea/shared/council";
import { toHex } from "viem";
import { cardanoConfigured, installWallet, newHolder } from "./cardano";
import { castVote, COUNCIL_DELAY, fetchTally, officialVersion, openCharter, readProposal, restoreGovernor, sealInReadModel, veto } from "./council";

/**
 * The Genesis Charter, from its opening to the version it founds the world with: a Founder signs and then objects from
 * the Council with their Cardano wallet, another holder signs, the Charter closes and is tallied, the relay queues the
 * result, the delay passes and it is executed. And the other ending: the guardian vetoes.
 *
 * Needs the local stack with Cardano and the vote batcher (`CARDANO_UTXORPC_URL=http://localhost:50051 pnpm dev`).
 * The read model waits for Cardano's blocks, so now and then it stalls a minute or two behind the clock: the Charter
 * here lasts minutes, not days, and every wait allows for that.
 */

const LAG = 240_000;
test.describe.configure({ timeout: 20 * 60_000 });
test.beforeEach(async () => {
  test.skip(!(await cardanoConfigured()), "the local Effectstream is not following Cardano");
});
test.afterAll(restoreGovernor);

async function signIn(context: BrowserContext, page: Page, hash: string) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(`/${hash}`);
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page).toHaveURL(new RegExp(`${hash.replace(/[/#]/g, "\\$&")}$`));
}

const seals = (page: Page) => page.getByRole("region", { name: /^(Sellos|Seals)$/ });
const council = (page: Page) => page.getByTestId("council");
const status = (page: Page) => council(page).getByTestId("council-status");
const voice = (page: Page) => council(page).getByTestId("council-voice");
const SIGN = /^(Firmar el Acta|Sign the Charter)$/;
const OBJECT = /^(Objetar|Object)$/;

/** Signs the message the vote dialog shows, with the test wallet. */
async function signInDialog(page: Page, name: RegExp) {
  const dialog = page.getByRole("dialog", { name });
  await dialog.getByRole("button", { name: "Test wallet" }).click();
  // What the wallet will sign is on screen as it is: this world, the signing address and the vote
  await expect(dialog.getByTestId("vote-message")).toHaveText(/^aldea-world\d{13}stake-test1[a-z0-9]+--cv---0x[0-9a-f]{64}---[so]--$/);
  await expect(dialog.getByText(/no se arma ninguna transacción|no transaction is built/)).toBeVisible();
  await dialog.getByRole("button", { name: /^(Firmar|Sign)$/ }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Tu voto está publicado|Your vote is published/, { timeout: 30_000 });
  await dialog.getByRole("button", { name: /^(Cerrar|Close)$/ }).last().click();
}

test("a Founder signs and then objects, the Charter is approved, queued, and founds the world on its version", async ({ context, page }) => {
  const holder = await newHolder(5000);
  const other = await newHolder(20_000);
  const stranger = await newHolder(9000);
  sealInReadModel(other, toHex(crypto.getRandomValues(new Uint8Array(32))));
  await installWallet(page, holder);

  // The Founder seal first: link the wallet and claim it
  await signIn(context, page, "#/b/registro-de-almas");
  await seals(page).getByRole("button", { name: /^(Vincular Cardano|Link Cardano)$/ }).click();
  const link = page.getByRole("dialog", { name: /^(Vincular Cardano|Link Cardano)$/ });
  await link.getByRole("button", { name: "Test wallet" }).click();
  await link.getByRole("button", { name: /^(Firmar|Sign)$/ }).click();
  await link.getByRole("button", { name: /Reclamar sello|Claim seal/ }).click();
  await expect(seals(page).getByTestId("founder-badge")).toBeVisible({ timeout: 60_000 });
  // The read model must know the seal before it is asked to count a vote
  const almaId = await page.getByRole("region", { name: /^(Tu alma|Your soul)$/ }).getByTitle(/^alma:main:human:/).getAttribute("title");
  const { almaIdHash } = await import("@aldea/shared/alma");
  await expect.poll(async () => (await fetch(`http://localhost:9999/api/v1/founders/${almaIdHash(almaId!)}`)).status, { timeout: LAG }).toBe(200);
  await expect(seals(page).getByTestId("charter-signatory")).toHaveCount(0);

  const charter = await openCharter({ snapshotIn: 3, startsIn: 6, endsIn: 300 });
  await page.goto("/#/b/consejo");
  await expect(council(page).getByRole("heading", { name: /El Acta de Génesis|The Genesis Charter/ })).toBeVisible();
  // What is ratified, and the rule
  await expect(council(page).getByTestId("charter-version")).toHaveText(charter.semver, { timeout: LAG });
  await expect(council(page).getByText(/aprobada salvo objeción calificada|approved unless there is a qualified objection/)).toBeVisible({ timeout: LAG });
  await expect(status(page)).toHaveText(/El Acta está abierta hasta|The Charter is open until/, { timeout: LAG });

  // Your voice: the weight is the snapshot's
  await expect(voice(page).getByTestId("voice-weight")).toHaveText(/(Tu voz pesa|Your voice weighs) 5[.,]000 \$ALDEA\./, { timeout: LAG });
  await voice(page).getByRole("button", { name: SIGN }).click();
  await signInDialog(page, SIGN);
  await expect(voice(page).getByTestId("voice-current")).toContainText(/Firmaste el Acta|You signed the Charter/);
  await expect(council(page).getByTestId("tally-signatures")).toContainText(/5[.,]000 \$ALDEA/, { timeout: LAG });

  // Another Founder signs; a holder without the seal objects, and is published but not counted
  expect((await castVote(other, charter.proposalId, "sign")).status).toBe(200);
  expect((await castVote(stranger, charter.proposalId, "object")).status).toBe(200);
  await expect(council(page).getByTestId("tally-signatures")).toContainText(/25[.,]000 \$ALDEA/, { timeout: LAG });

  // A change of mind: the last vote is the one that counts
  await voice(page).getByRole("button", { name: /Cambiar mi voto|Change my vote/ }).click();
  await signInDialog(page, OBJECT);
  await expect(voice(page).getByTestId("voice-current")).toContainText(/Cambiaste tu voto a objetar|You changed your vote to object/);
  await expect(council(page).getByTestId("tally-objections")).toContainText(/5[.,]000 \$ALDEA/, { timeout: LAG });
  await expect(council(page).getByTestId("tally-signatures")).toContainText(/20[.,]000 \$ALDEA/);
  await expect(council(page).getByTestId("council-tally")).toContainText(/2 (voces|voices)/);

  // The close: objections (5,000) do not outweigh the signatures (20,000), so the Charter is approved
  await expect(status(page)).toContainText(/El Acta fue aprobada|The Charter was approved/, { timeout: 300_000 + LAG });
  await expect(voice(page)).toContainText(/Acta cerrada|Charter closed/);
  // Anyone can download the tally and redo the count: its hash is the one that goes on-chain
  await expect(council(page).getByTestId("tally-json")).toBeVisible();
  const tally = JSON.parse(await fetchTally(charter.proposalId)) as CouncilTally;
  const read = await readProposal(charter.proposalId, holder.credential);
  expect(canonicalHash(tally)).toBe(read!.result!.tallyHash);
  expect(tallyIsConsistent(tally)).toBe(true);
  expect(tally.votes.map((v) => [v.credential, v.choice])).toEqual([[holder.credential, "object"], [other.credential, "sign"]].sort());
  expect(tally.result).toMatchObject({ signatures: "20000000000", objections: "5000000000", participants: 2, outcome: "approved" });
  expect(read!.voter!.vote!.inputTx).toMatch(/^0x[0-9a-f]{64}$/);

  // The relay recomputes it and queues it; from then the delay runs
  await expect(status(page)).toContainText(/Se ejecuta a partir del|It can be executed from/, { timeout: LAG });
  expect((await readProposal(charter.proposalId))!.proposal.tallyURI).toContain(`/api/v1/council/proposals/${charter.proposalId}/tally.json`);

  // Signing or objecting, the soul is a Charter Signatory, with its vote as evidence, for anyone who looks at it
  await page.goto(`/#/alma/${almaId}`);
  await expect(seals(page).getByTestId("charter-signatory")).toBeVisible({ timeout: 30_000 });
  await expect(seals(page).getByTestId("charter-signatory")).toContainText(read!.voter!.vote!.inputTx.slice(0, 6));

  test.skip(COUNCIL_DELAY > 180, `the local executor's delay is ${COUNCIL_DELAY} s: deploy with COUNCIL_DELAY=60 to see the execution here`);
  await page.goto("/#/b/consejo");
  await expect(status(page)).toHaveText(new RegExp(`(ALDEA fue fundada con la versión|ALDEA was founded with version) ${charter.semver.replaceAll(".", "\\.")}\\.`), { timeout: COUNCIL_DELAY * 1000 + LAG });
  expect(await officialVersion()).toBe(charter.versionId);
});

test("without the seal the Council shows the way to it, and a vetoed Charter says why", async ({ context, page }) => {
  await signIn(context, page, "#/b/consejo");
  const charter = await openCharter({ snapshotIn: 3, startsIn: 6, endsIn: 600 });
  await expect(status(page)).toHaveText(/El Acta está abierta hasta|The Charter is open until/, { timeout: LAG });
  await expect(voice(page).getByTestId("voice-not-founder")).toContainText(/Para firmar el Acta necesitas el sello de Fundador|To sign the Charter you need the Founder seal/);
  await expect(voice(page).getByRole("button", { name: SIGN })).toHaveCount(0);
  await expect(voice(page).getByRole("link", { name: /Cómo obtenerlo|How to get it/ })).toHaveAttribute("href", "#/b/registro-de-almas");

  await veto(charter.proposalId, "ensayo de veto");
  await expect(status(page)).toContainText(/El guardián vetó el Acta|The guardian vetoed the Charter/, { timeout: LAG });
  await expect(status(page)).toContainText("ensayo de veto");
  expect((await readProposal(charter.proposalId))!.proposal.status).toBe("vetoed");
});
