import { almaAnchorRegistryAbi, worldAbi } from "@aldea/shared/abis";
import { concat, encodeFunctionData, keccak256, numberToHex, parseAbi, toHex, type Address, type Hex } from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { COINBASE_SMART_WALLET_FACTORY, createSponsorshipPolicy } from "../src/lib/sponsorship";
import { soulSubOrganizationParams } from "../src/lib/turnkey";
import { ProblemError } from "../src/lib/problem";

const WORLD: Address = "0x6026446be1De61fbba0e7F6C91af8F94c1813FdB";
const REGISTRY: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const SENDER: Address = "0x0B75a7C9767083B2Ff35834c9685cFF3AFA181aE";
const CHAIN_ID = 84532;

const wallet = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  "function addOwnerAddress(address owner)",
]);
const execute = (target: Address, data: Hex, value = 0n) => encodeFunctionData({ abi: wallet, functionName: "execute", args: [target, value, data] });
const batch = (...calls: { target: Address; data: Hex; value?: bigint }[]) =>
  encodeFunctionData({ abi: wallet, functionName: "executeBatch", args: [calls.map((c) => ({ target: c.target, value: c.value ?? 0n, data: c.data }))] });

const anchorHuman = encodeFunctionData({ abi: almaAnchorRegistryAbi, functionName: "anchorHuman", args: ["alma:main:human:0123456789abcdef0123456789abcdef", keccak256(toHex("doc"))] });
const requestBirth = encodeFunctionData({ abi: worldAbi, functionName: "aldea__requestBirth", args: [3, keccak256(toHex("soul"))] });
const setPaused = encodeFunctionData({ abi: worldAbi, functionName: "aldea__setPaused", args: [true] });
const addOwner = encodeFunctionData({ abi: wallet, functionName: "addOwnerAddress", args: ["0x000000000000000000000000000000000000dEaD"] });

const check = createSponsorshipPolicy({ world: WORLD, almaRegistry: REGISTRY });
const op = (callData: Hex, initCode: Hex = "0x") => ({ sender: SENDER, nonce: "0x0", initCode, callData });

describe("sponsorship policy", () => {
  it("sponsors the birth batch and a single game call", () => {
    expect(check(op(batch({ target: REGISTRY, data: anchorHuman }, { target: WORLD, data: requestBirth })))).toEqual({ ok: true });
    expect(check(op(execute(WORLD, requestBirth)))).toEqual({ ok: true });
  });

  it("sponsors the first operation, which deploys the wallet through the Coinbase factory", () => {
    expect(check(op(execute(WORLD, requestBirth), concat([COINBASE_SMART_WALLET_FACTORY, "0x1234"])))).toEqual({ ok: true });
    expect(check(op(execute(WORLD, requestBirth), concat(["0x000000000000000000000000000000000000bEEF", "0x1234"]))).ok).toBe(false);
  });

  it("never sponsors owner changes, admin functions, other targets or ETH", () => {
    // an owner change is only a candidate: the proxy sponsors it when the soul approved that owner
    expect(check(op(execute(SENDER, addOwner)))).toMatchObject({ ok: false, ownerAddition: "0x000000000000000000000000000000000000dEaD" });
    expect(check(op(execute(WORLD, setPaused)))).toMatchObject({ ok: false, reason: expect.stringContaining("function") });
    expect(check(op(batch({ target: WORLD, data: requestBirth }, { target: SENDER, data: addOwner }))).ok).toBe(false);
    expect(check(op(execute(WORLD, requestBirth, 1n)))).toMatchObject({ ok: false, reason: "calls with ETH are not sponsored" });
    expect(check(op(addOwner)).ok).toBe(false);
    expect(check(op(batch())).ok).toBe(false);
  });
});

