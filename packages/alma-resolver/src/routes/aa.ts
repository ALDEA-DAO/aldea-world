import { Hono, type Context } from "hono";
import { isAddressEqual, numberToHex } from "viem";
import { logger } from "../lib/logger";
import { SUPPORTED_ENTRY_POINT, type SponsorshipDecision, type UserOperationV06 } from "../lib/sponsorship";

/**
 * `POST /v1/aa/rpc`: the players' ERC-4337 bundler and paymaster (CDP), behind the Resolver so the CDP key never
 * reaches the client. Only signed-in players may use it, only the methods a Coinbase Smart Wallet needs are
 * forwarded, and every UserOperation must pass the sponsorship policy before CDP sees it (CDP's own allowlist and
 * per-account limits apply on top).
 */

export interface AaRoutesDeps {
  /** CDP bundler + paymaster endpoint (it embeds the API key). */
  bundlerUrl: string;
  chainId: number;
  checkSponsorship: (op: UserOperationV06) => SponsorshipDecision;
  /** The soul behind the request's access token, or undefined when it is missing or invalid. */
  authenticate: (c: Context) => Promise<string | undefined>;
  fetch?: typeof fetch;
}

// Methods viem's bundler client uses with `paymaster: true`; the UserOperation is params[0] in the first four.
const USER_OPERATION_METHODS = new Set(["eth_sendUserOperation", "eth_estimateUserOperationGas", "pm_getPaymasterStubData", "pm_getPaymasterData"]);
const READ_METHODS = new Set(["eth_chainId", "eth_supportedEntryPoints", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown[];
}

const rpcError = (c: Context, id: JsonRpcRequest["id"], code: number, message: string, status: 400 | 401 | 403 = 403) =>
  c.json({ jsonrpc: "2.0", id, error: { code, message } }, status);

export function createAaRoutes(deps: AaRoutesDeps) {
  const app = new Hono();
  const doFetch = deps.fetch ?? fetch;

  app.post("/rpc", async (c) => {
    const almaId = await deps.authenticate(c);
    if (!almaId) return rpcError(c, null, -32001, "Sign in to play", 401);

    const body = (await c.req.json().catch(() => undefined)) as JsonRpcRequest | undefined;
    if (!body || Array.isArray(body) || typeof body.method !== "string") return rpcError(c, null, -32600, "Invalid request", 400);
    const { id, method, params = [] } = body;

    if (USER_OPERATION_METHODS.has(method)) {
      const [op, entryPoint, chainId] = params as [UserOperationV06 | undefined, string | undefined, string | undefined];
      if (!op || typeof entryPoint !== "string" || !isAddressEqual(entryPoint as `0x${string}`, SUPPORTED_ENTRY_POINT)) {
        return rpcError(c, id, -32602, "Only EntryPoint v0.6 UserOperations are supported", 400);
      }
      if (method.startsWith("pm_") && chainId !== numberToHex(deps.chainId)) return rpcError(c, id, -32602, "Wrong chain", 400);
      const decision = deps.checkSponsorship(op);
      if (!decision.ok) {
        logger.warn({ almaId, sender: op.sender, method, reason: decision.reason }, "sponsorship rejected");
        return rpcError(c, id, -32003, `Not sponsored: ${decision.reason}`);
      }
    } else if (!READ_METHODS.has(method)) {
      return rpcError(c, id, -32601, `Method ${method} is not available`, 400);
    }

    const upstream = await doFetch(deps.bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
  });

  return app;
}
