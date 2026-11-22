/**
 * Which way round "long" is — the one place that knows.
 *
 * This is the single most confusable thing in the codebase, so it lives in one
 * module and every other file derives from it.
 *
 * **The engine trades the local currency, priced in dollars.** A contract is a
 * bundle of local currency (1,000 NGN, 10 ZAR …) and the mark we push is
 * `unitSize / streetRate` — USD per bundle (§3.5, §3.11). So the engine's
 * `basisPosQ` is a position *in naira*, and a positive one gains when the
 * dollar price of naira rises, which is when the naira **strengthens**.
 *
 * **The product means the opposite by "long".** Every screen and every doc page
 * says the same thing — "Long USD wins if the naira gets weaker" — and hedge
 * mode depends on it: someone holding naira who turns on a hedge must gain when
 * the naira falls, or the feature does the reverse of its promise.
 *
 * Therefore **a user-facing long is an engine short**:
 *
 * ```
 *   UI "long USD/NGN"   →  basisPosQ < 0   →  gains as the naira weakens
 *   UI "short USD/NGN"  →  basisPosQ > 0   →  gains as the naira strengthens
 * ```
 *
 * Confirmed on-chain rather than reasoned about: `spike4-liquidation.ts` opens
 * a positive `sizeQ` "LONG kNGN", pushes the mark **down** as its adverse move,
 * and that position liquidates (DECISIONS.md §7.10). A falling USD-per-bundle
 * mark is a weakening naira, so engine-positive loses when the naira weakens.
 *
 * Everything above the engine boundary — stored trade records, the portfolio
 * API, the vault page, realised P&L — speaks the **user-facing** convention.
 * Only `sizeQ` on the wire is in engine terms.
 */

export type Side = "long" | "short";

/** The sign `basisPosQ` must carry to express a user-facing side. */
export function engineSign(side: Side): bigint {
  return side === "long" ? -1n : 1n;
}

/** A signed engine position, read back as the side the user was shown. */
export function sideOf(basisPosQ: bigint): Side {
  return basisPosQ < 0n ? "long" : "short";
}

/**
 * The multiplier that turns an engine price move into a user-facing P&L.
 *
 * Engine P&L is `sizeQ × (exit − entry)`. In notional terms that is
 * `notional × (exit/entry − 1)` scaled by the sign of `sizeQ`, which for a
 * user-facing long is negative.
 */
export function pnlSign(side: Side): number {
  return side === "long" ? -1 : 1;
}
