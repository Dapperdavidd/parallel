import { Buffer } from "buffer";
// @solana/web3.js reaches for a global Buffer in the browser.
globalThis.Buffer = globalThis.Buffer ?? Buffer;

import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { App } from "./App";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

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
    <Root />
  </React.StrictMode>,
);
