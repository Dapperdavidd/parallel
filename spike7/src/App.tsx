/**
 * SPIKE 7 — a Privy embedded Solana wallet holds mock USDC and signs a
 * Percolator instruction on devnet.
 *
 * Deliberately a bare test page, not the Phase 2 UI. It answers one question:
 * can a wallet created from an email sign-in actually drive the perps engine?
 *
 * The flow:
 *   1. sign in with email  -> Privy creates an embedded Solana wallet
 *   2. `npm run spike7:fund <address>` gives it devnet SOL and mock USDC
 *   3. "Open a Percolator account" sends createAccount + InitPortfolio +
 *      Deposit, signed by the embedded wallet
 */

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  ixDeposit,
  ixInitPortfolio,
  vaultAuthority,
  PERCOLATOR_PROGRAM_ID,
  PORTFOLIO_ACCOUNT_LEN,
  PORTFOLIO_STATE_OFF,
  PA_CAPITAL,
  readU128,
} from "./percolator-web";

interface DevnetConfig {
  rpc: string;
  market: string;
  collateralMint: string;
}

const LIME = "#C8F04A";
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

/** Associated token address, derived without pulling in @solana/spl-token. */
function ataFor(mint: PublicKey, owner: PublicKey): PublicKey {
  const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN.toBytes(), mint.toBytes()],
    ATA,
  )[0];
}

