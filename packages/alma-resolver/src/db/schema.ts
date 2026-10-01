import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle mirror of drizzle/*.sql. The SQL files are the source of
 * truth for migrations; keep both in sync. CHECK constraints live in the SQL only.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const alma = pgSchema("alma");

export const souls = alma.table(
  "souls",
  {
    almaId: text("alma_id").primaryKey(),
    almaIdHash: bytea("alma_id_hash").notNull().unique(),
    subjectType: text("subject_type", { enum: ["human", "org", "agent"] }).notNull(),
    status: text("status", { enum: ["prepared", "anchored", "active", "revoked"] }).notNull().default("prepared"),
    doc: jsonb("doc").notNull(),
    docHash: bytea("doc_hash").notNull(),
    publicProfile: jsonb("public_profile").notNull().default(sql`'{}'::jsonb`),
    anchoredTx: text("anchored_tx"),
    anchoredBlock: bigint("anchored_block", { mode: "bigint" }),
    anchoredAt: tz("anchored_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("souls_status_idx").on(t.status)],
);

export const bindings = alma.table(
  "bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    almaId: text("alma_id").notNull().references(() => souls.almaId, { onDelete: "cascade" }),
    type: text("type", { enum: ["aldea-world:character", "erc8004", "endpoint", "world"] }).notNull(),
    value: text("value").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("public"),
    evidence: jsonb("evidence"),
    createdAt: tz("created_at").notNull().defaultNow(),
    revokedAt: tz("revoked_at"),
  },
  (t) => [unique().on(t.type, t.value), index("bindings_alma_idx").on(t.almaId).where(sql`revoked_at IS NULL`)],
);

export const relationships = alma.table(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromAlmaId: text("from_alma_id").notNull().references(() => souls.almaId),
    toAlmaId: text("to_alma_id").notNull().references(() => souls.almaId),
    type: text("type", {
      enum: ["owns", "represents", "delegates", "operates", "member_of", "hired", "paid", "transacted_with"],
    }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    revokedAt: tz("revoked_at"),
    revokedBy: text("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    unique().on(t.fromAlmaId, t.toAlmaId, t.type),
    index("rel_to_type_idx").on(t.toAlmaId, t.type).where(sql`revoked_at IS NULL`),
    index("rel_from_idx").on(t.fromAlmaId).where(sql`revoked_at IS NULL`),
  ],
);

export const authNonces = alma.table(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    issuedAt: tz("issued_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

export const cardanoLinkChallenges = alma.table("cardano_link_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  almaId: text("alma_id").notNull().references(() => souls.almaId),
  payload: text("payload").notNull(),
  expiresAt: tz("expires_at").notNull(),
  usedAt: tz("used_at"),
});

export const founderAttestations = alma.table("founder_attestations", {
  digest: bytea("digest").primaryKey(),
  almaId: text("alma_id").notNull().references(() => souls.almaId),
  ownerAddress: text("owner_address").notNull(),
  stakeCredential: bytea("stake_credential").notNull(),
  aldeaBalance: numeric("aldea_balance", { precision: 38, scale: 0 }).notNull(),
  snapshotSlot: bigint("snapshot_slot", { mode: "bigint" }).notNull(),
  nonce: bytea("nonce").notNull(),
  deadline: tz("deadline").notNull(),
  signature: bytea("signature").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const waitlist = alma.table(
  "waitlist",
  {
    almaId: text("alma_id").notNull().references(() => souls.almaId),
    building: text("building", { enum: ["npc_forge", "velum_archive", "soul_registry_agents"] }).notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.almaId, t.building] })],
);

// ALMA Auth (drizzle/0001_alma_auth.sql)

export const linkKinds = ["passkey", "email", "google", "apple", "evm", "cardano", "midnight", "bitcoin", "lightning"] as const;
export const linkRoles = ["login", "controller", "holdings"] as const;

export const links = alma.table(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    almaId: text("alma_id").notNull().references(() => souls.almaId, { onDelete: "cascade" }),
    kind: text("kind", { enum: linkKinds }).notNull(),
    value: text("value").notNull(),
    roles: text("roles", { enum: linkRoles }).array().notNull(),
    proof: jsonb("proof").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("private"),
    label: text("label"),
    lastUsedAt: tz("last_used_at"),
    addedAt: tz("added_at").notNull().defaultNow(),
    revokedAt: tz("revoked_at"),
  },
  (t) => [unique().on(t.kind, t.value), index("links_alma_idx").on(t.almaId).where(sql`revoked_at IS NULL`)],
);

export const passkeyCredentials = alma.table("passkey_credentials", {
  credentialId: text("credential_id").primaryKey(),
  linkId: uuid("link_id").notNull().references(() => links.id, { onDelete: "cascade" }),
  publicKey: bytea("public_key").notNull(),
  signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
  transports: text("transports").array(),
  backedUp: boolean("backed_up").notNull().default(false),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const emailCodes = alma.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHmac: bytea("email_hmac").notNull(),
    codeHash: bytea("code_hash").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("email_codes_hmac_idx").on(t.emailHmac, t.createdAt.desc())],
);

export const oidcClients = alma.table("oidc_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array().notNull().default(sql`'{}'`),
  subjectType: text("subject_type", { enum: ["public", "pairwise"] }).notNull().default("public"),
  sectorIdentifier: text("sector_identifier"),
  ownerAlmaId: text("owner_alma_id").references(() => souls.almaId),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const oidcPayloads = alma.table(
  "oidc_payloads",
  {
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    grantId: text("grant_id"),
    uid: text("uid"),
    expiresAt: tz("expires_at"),
    consumedAt: tz("consumed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.kind] }),
    index("oidc_payloads_grant").on(t.grantId),
    index("oidc_payloads_uid").on(t.uid),
    index("oidc_payloads_expires").on(t.expiresAt),
  ],
);

export const soulMerges = alma.table("soul_merges", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromAlmaId: text("from_alma_id").notNull().references(() => souls.almaId),
  intoAlmaId: text("into_alma_id").notNull().references(() => souls.almaId),
  proofs: jsonb("proofs").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const custody = alma.table("custody", {
  almaId: text("alma_id").primaryKey().references(() => souls.almaId, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["turnkey"] }).notNull().default("turnkey"),
  subOrganizationId: text("sub_organization_id").notNull().unique(),
  walletId: text("wallet_id").notNull(),
  ownerAddress: text("owner_address").notNull(),
  smartAccountAddress: text("smart_account_address").notNull().unique(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

// drizzle/0002_sync_state.sql
export const syncState = alma.table("sync_state", {
  key: text("key").primaryKey(),
  since: bigint("since", { mode: "number" }).notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});
