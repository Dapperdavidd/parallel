"use client";

import { Buffer } from "buffer";
import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

if (typeof window !== "undefined") {
  globalThis.Buffer = globalThis.Buffer ?? Buffer;
}

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace(/^http/, "ws");

class WalletErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main id="main" style={{ padding: 32 }}>
        <h1>Wallet connection failed</h1>
        <p style={{ color: "var(--ink2)" }}>{this.state.error.message}</p>
        <button className="btn btn-pri" type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </main>
    );
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!APP_ID) {
    return (
      <main id="main" style={{ padding: 32 }}>
        <h1>Wallet sign-in is not configured</h1>
        <p style={{ color: "var(--ink2)" }}>NEXT_PUBLIC_PRIVY_APP_ID is missing.</p>
      </main>
    );
  }

  return (
    <WalletErrorBoundary>
      <PrivyProvider
        appId={APP_ID}
        config={{
          loginMethods: ["email"],
          embeddedWallets: {
            solana: { createOnLogin: "users-without-wallets" },
            // Headless signing for the embedded wallet.
            //
            // Parallel asks the wallet to sign three things: a trade, a close,
            // and a short ownership challenge before the faucet will fund it.
            // With the confirmation modal on, every one of those is a dialog
            // the person must dismiss — including the one that fires
            // automatically on first sign-in, which reads as the app breaking
            // rather than as a security step. The embedded wallet is created
            // by and for this app on devnet, so the app is the right place for
            // the confirmation, and the ticket shows it before anything is
            // sent. An external wallet still shows its own prompt, which is
            // correct: that key is not ours.
            showWalletUIs: false,
          },
          solana: {
            rpcs: {
              "solana:devnet": {
                rpc: createSolanaRpc(RPC_URL),
                rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL),
                blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
              },
            },
          },
          externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
          appearance: { theme: "dark", accentColor: "#C8F04A" },
        }}
      >
        {children}
      </PrivyProvider>
    </WalletErrorBoundary>
  );
}
