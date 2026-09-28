import { defineConfig } from "drizzle-kit";

// drizzle/0000_init.sql is written by hand; use `drizzle-kit check` or `generate` for later migrations.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["alma"],
  migrations: { schema: "alma" },
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://aldea:aldea@localhost:5442/aldea" },
});
