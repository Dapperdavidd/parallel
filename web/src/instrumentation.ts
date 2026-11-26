/**
 * What runs once, before the first request.
 *
 * Next calls `register` on server start. It is the only place a missing
 * production secret can be turned into a failed deploy rather than a failed
 * trade: the alternative is a server that boots happily and then refuses every
 * write, which is how a database permission problem went unnoticed for two
 * days (DECISIONS.md §7.18).
 *
 * It must live in `src/`, beside `app/`. Next looks for it next to the app
 * directory, so a copy at the project root is simply never called — which is
 * silent, and exactly the kind of check that looks present and is not.
 */

export async function register(): Promise<void> {
  const { assertServerEnv, mode, missingProductionEnv } = await import("@/lib/server/env");
  const { failure, info, warn } = await import("@/lib/server/log");

  try {
    assertServerEnv();
    info({ event: "boot", mode: mode(), node: process.version });
  } catch (error) {
    failure({ event: "boot_refused", error });
    // Rethrowing is the point: a deployment missing its secrets must not
    // begin serving.
    throw error;
  }

  if (mode() !== "production") {
    const missing = missingProductionEnv();
    if (missing.length > 0) {
      warn({
        event: "development_defaults",
        detail: "running on local files and repository keypairs",
        wouldBeMissingInProduction: missing.map(({ key }) => key),
      });
    }
  }
}
