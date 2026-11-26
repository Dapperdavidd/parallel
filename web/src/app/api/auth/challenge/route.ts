import { issueChallenge } from "@/lib/server/wallet-proof";
import { CEILINGS, readJson, route } from "@/lib/server/request";
import { ok } from "@/lib/server/respond";
import { address, oneOf, shape } from "@/lib/server/validate";

/**
 * Ask for something to sign.
 *
 * Step one of proving a wallet is yours: the server hands back a short-lived
 * challenge and a token that lets it rebuild that exact challenge later. No
 * state is stored, and the challenge is worthless to anyone who cannot sign
 * for the address inside it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = shape({
  wallet: address(),
  purpose: oneOf(["faucet"] as const),
});

export const POST = route(
  "auth/challenge",
  { ceiling: CEILINGS.challenge },
  async ({ request }) => {
    const { wallet, purpose } = await readJson(request, body);
    return ok(issueChallenge(wallet, purpose));
  },
);
