import "server-only";

import { randomBytes } from "node:crypto";

/**
 * What the server is allowed to run without.
 *
 * Parallel has two honest shapes. On a developer's machine it reads JSON files
 * out of `data/`, signs with the keypairs in `wallets/`, and nothing is at
 * stake. Deployed, it is a service holding a mint authority and thirteen
 * liquidity signers, and every one of those must come from the environment —
 * a deployment that quietly fell back to "no database, no secret, local
 * files" would look healthy while serving stale history and refusing writes,
 * which is exactly the failure that cost us two days in §7.18.
 *
 * So production declares its requirements here and the process refuses to
 * start without them. `instrumentation.ts` calls `assertServerEnv` once per
 * server boot, which is early enough to be a deploy failure rather than a
 * user-facing one.
 */

export type Mode = "development" | "production";

/** Production is anything not explicitly a local build. */
export function mode(): Mode {
  const declared = process.env.PARALLEL_ENV;
  if (declared === "development" || declared === "production") return declared;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export const isProduction = (): boolean => mode() === "production";

interface Requirement {
  /** Any one of these satisfies the requirement. */
  readonly keys: readonly string[];
  readonly why: string;
}

const REQUIREMENTS: readonly Requirement[] = [
  {
    keys: ["SUPABASE_URL"],
    why: "the index, trade history and hedges are read from Postgres in production, never from local files",
  },
  {
    keys: ["SUPABASE_SERVICE_ROLE_KEY"],
    why: "writes and the private hedges table belong to the service role; the anon key silently refuses both",
  },
  {
    keys: ["PARALLEL_APP_SECRET"],
    why: "signs the quote and challenge tokens that bind a prepared trade to the wallet that asked for it",
  },
  {
    keys: ["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"],
    why: "a named devnet endpoint, so the cluster is a deployment decision rather than a default",
  },
  {
    keys: ["NEXT_PUBLIC_PRIVY_APP_ID"],
    why: "without it the whole app renders a sign-in that cannot work",
  },
  {
    keys: ["PARALLEL_MINT_AUTHORITY_SECRET", "PARALLEL_MINT_AUTHORITY_FILE"],
    why: "the faucet's mint authority must be injected, not read out of the repository's wallets folder",
  },
  {
    keys: [
      "PARALLEL_SIGNER_URL",
      "PARALLEL_LIQUIDITY_SECRETS",
      "PARALLEL_LIQUIDITY_SECRETS_DIR",
    ],
    why: "trades need either the isolated signer service or explicitly injected local liquidity keys",
  },
];

/** Names of the variables production needs and this process does not have. */
export function missingProductionEnv(): { key: string; why: string }[] {
  const missing = REQUIREMENTS.filter(({ keys }) => keys.every((key) => !process.env[key])).map(
    ({ keys, why }) => ({ key: keys.join(" or "), why }),
  );
  if (process.env.PARALLEL_SIGNER_URL && !process.env.PARALLEL_SIGNER_SECRET) {
    missing.push({
      key: "PARALLEL_SIGNER_SECRET",
      why: "authenticates every request sent to the isolated signer service",
    });
  }
  return missing;
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

/**
 * Fail the boot, loudly, rather than the first request, quietly.
 *
 * Development is left alone on purpose: the file store and the `wallets/`
 * keypairs are the supported local configuration, not a degraded one.
 */
export function assertServerEnv(): void {
  if (!isProduction()) return;
  const missing = missingProductionEnv();
  if (missing.length === 0) return;
  const lines = missing.map(({ key, why }) => `  ${key}\n      ${why}`).join("\n");
  throw new EnvironmentError(
    `Parallel refuses to start in production without:\n${lines}\n\n` +
      "Set them in the deployment's environment — see .env.example.\n" +
      "Running a production build on your own machine on purpose? " +
      "PARALLEL_ENV=development says so, and local files and keypairs are used instead.",
  );
}

let cachedSecret: Buffer | undefined;

/**
 * The key behind every token this server signs.
 *
 * In production it is required, so there is no branch to get wrong. Locally a
 * random one is minted per process: tokens then die with a restart, which is
 * the correct and visible behaviour for a secret nobody configured.
 */
export function appSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const configured = process.env.PARALLEL_APP_SECRET;
  if (configured && configured.length >= 32) {
    cachedSecret = Buffer.from(configured, "utf8");
    return cachedSecret;
  }
  if (isProduction()) {
    throw new EnvironmentError("PARALLEL_APP_SECRET must be set, and at least 32 characters");
  }
  cachedSecret = randomBytes(32);
  return cachedSecret;
}

/** The devnet RPC, refusing anything that is not devnet. */
export function rpcUrl(): string {
  const url =
    process.env.SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  if (!/devnet/i.test(url)) {
    throw new EnvironmentError("Parallel runs on devnet only, and this RPC is not a devnet endpoint");
  }
  return url;
}
