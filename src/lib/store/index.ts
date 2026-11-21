/**
 * Pick a store from the environment.
 *
 * Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set,
 * otherwise JSON files under `data/`. Nothing above this line needs to know
 * which one it got, which is the point: the index service and keeper run
 * today, and gain a database by gaining two environment variables.
 */

import { FileStore } from "./file-store.js";
import { SupabaseStore } from "./supabase-store.js";
import type { Store } from "./types.js";

export * from "./types.js";
export { FileStore } from "./file-store.js";
export { SupabaseStore } from "./supabase-store.js";

export function openStore(): Store {
  return SupabaseStore.fromEnv() ?? new FileStore(process.env.PARALLEL_DATA_DIR ?? "data");
}
