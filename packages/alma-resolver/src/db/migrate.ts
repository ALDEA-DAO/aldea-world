import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, client } = createDb(url);
await migrate(db, {
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "../../drizzle"),
  migrationsSchema: "alma",
});
await client.end();
console.log("alma-resolver: migrations applied");
