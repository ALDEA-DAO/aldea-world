/**
 * Registers ALMA Auth's OIDC clients (upsert by client_id). Redirect URIs are exact, so each environment passes its
 * own list in ALMA_AUTH_CLIENTS (JSON array); without it, the local `aldea-world` client for the Vite dev server.
 *
 *   pnpm --filter @aldea/alma-resolver db:clients
 *   ALMA_AUTH_CLIENTS='[{"clientId":"aldea-world","name":"ALDEA World","redirectUris":["https://testnet.aldea.world/"]}]' pnpm …
 */
import { z } from "zod";
import type { AnyDb } from "../auth/adapter";
import { createDb } from "./client";
import { oidcClients } from "./schema";

const clientSchema = z.object({
  clientId: z.string().regex(/^[a-z0-9-]{3,64}$/),
  name: z.string().min(1),
  redirectUris: z.array(z.url()).min(1),
  postLogoutRedirectUris: z.array(z.url()).default([]),
  subjectType: z.enum(["public", "pairwise"]).default("public"),
  sectorIdentifier: z.string().optional(),
});
export type OidcClientInput = z.input<typeof clientSchema>;

const LOCAL_CLIENTS: OidcClientInput[] = [
  {
    clientId: "aldea-world",
    name: "ALDEA World",
    redirectUris: ["http://localhost:3000/"],
    postLogoutRedirectUris: ["http://localhost:3000/"],
  },
  // The fork kit CLI signs in from a terminal with a wallet key: its redirect URI is never opened
  { clientId: "fork-kit", name: "Fork kit", redirectUris: ["http://127.0.0.1/fork-kit/callback"] },
];

export async function upsertOidcClients(db: AnyDb, input: OidcClientInput[]) {
  const clients = z.array(clientSchema).parse(input);
  for (const client of clients) {
    const { clientId, ...rest } = client;
    await db
      .insert(oidcClients)
      .values({ clientId, ...rest })
      .onConflictDoUpdate({ target: oidcClients.clientId, set: rest });
  }
  return clients.map((c) => c.clientId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, client } = createDb(url);
  const input = process.env.ALMA_AUTH_CLIENTS ? (JSON.parse(process.env.ALMA_AUTH_CLIENTS) as OidcClientInput[]) : LOCAL_CLIENTS;
  console.log(`alma-resolver: OIDC clients registered: ${(await upsertOidcClients(db, input)).join(", ")}`);
  await client.end();
}
