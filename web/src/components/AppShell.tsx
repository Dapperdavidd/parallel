"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { useDemo } from "@/lib/store";
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
  const { signedIn, user, balance, signOut, topUp, ready } = useDemo();
  const toast = useToast();
  const current = path.split("/")[2] ?? "trade";

  return (
    <div className="app">
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
              const amount = topUp();
              toast(`Added ${fmt(amount)} tUSDC from the devnet faucet`);
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
          <button
            className="acct"
            type="button"
            title="Sign out"
            onClick={() => {
              signOut();
              toast("Signed out");
            }}
          >
            <span className="mono">{fmt(balance)} tUSDC</span>
            <span style={{ color: "var(--ink3)" }} className="hide-sm">
              @{user}.parallel
            </span>
            <span className="av" />
          </button>
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
