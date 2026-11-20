import { Buffer } from "buffer";
// @solana/web3.js reaches for a global Buffer in the browser.
globalThis.Buffer = globalThis.Buffer ?? Buffer;

import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { App } from "./App";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
const RPC_URL =
  (import.meta.env.VITE_SOLANA_RPC as string | undefined) ?? "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace(/^http/, "ws");

/**
 * Without an error boundary a thrown error unmounts the whole tree and leaves a
 * blank white page with nothing to go on. That happened once already (the cause
 * was the missing `solana.rpcs` config below), so the failure is now visible
 * on the page instead of only in the browser console.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          background: "#0B0B0B",
          color: "#EDEDED",
          minHeight: "100vh",
          padding: 32,
        }}
      >
        <h2 style={{ color: "#ff6b6b", marginTop: 0 }}>The page crashed</h2>
        <pre
          style={{
            background: "#151515",
            padding: 14,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            background: "#C8F04A",
            border: "none",
            padding: "10px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

function Root() {
  if (!APP_ID) {
    return (
      <div style={{ fontFamily: "ui-monospace, monospace", padding: 32, color: "#c33" }}>
        <h2>VITE_PRIVY_APP_ID is not set</h2>
        <p>
          Create <code>spike7/.env.local</code> containing:
        </p>
        <pre>VITE_PRIVY_APP_ID=your-privy-app-id</pre>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // PRD F4: email sign-in, wallet created for the user automatically.
        loginMethods: ["email"],
        embeddedWallets: {
          // Verified against @privy-io/react-auth 3.52.0 type declarations.
          // The docs also describe `embedded.solana.createOnLogin`; that path
          // does not exist in this version.
          solana: { createOnLogin: "users-without-wallets" },
        },
        // REQUIRED for the embedded-wallet signing hooks. Without it,
        // signAndSendTransaction throws "No RPC configuration found for chain
        // solana:devnet" and takes the whole React tree down with it.
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL),
              blockExplorerUrl: "https://explorer.solana.com",
            },
          },
        },
        // The dashboard has Solana wallet login enabled, so Privy expects
        // connectors even though this spike only uses the embedded wallet.
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        appearance: {
          theme: "dark",
          accentColor: "#C8F04A", // the PRD's lime, used where money moves
          logo: undefined,
        },
      }}
    >
      <App />
    </PrivyProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
