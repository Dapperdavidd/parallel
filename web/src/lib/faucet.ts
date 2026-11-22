/**
 * What the devnet faucet tops a new wallet up to.
 *
 * One constant, imported by both the faucet route that enforces it and the
 * sign-in copy that promises it, because a promise of "10,000 test dollars"
 * beside a wallet that receives 5,000 is the kind of small lie that costs
 * trust for nothing. Change it here and both move together.
 */
export const FAUCET_USDC_TARGET = 5_000;
export const FAUCET_USDC_TARGET_ATOMS = BigInt(FAUCET_USDC_TARGET) * 1_000_000n;
