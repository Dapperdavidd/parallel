import "server-only";

import { consume, open, sign } from "./tokens";
import { Rejection } from "./respond";

/**
 * The server's own arithmetic, carried from the quote to the record.
 *
 * `/api/trades` used to store the leverage the browser said it had used, and
 * `/api/hedge` trusted a client-supplied amount against a position it had only
 * partly checked. Neither is the client's to assert: the server computed the
 * size, read the price and applied the market's leverage cap moments earlier.
 *
 * So the prepare routes mint a signed quote holding exactly what they decided,
 * and the record route reads its numbers out of that quote. The transaction is
 * still verified on devnet independently — the quote says what we intended,
 * the chain says what happened, and a row is only written when the two agree.
 *
 * The quote also puts a clock on the price. A prepared transaction already
 * dies with its blockhash, but nothing used to *say* so, which is how a
 * terminal ends up showing a fill price from four minutes ago.
 */

const KIND = "trade-quote";

/** A little under a blockhash's life, so the quote expires first and says why. */
export const QUOTE_TTL_MS = 75_000;

export interface QuotePayload {
  readonly action: "open" | "close";
  readonly marketId: string;
  readonly wallet: string;
  readonly portfolio: string;
  readonly side: "long" | "short";
  readonly leverage: number;
  readonly marginUsdc: number;
  readonly notionalUsdc: number;
  /** Signed engine size, as a decimal string. */
  readonly sizeQ: string;
  readonly priceE6: string;
}

export const issueQuote = (payload: QuotePayload): string => sign(KIND, payload, QUOTE_TTL_MS);

export interface HeldQuote {
  readonly payload: QuotePayload;
  /** Call once the record has been written; a second call fails. */
  readonly spend: () => void;
}

/**
 * Open a quote, or reject it.
 *
 * The nonce is not spent here: a quote is only used up once the row it
 * describes is actually stored, so a verification that fails for an unrelated
 * reason leaves the caller able to retry with the same quote.
 */
export function holdQuote(token: string): HeldQuote {
  const { payload, nonce } = open<QuotePayload>(KIND, token);
  return {
    payload,
    spend: () => {
      if (!consume(nonce, QUOTE_TTL_MS)) {
        throw new Rejection("conflict", "This quote has already been filed");
      }
    },
  };
}
