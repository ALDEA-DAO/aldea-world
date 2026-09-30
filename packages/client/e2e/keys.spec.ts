import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * "Your keys": a second passkey is added on ALMA Auth's page and the first one can then be removed; a wallet linked
 * from the world signs in to the same soul.
 */

/** A virtual passkey device for the page; `swap()` replaces it with another device (a phone, a security key). */
async function passkeyDevice(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const add = async () =>
    (
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      })
    ).authenticatorId;
  let id = await add();
  return {
    swap: async () => {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: id });
      id = await add();
    },
  };
}

/** A MetaMask stand-in: `window.ethereum` in every page, signing with a key held by the test. */
async function injectWallet(context: BrowserContext) {
  const wallet = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}` as Hex);
  await context.exposeFunction("__walletSign", (message: string) => wallet.signMessage({ message }));
  await context.addInitScript((address) => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method, params }: { method: string; params?: string[] }) => {
        if (method === "eth_requestAccounts") return [address];
        if (method === "personal_sign") return (window as unknown as { __walletSign: (m: string) => Promise<string> }).__walletSign(params![0]!);
        throw new Error(`unsupported ${method}`);
      },
    };
  }, wallet.address);
  return wallet;
}

async function createSoulWithPasskey(page: Page) {
  await page.goto("/#/ajustes");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Entrar con mi passkey|Sign in with my passkey/ }).click();
  await page.getByRole("button", { name: /Crear mi alma|Create my soul/ }).click();
  await expect(page.getByRole("button", { name: /^(Salir|Sign out)$/ })).toBeVisible();
  await page.getByRole("link", { name: /Tus llaves|Your keys/ }).click();
  await expect(page.getByRole("heading", { name: /Tus llaves|Your keys/ })).toBeVisible();
}

const keyRows = (page: Page) => page.getByRole("listitem");

test("a second passkey is added on ALMA Auth's page and the first one can then be removed", async ({ context, page }) => {
  const device = await passkeyDevice(context, page);
  await createSoulWithPasskey(page);
  await expect(keyRows(page)).toHaveCount(1);
  await expect(page.getByText(/Agrega otra forma de entrar|Add another way to sign in/)).toBeVisible();

  // The only way in cannot be removed
  await keyRows(page).first().getByRole("button", { name: /Quitar|Remove/ }).click();
  await expect(page.getByRole("alert")).toContainText(/única forma de entrar|only way to sign in/);

  await page.getByRole("button", { name: /Agregar una passkey|Add a passkey/ }).click();
  await expect(page).toHaveURL(/:8787\/link\/passkey\//);
  // The same device cannot hold two passkeys of one soul: it says so, and another device can
  await page.getByRole("button", { name: /Crear passkey|Create passkey/ }).click();
  await expect(page.getByRole("status")).toContainText(/ya tiene una passkey|already has a passkey/);
  await device.swap();
  await page.getByRole("button", { name: /Crear passkey|Create passkey/ }).click();
  await expect(page).toHaveURL(/localhost:3000\/#\/alma\//);
  await expect(keyRows(page)).toHaveCount(2);

  await keyRows(page).first().getByRole("button", { name: /Quitar|Remove/ }).click();
  await expect(keyRows(page)).toHaveCount(1);
});

test("a wallet linked from the world signs in to the same soul", async ({ context, page }) => {
  await passkeyDevice(context, page);
  const wallet = await injectWallet(context);
  await createSoulWithPasskey(page);
  const almaId = decodeURIComponent(new URL(page.url()).hash.split("/").at(-1)!);

  await page.getByRole("button", { name: /^(Vincular una wallet|Link a wallet)$/ }).click();
  await expect(page.getByText(wallet.address)).toBeVisible();

  await page.getByRole("button", { name: /^(Salir|Sign out)$/ }).click();
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/ }).click();
  await page.getByRole("button", { name: /Tengo una wallet|I have a wallet/ }).click();
  await expect(page.getByRole("button", { name: /^(Salir|Sign out)$/ })).toBeVisible();
  await expect(page.getByTitle(almaId)).toBeAttached();
});
