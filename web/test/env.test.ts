import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { missingProductionEnv } from "../src/lib/server/env";

const managed = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PARALLEL_APP_SECRET",
  "SOLANA_RPC_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PARALLEL_MINT_AUTHORITY_SECRET",
  "PARALLEL_SIGNER_URL",
  "PARALLEL_SIGNER_SECRET",
  "PARALLEL_LIQUIDITY_SECRETS",
  "PARALLEL_LIQUIDITY_SECRETS_DIR",
] as const;

const original = Object.fromEntries(managed.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of managed) delete process.env[name];
  process.env.SUPABASE_URL = "https://database.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.PARALLEL_APP_SECRET = "a-secret-that-is-long-enough-for-tests";
  process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "privy-test";
  process.env.PARALLEL_MINT_AUTHORITY_SECRET = "[]";
});

afterEach(() => {
  for (const name of managed) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("a remote signer satisfies the liquidity-key requirement", () => {
  process.env.PARALLEL_SIGNER_URL = "https://signer.test";
  process.env.PARALLEL_SIGNER_SECRET = "a-shared-secret-that-is-long-enough";
  assert.deepEqual(missingProductionEnv(), []);
});

test("a remote signer without its shared secret is refused", () => {
  process.env.PARALLEL_SIGNER_URL = "https://signer.test";
  assert.deepEqual(missingProductionEnv(), [
    {
      key: "PARALLEL_SIGNER_SECRET",
      why: "authenticates every request sent to the isolated signer service",
    },
  ]);
});

test("local liquidity secrets remain a valid production mode", () => {
  process.env.PARALLEL_LIQUIDITY_SECRETS = "{}";
  assert.deepEqual(missingProductionEnv(), []);
});
