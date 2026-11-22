import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import fs from "fs";
import path from "path";
import { setStorage, MemoryStorageService } from "@/lib/storage";
import { setDb } from "@/lib/db";

export async function createTestDatabase() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  setDb(db as any);

  // Use in-memory storage fake for integration tests
  const memoryStorage = new MemoryStorageService("http://localhost:3000/api/public/assets");
  setStorage(memoryStorage);

  // Read and execute migrations in order
  const drizzleDir = path.join(process.cwd(), "drizzle");
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const sqlFile of sqlFiles) {
    const sqlContent = fs.readFileSync(path.join(drizzleDir, sqlFile), "utf-8");
    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await pglite.exec(statement);
      } catch (err: unknown) {
        console.warn("Migration statement warning in", sqlFile, statement.slice(0, 50), err);
      }
    }
  }

  return {
    db,
    pglite,
    storage: memoryStorage,
    close: async () => {
      await pglite.close();
    },
  };
}
