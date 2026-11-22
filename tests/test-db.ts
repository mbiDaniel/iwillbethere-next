import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import fs from "fs";
import path from "path";
import { setStorage, MemoryStorageService } from "@/lib/storage";
import { setDb } from "@/lib/db";

export async function createTestDatabase() {
  const pglite = new PGlite();

  try {
    const db = drizzle(pglite, { schema });
    setDb(db as any);

    const memoryStorage = new MemoryStorageService("http://localhost:3000/api/public/assets");
    setStorage(memoryStorage);

    const drizzleDir = path.join(process.cwd(), "drizzle");
    const sqlFiles = fs
      .readdirSync(drizzleDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const sqlFile of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(drizzleDir, sqlFile), "utf-8");
      const statements = sqlContent
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await pglite.exec(statement);
      }
    }

    return {
      db,
      pglite,
      storage: memoryStorage,
      close: () => pglite.close(),
    };
  } catch (error) {
    await pglite.close();
    throw error;
  }
}
