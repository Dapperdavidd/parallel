"use client";

import { WalletProvider } from "@/lib/privy";
import { PercolatorTradeProvider } from "@/lib/usePercolatorTrade";
import { DemoProvider } from "@/lib/store";

/**
 * Everything that needs a wallet, in one wrapper — and only where a wallet is
 * needed.
 *
 * These three providers used to sit in the root layout, so the landing page
 * and every documentation page downloaded and booted the Privy SDK, the
 * Solana kit and the wallet connectors in order to render some prose. That is
 * most of the JavaScript on the site, shipped to the people least likely to
 * want it, on the connections least able to carry it.
 *
 * Only `/app` and `/signin` mount this. The landing page keeps the live price
 * provider, which it genuinely uses for the market table, and nothing else.
 */
export function WalletStack({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <PercolatorTradeProvider>
        <DemoProvider>{children}</DemoProvider>
      </PercolatorTradeProvider>
    </WalletProvider>
  );
}
