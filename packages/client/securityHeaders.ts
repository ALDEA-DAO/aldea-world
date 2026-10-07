import type { Plugin } from "vite";

/**
 * The production build's security headers, written with the build so they always match it:
 *
 * - `_headers` (Cloudflare Pages reads it): the Content-Security-Policy with `frame-ancestors 'none'`, and the other
 *   headers a browser honours only as headers;
 * - a `<meta http-equiv="Content-Security-Policy">` in index.html with the same policy, for wherever the build is
 *   served without that file (an IPFS gateway, a fork's own host). `frame-ancestors` does not work from a meta tag.
 *
 * Scripts only from the build itself: nothing inline, nothing evaluated, no third-party script. Connections go to any
 * https or wss origin, because the Portal reads other worlds' manifests from wherever each world is served; what
 * protects a player there is that no other origin's script can ever run here. A build configured with plain http or
 * ws services (a local stack) gets exactly those origins added, so it can be tried as built.
 */
export function contentSecurityPolicy({ meta = false, insecureOrigins = [] as string[] } = {}): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    // React sets styles on elements (a tribe's color, a bar's width); the stylesheets themselves are the build's
    "style-src 'self' 'unsafe-inline'",
    // Wallet extensions hand their icon as a data: URI; the soul card is drawn into a blob
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self' https: wss:", ...insecureOrigins].join(" "),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    ...(meta ? [] : ["frame-ancestors 'none'"]),
  ];
  return directives.join("; ");
}

/** The origins of the services this build is configured with that are not https or wss: a local stack's. */
function insecureOrigins(env: Record<string, string | undefined>): string[] {
  const local = env.VITE_CHAIN_ID === undefined || env.VITE_CHAIN_ID === "31337";
  // Without configuration the client talks to the local stack's defaults
  const urls = local
    ? ["http://localhost:8787", "http://localhost:9999", "ws://localhost:9883", "http://localhost:3101", "http://localhost:3334", "http://127.0.0.1:8545", "ws://127.0.0.1:8545"]
    : [];
  for (const [name, value] of Object.entries(env)) if (/^VITE_.*(URL|ISSUER|HOST)$/.test(name) && value) urls.push(value);
  return [...new Set(urls.filter((url) => /^(http|ws):\/\//.test(url)).map((url) => new URL(url).origin.replace(/^null$/, url)))];
}

const headers = (csp: string) => `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Cross-Origin-Opener-Policy: same-origin

# Hashed by the build: they never change under the same name
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# Says which version this is: always asked again
/version.json
  Cache-Control: no-store
/.well-known/*
  Cache-Control: no-store
  Access-Control-Allow-Origin: *
`;

export function securityHeaders(): Plugin {
  let extra: string[] = [];
  return {
    name: "aldea:security-headers",
    apply: "build",
    configResolved(config) {
      extra = insecureOrigins({ ...config.env, ...process.env });
    },
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy({ meta: true, insecureOrigins: extra }) }, injectTo: "head-prepend" }],
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headers(contentSecurityPolicy({ insecureOrigins: extra })) });
    },
  };
}
