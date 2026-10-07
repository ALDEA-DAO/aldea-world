import { Hono, type Context } from "hono";
import { isAddressEqual, numberToHex } from "viem";
import { logger } from "../lib/logger";
import { SUPPORTED_ENTRY_POINT, type SponsorshipDecision, type UserOperationV06 } from "../lib/sponsorship";

/**
 * `POST /v1/aa/rpc`: the players' ERC-4337 bundler and paymaster (CDP), behind the Resolver so the CDP key never
 * reaches the client. Only signed-in players may use it, only the methods a Coinbase Smart Wallet needs are
 * forwarded, and every UserOperation must pass the sponsorship policy before CDP sees it. Each soul may send
 * 50 sponsored operations a day (counted here, in memory; CDP's own allowlist and per-account limits apply on top).
 */

export interface AaRoutesDeps {
  /** CDP bundler + paymaster endpoint (it embeds the API key). */
  bundlerUrl: string;
  chainId: number;
  checkSponsorship: (op: UserOperationV06) => SponsorshipDecision;
  /** The soul behind the request's access token, or undefined when it is missing or invalid. */
  authenticate: (c: Context) => Promise<string | undefined>;
  /** Whether this soul may add `owner` to its smart wallet `sender` (a wallet it linked as controller with a passkey). */
  approveOwnerAddition?: (almaId: string, sender: string, owner: string) => Promise<boolean>;
  fetch?: typeof fetch;
  /** Sponsored operations a soul may send per UTC day (50 unless set). */
  dailyOperations?: number;
  now?: () => number;
}

export const DAILY_OPERATIONS = 50;
/** Share of sponsorship requests refused in the last hour above which something is wrong (with at least 20 asked). */
export const REJECTION_ALERT = { share: 0.05, minimum: 20, windowMs: 3_600_000 };

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
  const now = deps.now ?? Date.now;
  const dailyOperations = deps.dailyOperations ?? DAILY_OPERATIONS;
  let day = 0;
  let sent = new Map<string, number>();
  /** Sponsorship requests of this hour and the last, to say how many were refused. */
  const asked = new Map<number, { total: number; refused: number }>();
  const count = (refused: boolean) => {
    const hour = Math.floor(now() / REJECTION_ALERT.windowMs);
    const tally = asked.get(hour) ?? { total: 0, refused: 0 };
    tally.total++;
    if (refused) tally.refused++;
    asked.set(hour, tally);
    for (const key of asked.keys()) if (key < hour - 1) asked.delete(key);
  };
  /** Counts one more operation for the soul today; false when it is over its allowance. */
  const withinDailyAllowance = (almaId: string) => {
    const today = Math.floor(now() / 86_400_000);
    if (today !== day) {
      day = today;
      sent = new Map();
    }
    const count = (sent.get(almaId) ?? 0) + 1;
    sent.set(almaId, count);
    return count <= dailyOperations;
  };

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
      const approvedOwner = !decision.ok && decision.ownerAddition && (await deps.approveOwnerAddition?.(almaId, op.sender, decision.ownerAddition));
      if (!decision.ok && !approvedOwner) {
        logger.warn({ almaId, sender: op.sender, method, reason: decision.reason }, "sponsorship rejected");
        count(true);
        return rpcError(c, id, -32003, `Not sponsored: ${decision.reason}`);
      }
      if (method === "eth_sendUserOperation" && !withinDailyAllowance(almaId)) {
        logger.warn({ almaId, sender: op.sender }, "daily sponsored operations exhausted");
        count(true);
        return rpcError(c, id, -32003, "Not sponsored: this soul reached today's limit of sponsored operations");
      }
    } else if (!READ_METHODS.has(method)) {
      return rpcError(c, id, -32601, `Method ${method} is not available`, 400);
    }

    const upstream = await doFetch(deps.bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const answer = await upstream.text();
    // What the paymaster itself refuses (its own allowlist and limits) counts too
    if (method === "pm_getPaymasterData" || method === "eth_sendUserOperation") count(!upstream.ok || /"error"\s*:/.test(answer));
    return new Response(answer, { status: upstream.status, headers: { "content-type": "application/json" } });
  });

  /** Refused over asked in this hour and the last, and whether that is an alert. */
  const rejections = () => {
    const totals = [...asked.values()].reduce((sum, tally) => ({ total: sum.total + tally.total, refused: sum.refused + tally.refused }), { total: 0, refused: 0 });
    return { ...totals, alert: totals.total >= REJECTION_ALERT.minimum && totals.refused / totals.total > REJECTION_ALERT.share };
  };
  return Object.assign(app, { rejections });
}
