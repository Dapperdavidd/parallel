"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { useDemo } from "@/lib/store";
import { useToast } from "./Toast";
import { fmt } from "@/lib/mock";

const TABS = [
  ["trade", "Trade"],
  ["markets", "Markets"],
  ["hedge", "Hedge"],
  ["portfolio", "Portfolio"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { signedIn, user, balance, signOut, ready } = useDemo();
  const toast = useToast();
  const current = path.split("/")[2] ?? "trade";

  return (
    <div className="app">
      <div className="atop">
        <Brand href="/" size={18} markSize={24} hideLabelOnSmall />
        <div className="atabs">
          {TABS.map(([slug, label]) => (
            <Link
              key={slug}
              href={`/app/${slug}`}
              className={slug === current ? "on" : undefined}
            >
              {label}
            </Link>
          ))}
        </div>
        <span className="grow" />
        <span className="chip">Devnet · mainnet soon</span>
        <div>
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
            <Link
              href="/signin"
              className="btn btn-light"
              style={{ height: 40, padding: "0 18px", fontSize: 14 }}
            >
              Sign in / Sign up
            </Link>
          )}
        </div>
      </div>
      <div id="main" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
