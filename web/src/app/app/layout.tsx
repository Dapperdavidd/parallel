import { AppShell } from "@/components/AppShell";
import { ChainPortfolioProvider } from "@/lib/useChainPortfolio";

/**
 * The demo store and toasts live in the root layout, shared with /signin.
 *
 * The chain-portfolio snapshot is mounted here rather than at the root: it is
 * only read inside the app, and it should not be polling a wallet's accounts
 * while someone is reading the landing page.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChainPortfolioProvider>
      <AppShell>{children}</AppShell>
    </ChainPortfolioProvider>
  );
}