export function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [cfg, setCfg] = useState<DevnetConfig | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [capital, setCapital] = useState<bigint | null>(null);
  const [portfolio, setPortfolio] = useState<string | null>(
    () => localStorage.getItem("spike7.portfolio"),
  );
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const say = useCallback((line: string) => setLog((l) => [...l, line]), []);

  const wallet = wallets[0];
  const address = wallet?.address ?? null;

  useEffect(() => {
    fetch("/devnet.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCfg)
      .catch(() =>
        say("devnet.json not found — run `npm run spike7:fund <address>` once to generate it"),
      );
  }, [say]);

  const refresh = useCallback(async () => {
    if (!cfg || !address) return;
    const conn = new Connection(cfg.rpc, "confirmed");
    const owner = new PublicKey(address);
    try {
      setSol((await conn.getBalance(owner)) / 1e9);
      const ata = ataFor(new PublicKey(cfg.collateralMint), owner);
      const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
      setUsdc(bal ? Number(bal.value.amount) / 1e6 : 0);
      if (portfolio) {
        const info = await conn.getAccountInfo(new PublicKey(portfolio));
        setCapital(
          info ? readU128(new Uint8Array(info.data), PORTFOLIO_STATE_OFF + PA_CAPITAL) : null,
        );
      }
    } catch (e) {
      say(`balance read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [cfg, address, portfolio, say]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAccount = useCallback(async () => {
    if (!cfg || !wallet || !address) return;
    setBusy(true);
    try {
      const conn = new Connection(cfg.rpc, "confirmed");
      const owner = new PublicKey(address);
      const market = new PublicKey(cfg.market);
      const mint = new PublicKey(cfg.collateralMint);

      // The portfolio lives in its own account. We generate it here and
      // co-sign with it, then hand the partially signed transaction to Privy
      // so the embedded wallet adds the owner signature.
      const pf = Keypair.generate();
      const rent = await conn.getMinimumBalanceForRentExemption(PORTFOLIO_ACCOUNT_LEN);
      const ownerAta = ataFor(mint, owner);
      const vaultAta = ataFor(mint, vaultAuthority(market));

      say(`portfolio ${pf.publicKey.toBase58()} (rent ${(rent / 1e9).toFixed(4)} SOL)`);

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
      tx.add(ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }));
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: owner,
          newAccountPubkey: pf.publicKey,
          lamports: rent,
          space: PORTFOLIO_ACCOUNT_LEN,
          programId: PERCOLATOR_PROGRAM_ID,
        }),
      );
      tx.add(ixInitPortfolio(owner, market, pf.publicKey));
      tx.add(ixDeposit(owner, market, pf.publicKey, ownerAta, vaultAta, 1_000_000_000n));

      tx.feePayer = owner;
      tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
      tx.partialSign(pf);

      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

      say("asking the embedded wallet to sign…");
      const res = await signAndSendTransaction({
        transaction: new Uint8Array(bytes),
        wallet,
        chain: "solana:devnet",
      });

      const sig =
        typeof res === "object" && res !== null && "signature" in res
          ? String((res as { signature: unknown }).signature)
          : String(res);
      say(`✓ sent: ${sig}`);
      localStorage.setItem("spike7.portfolio", pf.publicKey.toBase58());
      setPortfolio(pf.publicKey.toBase58());
      setTimeout(() => void refresh(), 4000);
    } catch (e) {
      say(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [cfg, wallet, address, signAndSendTransaction, say, refresh]);

  if (!ready) return <Shell><p>loading…</p></Shell>;

  return (
    <Shell>
      <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Parallel — spike 7</h1>
      <p style={{ margin: "0 0 24px", opacity: 0.6, fontSize: 13 }}>
        Can an email sign-in wallet hold mock USDC and drive Percolator on devnet?
      </p>

      {!authenticated ? (
        <button onClick={login} style={btn}>Sign in with email</button>
      ) : (
        <>
          <Row label="signed in as" value={user?.email?.address ?? user?.id ?? "—"} />
          <Row label="solana wallet" value={address ?? "creating…"} />
          <Row label="devnet SOL" value={sol === null ? "—" : sol.toFixed(4)} />
          <Row
            label="mock USDC"
            value={usdc === null ? "—" : usdc.toLocaleString("en-US")}
            accent={!!usdc}
          />
          <Row
            label="percolator capital"
            value={capital === null ? "—" : `${(Number(capital) / 1e6).toLocaleString("en-US")} USDC`}
            accent={!!capital}
          />

          {address && !usdc ? (
            <div style={note}>
              This wallet is empty. In the project root run:
              <pre style={pre}>npm run spike7:fund {address}</pre>
              then reload.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button onClick={() => void refresh()} style={btnGhost}>Refresh</button>
            <button
              onClick={() => void openAccount()}
              disabled={busy || !cfg || !usdc}
              style={{ ...btn, opacity: busy || !cfg || !usdc ? 0.4 : 1 }}
            >
              {busy ? "signing…" : "Open a Percolator account (deposit 1,000)"}
            </button>
            <button onClick={logout} style={btnGhost}>Sign out</button>
          </div>
        </>
      )}

      {log.length > 0 && (
        <pre style={{ ...pre, marginTop: 24, maxHeight: 260, overflow: "auto" }}>
          {log.join("\n")}
        </pre>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...mono, background: "#0B0B0B", color: "#EDEDED", minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid #1d1d1d", fontSize: 13 }}>
      <span style={{ opacity: 0.5, width: 150, flexShrink: 0 }}>{label}</span>
      <span style={{ wordBreak: "break-all", color: accent ? LIME : undefined }}>{value}</span>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: LIME, color: "#0B0B0B", border: "none", padding: "11px 18px",
  borderRadius: 8, fontWeight: 600, cursor: "pointer", ...mono, fontSize: 13,
};
const btnGhost: React.CSSProperties = {
  background: "transparent", color: "#EDEDED", border: "1px solid #333",
  padding: "11px 18px", borderRadius: 8, cursor: "pointer", ...mono, fontSize: 13,
};
const note: React.CSSProperties = {
  marginTop: 20, padding: 14, border: "1px solid #333", borderRadius: 8,
  fontSize: 13, lineHeight: 1.6,
};
const pre: React.CSSProperties = {
  background: "#151515", padding: 12, borderRadius: 6, overflow: "auto",
  fontSize: 12, margin: "8px 0 0",
};
