/**
 * Keeping a long-running service alive.
 *
 * The keeper is a loop that must still be running tomorrow. On 2026-11-23 it
 * died anyway: the laptop it runs on slept, every open socket was reset on
 * wake, and one of those rejections belonged to a promise nobody was awaiting
 * — Node's default for an unhandled rejection is to throw, so the process
 * exited and the index stopped. The web app went on serving the last tick it
 * had, which is why every market read as paused.
 *
 * Two things follow from that, and this module is both of them.
 *
 * 1. A network error must never end the process. Every *expected* failure is
 *    already handled where it happens — a source that will not answer pauses
 *    its market, a push that fails is logged and retried next pass. What is
 *    left is the unexpected: a socket belonging to a library's own internals.
 *    Staying up with a loud log line is strictly better than exiting, because
 *    the next pass is two minutes away and will re-establish everything.
 *
 * 2. A pass must be bounded. A suspended laptop can leave a fetch waiting far
 *    past its own timeout — one pass on the day above took 16.8 minutes
 *    against a two-minute cadence — and a loop that cannot finish a pass never
 *    starts the next one. A deadline turns a stuck pass into a late pass.
 */

const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const describe = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/**
 * Installs the process-level guards. Call once, at the top of a service's
 * `main()`, and only for a service that loops: a one-shot script should still
 * fail loudly and exit non-zero.
 */
export function stayAlive(label: string): void {
  let faults = 0;

  const note = (kind: string, err: unknown): void => {
    faults += 1;
    console.error(
      `${RED}${label}: ${kind} (#${faults})${OFF} ${describe(err)}\n` +
        `${DIM}  staying up — the next pass re-establishes everything${OFF}`,
    );
  };

  process.on("unhandledRejection", (reason) => note("unhandled rejection", reason));
  process.on("uncaughtException", (err) => note("uncaught exception", err));

  // A Solana websocket that dies emits an 'error' on the client, and some
  // paths surface it here rather than as a rejection.
  process.on("warning", (warning) => {
    if (warning.name === "MaxListenersExceededWarning") return; // noisy, harmless
    console.error(`${DIM}${label}: ${warning.name}: ${warning.message}${OFF}`);
  });
}

/**
 * Rejects if `work` has not settled within `ms`. The work itself keeps
 * running — there is no way to cancel a promise — so a late rejection from it
 * is silenced here, having already been reported as a missed deadline.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  void work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
    // Do not hold the event loop open on this timer alone.
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
