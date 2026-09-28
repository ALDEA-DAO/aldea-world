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
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle mirror of drizzle/0000_init.sql. The SQL file is the source of
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

export const controllers = alma.table(
  "controllers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    almaId: text("alma_id").notNull().references(() => souls.almaId, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["evm", "cardano", "lightning"] }).notNull(),
    value: text("value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("private"),
    addedAt: tz("added_at").notNull().defaultNow(),
    revokedAt: tz("revoked_at"),
  },
  (t) => [unique().on(t.kind, t.value), index("controllers_alma_idx").on(t.almaId).where(sql`revoked_at IS NULL`)],
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

export const sessions = alma.table(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    controller: text("controller").notNull(),
    almaId: text("alma_id").references(() => souls.almaId),
    refreshHash: bytea("refresh_hash").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    rotatedFrom: uuid("rotated_from"),
    revokedAt: tz("revoked_at"),
    userAgent: text("user_agent"),
    ipHash: bytea("ip_hash"),
  },
  (t) => [index("sessions_controller_idx").on(t.controller).where(sql`revoked_at IS NULL`)],
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
