"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { useDemo } from "@/lib/store";
import { useChainPortfolio } from "@/lib/useChainPortfolio";
import { useToast } from "./Toast";
import { SettingsMenu, LocaleMenu } from "./SettingsMenu";
import { fmt } from "@/lib/mock";

const TABS = [
  ["trade", "Trade"],
  ["markets", "Markets"],
  ["hedge", "Hedge"],
  ["portfolio", "Portfolio"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { signedIn, user, topUp, ready, fundingError, retryFunding } = useDemo();
  // The bar shows the wallet's real devnet balance, refreshed after a trade.
  const { walletBalance, snapshot, reload } = useChainPortfolio();
  const toast = useToast();
  const current = path.split("/")[2] ?? "trade";

  return (
    <div className="app">
      {/* A top-up that failed is the difference between a usable account and
          a balance of zero with no explanation. It used to be swallowed. */}
      {signedIn && fundingError && (
        <div className="app-banner" role="status">
          <span>
            Your devnet wallet could not be topped up. {fundingError}
          </span>
          <button type="button" className="closebtn" onClick={retryFunding}>
            Try again
          </button>
        </div>
      )}
      <div className="atop">
        {/* Inside the app the mark goes to the app's home, not the site. */}
        <Brand href="/app/trade" size={18} markSize={24} hideLabelOnSmall />

        <div className="atabs">
          {TABS.map(([slug, label]) => (
            <Link key={slug} href={`/app/${slug}`} className={slug === current ? "on" : undefined}>
              {label}
            </Link>
          ))}
        </div>

        <span className="grow" />

        {ready && signedIn && (
          <button
            type="button"
            className="btn btn-add"
            onClick={() => {
              void topUp()
                .then(async (amount) => {
                  await reload();
                  toast(amount > 0 ? `Added ${fmt(amount)} tUSDC from the devnet faucet` : "Devnet balance is already funded");
                })
                .catch((error: unknown) => toast(error instanceof Error ? error.message : "Devnet funding failed"));
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add money
          </button>
        )}

        <span className="chip hide-sm">Devnet</span>
        <LocaleMenu />
        <SettingsMenu />

        {!ready ? null : signedIn ? (
          /* The balance opens the portfolio. Signing out of a trading app by
             clicking your own balance is a trap. */
          <Link className="acct" href="/app/portfolio" title="Open portfolio">
            <span className="mono">{snapshot ? `${fmt(walletBalance)} tUSDC` : "—"}</span>
            <span style={{ color: "var(--ink3)" }} className="hide-sm">
              @{user}.parallel
            </span>
            <span className="av" />
          </Link>
        ) : (
          <Link href="/signin" className="btn btn-light" style={{ height: 38, padding: "0 16px", fontSize: 14 }}>
            Connect
          </Link>
        )}
      </div>

      <div id="main" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
