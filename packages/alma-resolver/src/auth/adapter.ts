import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Adapter, AdapterPayload } from "oidc-provider";
import * as schema from "../db/schema";
import { oidcClients, oidcPayloads } from "../db/schema";

/**
 * oidc-provider storage on Postgres: sessions, grants, codes, tokens and interactions live in `alma.oidc_payloads`;
 * clients are read from `alma.oidc_clients` (registered by `db:clients`, never through the provider).
 */

export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const epoch = (date: Date) => Math.floor(date.getTime() / 1000);

class PayloadAdapter implements Adapter {
  constructor(
    private readonly db: AnyDb,
    private readonly kind: string,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number) {
    const row = {
      payload: payload as Record<string, unknown>,
      grantId: payload.grantId ?? null,
      uid: payload.uid ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
    await this.db
      .insert(oidcPayloads)
      .values({ id, kind: this.kind, ...row })
      .onConflictDoUpdate({ target: [oidcPayloads.id, oidcPayloads.kind], set: row });
  }

  private async findWhere(where: ReturnType<typeof and>) {
    const [row] = await this.db
      .select()
      .from(oidcPayloads)
      .where(and(eq(oidcPayloads.kind, this.kind), where, or(isNull(oidcPayloads.expiresAt), gt(oidcPayloads.expiresAt, new Date()))))
      .limit(1);
    if (!row) return undefined;
    return { ...row.payload, ...(row.consumedAt ? { consumed: epoch(row.consumedAt) } : {}) } as AdapterPayload;
  }

  find(id: string) {
    return this.findWhere(eq(oidcPayloads.id, id));
  }

  findByUid(uid: string) {
    return this.findWhere(eq(oidcPayloads.uid, uid));
  }

  async findByUserCode() {
    return undefined; // no device flow
  }

  async consume(id: string) {
    await this.db
      .update(oidcPayloads)
      .set({ consumedAt: new Date() })
      .where(and(eq(oidcPayloads.id, id), eq(oidcPayloads.kind, this.kind)));
  }

  async destroy(id: string) {
    await this.db.delete(oidcPayloads).where(and(eq(oidcPayloads.id, id), eq(oidcPayloads.kind, this.kind)));
  }

  /** Revoking a grant removes everything issued under it, whatever its kind (codes, access and refresh tokens). */
  async revokeByGrantId(grantId: string) {
    await this.db.delete(oidcPayloads).where(eq(oidcPayloads.grantId, grantId));
  }
}

class ClientAdapter implements Adapter {
  constructor(private readonly db: AnyDb) {}

  async find(clientId: string) {
    const [client] = await this.db.select().from(oidcClients).where(eq(oidcClients.clientId, clientId)).limit(1);
    if (!client) return undefined;
    return {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      post_logout_redirect_uris: client.postLogoutRedirectUris,
      subject_type: client.subjectType,
      // Browser apps: public clients with PKCE, code flow and refresh tokens only
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Pairwise subjects are derived from the sector (see provider.ts), not from a sector_identifier_uri document
      "urn:alma:sector": client.sectorIdentifier ?? client.clientId,
    } as AdapterPayload;
  }

  upsert(): Promise<void> {
    throw new Error("OIDC clients are registered in alma.oidc_clients, not through the provider");
  }
  findByUid = async () => undefined;
  findByUserCode = async () => undefined;
  consume = async () => {};
  destroy = async () => {};
  revokeByGrantId = async () => {};
}

export function createPostgresAdapter(db: AnyDb) {
  return function AlmaAdapter(kind: string): Adapter {
    return kind === "Client" ? new ClientAdapter(db) : new PayloadAdapter(db, kind);
  } as unknown as new (kind: string) => Adapter;
}

/** Deletes expired payloads; the provider ignores them anyway, this only keeps the table small. */
export async function pruneExpiredPayloads(db: AnyDb) {
  await db.delete(oidcPayloads).where(lt(oidcPayloads.expiresAt, new Date()));
}
