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

export function getStorage(): StorageService {
  if (activeStorage) return activeStorage;

  if (
    process.env.NODE_ENV === "test" ||
    process.env.USE_MEMORY_STORAGE === "true"
  ) {
    activeStorage = new MemoryStorageService();
  } else if (
    process.env.STORAGE_DRIVER === "r2"
  ) {
    activeStorage = new R2StorageService();
  } else {
    // Default to fast, local-first storage during creation and development
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
