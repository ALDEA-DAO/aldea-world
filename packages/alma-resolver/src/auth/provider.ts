import { createHmac } from "node:crypto";
import Provider, { errors, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import { createPostgresAdapter, type AnyDb } from "./adapter";
import type { SigningKeys } from "./keys";

/**
 * ALMA Auth: the OpenID Connect provider behind "Sign in with ALMA" (ADR 0006). Its subject is the soul: `sub` is the
 * public almaId for public-subject clients (ALDEA World) and a per-sector pairwise id for clients that must not be
 * correlatable (Velum).
 *
 * - Authorization Code + PKCE (S256) only, for public browser clients registered in alma.oidc_clients.
 * - ID and access tokens live 5 minutes. Access tokens are ES256 JWTs for the ALMA API resource, so services verify
 *   them against the JWKS without calling back.
 * - Refresh tokens (`offline_access`) rotate on every use; presenting one twice revokes the whole grant.
 * - Logging in happens in the interaction pages (`/interaction/:uid`), which call `completeLogin` once a method
 *   (passkey, email code, social, wallet) has proven control of one of the soul's keys.
 */

export interface AlmaAuthOptions {
  issuer: string;
  db: AnyDb;
  signingKeys: SigningKeys;
  /** Keys that sign the provider's cookies (first one signs; rotate by prepending). */
  cookieKeys: string[];
  /** Secret mixed into pairwise subjects; changing it changes every pairwise `sub`. */
  pairwiseSalt: string;
  /** Audience of access tokens: the ALMA API (Resolver). */
  apiResource: string;
  /** Behind a TLS-terminating proxy (Fly.io): trust X-Forwarded-* headers. */
  proxy?: boolean;
}

export const ALMA_AUTH_TTL = {
  AccessToken: 5 * 60,
  IdToken: 5 * 60,
  AuthorizationCode: 60,
  Interaction: 60 * 60,
  Session: 14 * 24 * 60 * 60,
  Grant: 30 * 24 * 60 * 60,
  RefreshToken: 30 * 24 * 60 * 60,
} as const;

/** How the soul proved control of a key (RFC 8176 values). */
export type AuthMethod = "hwk" | "otp" | "pop" | "fed";

export const API_SCOPES = ["alma:links"] as const;
const OIDC_SCOPES = ["openid", "offline_access", "alma"];

export function createAlmaAuth(options: AlmaAuthOptions) {
  const { apiResource } = options;

  const configuration: Configuration = {
    adapter: createPostgresAdapter(options.db),
    jwks: options.signingKeys as Configuration["jwks"],
    cookies: { keys: options.cookieKeys },
    routes: {
      authorization: "/authorize",
      token: "/token",
      jwks: "/jwks",
      userinfo: "/userinfo",
      revocation: "/token/revocation",
      end_session: "/session/end",
    },
    // alma:links is an API scope: it comes from the resource server below, not from the OIDC scopes
    scopes: OIDC_SCOPES,
    // amr and auth_time tell worlds how and when the soul signed in (a passkey, an email code, a wallet signature)
    claims: { openid: ["sub", "amr", "auth_time"], alma: ["alma"] },
    subjectTypes: ["public", "pairwise"],
    extraClientMetadata: { properties: ["urn:alma:sector"] },
    pairwiseIdentifier: async (_ctx, accountId, client) =>
      createHmac("sha256", options.pairwiseSalt)
        .update(`${String(client["urn:alma:sector"] ?? client.clientId)}\n${accountId}`)
        .digest("base64url"),
    clientDefaults: {
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      id_token_signed_response_alg: "ES256",
    },
    enabledJWA: { idTokenSigningAlgValues: ["ES256"] },
    pkce: { required: () => true },
    // Browsers may call the token and revocation endpoints only from the origins a client redirects to
    clientBasedCORS: (_ctx, origin, client) => client.redirectUris?.some((uri) => URL.parse(uri)?.origin === origin) ?? false,
    ttl: ALMA_AUTH_TTL,
    rotateRefreshToken: true,
    // How and when the soul last proved a key: sensitive calls (adding a smart-wallet owner) need a recent passkey
    extraTokenClaims: async (ctx) => {
      const source = ctx.oidc.entities.AuthorizationCode ?? ctx.oidc.entities.RefreshToken;
      return source ? { amr: source.amr, auth_time: source.authTime } : undefined;
    },
    // OIDC only honours offline_access with prompt=consent (a consent screen on every login). Worlds are first-party
    // browser apps, so they always get a rotating refresh token, bound to the ALMA Auth session: logging out ends it.
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    conformIdTokenClaims: false,
    features: {
      devInteractions: { enabled: false },
      // A client may only revoke its own tokens
      revocation: { enabled: true, allowedPolicy: async (_ctx, client, token) => token.clientId === client.clientId },
      rpInitiatedLogout: {
        enabled: true,
        // Worlds call logout only when the player pressed "Sign out": finish it without a second confirmation
        logoutSource: async (ctx, form) => {
          ctx.body = `<!doctype html><html><head><meta charset="utf-8"><title>ALMA</title></head><body>${form}<script>
            const f = document.getElementById("op.logoutForm");
            f.insertAdjacentHTML("beforeend", '<input type="hidden" name="logout" value="yes">');
            f.submit();
          </script></body></html>`;
        },
      },
      userinfo: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => apiResource,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resourceIndicator) => {
          if (resourceIndicator !== apiResource) throw new errors.InvalidTarget();
          return {
            scope: API_SCOPES.join(" "),
            audience: apiResource,
            accessTokenTTL: ALMA_AUTH_TTL.AccessToken,
            accessTokenFormat: "jwt",
            jwt: { sign: { alg: "ES256" } },
          };
        },
      },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (ctx, accountId) => ({
      accountId,
      claims: async (_use, scope) => ({
        sub: accountId,
        // The public almaId would defeat pairwise subjects: only public-subject clients get it
        ...(scope.split(" ").includes("alma") && ctx.oidc.client?.subjectType === "public" ? { alma: accountId } : {}),
      }),
    }),
    // Worlds are first-party ALMA clients: the soul's login grants the requested scopes (no consent screen yet).
    loadExistingGrant: async (ctx: KoaContextWithOIDC) => {
      const { oidc } = ctx;
      const accountId = oidc.session?.accountId;
      if (!oidc.client || !accountId) return undefined;
      const existingId = oidc.result?.consent?.grantId ?? oidc.session?.grantIdFor(oidc.client.clientId);
      const grant = (existingId && (await oidc.provider.Grant.find(existingId))) || new oidc.provider.Grant({ clientId: oidc.client.clientId, accountId });
      const requested = [...(oidc.requestParamScopes ?? [])];
      grant.addOIDCScope(requested.filter((s) => OIDC_SCOPES.includes(s)).join(" "));
      grant.addResourceScope(apiResource, requested.filter((s) => (API_SCOPES as readonly string[]).includes(s)).join(" "));
      await grant.save();
      return grant;
    },
    renderError: async (ctx, out) => {
      ctx.type = "json";
      ctx.body = out;
    },
  };

  const provider = new Provider(options.issuer, configuration);
  provider.proxy = options.proxy ?? false;

  /**
   * Finishes an interaction's login for a soul, once a login method has verified one of its keys. Returns the URL
   * the browser must go back to (the provider resumes the authorization there).
   */
  async function completeLogin(uid: string, login: { almaId: string; amr: AuthMethod[] }): Promise<string> {
    const interaction = await provider.Interaction.find(uid);
    if (!interaction) throw new errors.SessionNotFound("interaction expired");
    interaction.result = { login: { accountId: login.almaId, amr: login.amr, remember: true } };
    await interaction.save(interaction.exp - Math.floor(Date.now() / 1000));
    return interaction.returnTo;
  }

  return { provider, completeLogin };
}

export type AlmaAuth = ReturnType<typeof createAlmaAuth>;
