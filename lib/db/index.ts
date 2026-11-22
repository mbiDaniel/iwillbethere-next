import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { env } from "@/lib/env";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: pg.Pool | undefined;
}

export function createPool(connectionString: string = env.DATABASE_URL): pg.Pool {
  const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

  return new Pool({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 20 : 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}

export const pool = globalThis.__dbPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.__dbPool = pool;
}

export let db = drizzle(pool, { schema });
export type Database = typeof db;

export function setDb(overrideDb: typeof db) {
  db = overrideDb;
}
