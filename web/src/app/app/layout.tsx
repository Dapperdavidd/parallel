import { AppShell } from "@/components/AppShell";
import { WalletStack } from "@/components/WalletStack";
import { ChainPortfolioProvider } from "@/lib/useChainPortfolio";

/**
 * Toasts and live prices come from the root layout; wallets start here.
 *
 * The chain-portfolio snapshot is mounted at this level rather than the root
 * for the same reason as the wallet stack: it should not be polling somebody's
 * accounts while they are reading the landing page.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletStack>
      <ChainPortfolioProvider>
        <AppShell>{children}</AppShell>
      </ChainPortfolioProvider>
    </WalletStack>
  );
}