describe("POST /v1/aa/rpc", () => {
  const setup = (signedIn = true, approveOwnerAddition?: (almaId: string, sender: string, owner: string) => Promise<boolean>) => {
    const almaId = signedIn ? "alma:main:human:0123456789abcdef0123456789abcdef" : undefined;
    const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      Response.json({ jsonrpc: "2.0", id: JSON.parse(String(init?.body)).id, result: "0xok" }),
    );
    const app = createApp({
      pingDb: async () => {},
      baseHead: async () => 1n,
      corsOrigins: [],
      aa: { bundlerUrl: "https://cdp.example/secret-key", chainId: CHAIN_ID, checkSponsorship: check, authenticate: async () => almaId, approveOwnerAddition, fetch: upstream as typeof fetch },
    });
    const rpc = (method: string, params: unknown[]) =>
      app.request("/v1/aa/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return { upstream, rpc };
  };

  it("requires a signed-in soul", async () => {
    const { rpc, upstream } = setup(false);
    const res = await rpc("eth_chainId", []);
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards sponsored operations and read methods to the bundler", async () => {
    const { rpc, upstream } = setup();
    const res = await rpc("pm_getPaymasterStubData", [op(execute(WORLD, requestBirth)), entryPoint06Address, numberToHex(CHAIN_ID), null]);
    expect(await res.json()).toMatchObject({ result: "0xok" });
    expect((await rpc("eth_getUserOperationReceipt", ["0xabc"])).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls[0]![0]).toBe("https://cdp.example/secret-key");
  });

  it("rejects unsponsored operations before they reach CDP", async () => {
    const { rpc, upstream } = setup();
    const res = await rpc("eth_sendUserOperation", [op(execute(SENDER, addOwner)), entryPoint06Address]);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: -32003 } });
    expect((await rpc("pm_getPaymasterData", [op(execute(WORLD, requestBirth)), entryPoint06Address, numberToHex(8453), null])).status).toBe(400);
    expect((await rpc("eth_sendUserOperation", [op(execute(WORLD, requestBirth)), entryPoint07Address])).status).toBe(400);
    expect((await rpc("eth_sendRawTransaction", ["0x00"])).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sponsors adding an owner only when the soul approved that owner for that wallet", async () => {
    const approvals: string[][] = [];
    const approve = async (almaId: string, sender: string, owner: string) => {
      approvals.push([almaId, sender, owner]);
      return owner === "0x000000000000000000000000000000000000dEaD";
    };
    const { rpc, upstream } = setup(true, approve);
    expect((await rpc("eth_sendUserOperation", [op(execute(SENDER, addOwner)), entryPoint06Address])).status).toBe(200);
    expect(approvals[0]).toEqual(["alma:main:human:0123456789abcdef0123456789abcdef", SENDER, "0x000000000000000000000000000000000000dEaD"]);

    const other = encodeFunctionData({ abi: wallet, functionName: "addOwnerAddress", args: ["0x000000000000000000000000000000000000bEEF"] });
    expect((await rpc("eth_sendUserOperation", [op(execute(SENDER, other)), entryPoint06Address])).status).toBe(403);
    // batching an owner change with anything else is never sponsored
    expect((await rpc("eth_sendUserOperation", [op(batch({ target: SENDER, data: addOwner }, { target: WORLD, data: requestBirth })), entryPoint06Address])).status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("is not mounted without a CDP endpoint", async () => {
    const app = createApp({ pingDb: async () => {}, baseHead: async () => 1n, corsOrigins: [] });
    expect((await app.request("/v1/aa/rpc", { method: "POST", body: "{}" })).status).toBe(404);
  });
});

describe("Turnkey sub-organization of a soul", () => {
  it("identifies the root user by ALMA Auth claims and disables Turnkey's own logins", () => {
    const almaId = "alma:main:human:0123456789abcdef0123456789abcdef";
    const params = soulSubOrganizationParams({ almaId, issuer: "https://auth.adasouls.io", audience: "aldea-world" });
    expect(params.rootUsers).toEqual([
      {
        userName: "soul",
        apiKeys: [],
        authenticators: [],
        oauthProviders: [{ providerName: "ALMA Auth", oidcClaims: { iss: "https://auth.adasouls.io", sub: almaId, aud: "aldea-world" } }],
      },
    ]);
    expect(params.rootQuorumThreshold).toBe(1);
    expect(params.wallet.accounts).toHaveLength(1);
    expect(params.wallet.accounts[0]).toMatchObject({ curve: "CURVE_SECP256K1", addressFormat: "ADDRESS_FORMAT_ETHEREUM" });
    expect(params).toMatchObject({ disableEmailRecovery: true, disableEmailAuth: true, disableOtpEmailAuth: true, disableSmsAuth: true });
  });

  it("only accepts human souls", () => {
    expect(() => soulSubOrganizationParams({ almaId: "alma:main:org:tribu-raes", issuer: "https://auth.adasouls.io", audience: "aldea-world" })).toThrow(ProblemError);
  });
});
