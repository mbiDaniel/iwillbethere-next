import { StorageService } from "./types";
import { R2StorageService } from "./r2";
import { MemoryStorageService } from "./memory";
import { LocalStorageService } from "./local";
import { env } from "@/lib/env";

export * from "./types";
export * from "./r2";
export * from "./memory";
export * from "./local";

let activeStorage: StorageService | null = null;

export function getStorageDriver(
  nodeEnv = process.env.NODE_ENV,
  useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true"
): "memory" | "local" | "r2" {
  if (nodeEnv === "test" || (nodeEnv !== "production" && useMemoryStorage)) {
    return "memory";
  }
  return nodeEnv === "production" ? "r2" : "local";
}

export function getStorage(): StorageService {
  if (activeStorage) return activeStorage;

  const driver = getStorageDriver();
  if (driver === "memory") {
    activeStorage = new MemoryStorageService();
  } else if (driver === "r2") {
    activeStorage = new R2StorageService();
  } else {
    activeStorage = new LocalStorageService();
  }

  return activeStorage;
}

export function setStorage(storage: StorageService) {
  activeStorage = storage;
}

export const storage: StorageService = new Proxy({} as StorageService, {
  get(_target, prop) {
    const s = getStorage();
    const val = (s as any)[prop];
    return typeof val === "function" ? val.bind(s) : val;
  },
});
