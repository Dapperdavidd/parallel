/**
 * Links into the devnet explorer.
 *
 * Four screens were building this URL by hand, which is four places for the
 * `?cluster=devnet` to go missing — and a Solana explorer link without it
 * silently shows mainnet, where the signature does not exist. So it lives
 * here, with the cluster baked in.
 */

const BASE = "https://explorer.solana.com";
const CLUSTER = "cluster=devnet";

export const explorerTx = (signature: string): string =>
  `${BASE}/tx/${signature}?${CLUSTER}`;

export const explorerAddress = (address: string): string =>
  `${BASE}/address/${address}?${CLUSTER}`;

/** Enough of a signature to recognise, in a line of text. */
export const shortSignature = (signature: string): string =>
  signature.length > 16 ? `${signature.slice(0, 8)}…${signature.slice(-6)}` : signature;
