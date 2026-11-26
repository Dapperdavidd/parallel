import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A link from the public site into the app, which does not prefetch.
 *
 * Next fetches a linked route's JavaScript as soon as the link enters the
 * viewport. The app routes carry the Privy SDK, the Solana kit and the wallet
 * connectors — around half a megabyte — and the public pages are full of
 * links into them: the hero, every row of the market table, every market on
 * the status page, the footer.
 *
 * So a visitor reading the landing page downloaded the whole trading
 * application several times over, before deciding whether they wanted it.
 * On the connections this product exists for, that is the page budget spent
 * on a navigation that may never happen.
 *
 * Inside `/app` the ordinary `Link` is right: those chunks are already loaded
 * and prefetching costs nothing.
 */
export function AppLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={false} />;
}
