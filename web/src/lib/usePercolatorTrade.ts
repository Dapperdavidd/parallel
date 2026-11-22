"use client";

import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  associatedTokenAddress,
  deposit,
  initPortfolio,
  PERCOLATOR_PROGRAM_ID,
  PORTFOLIO_ACCOUNT_LEN,
} from "./percolator-client";

interface MarketConfig {
  code: string;
  id: string;
  marketAccount: string;
  collateralVault: string;
  acceptingPositions: boolean;
}

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const PORTFOLIO_DEPOSIT = 1_000_000_000n;

const bytesFromBase64 = (value: string): Uint8Array => {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
};

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encode Privy's binary Solana signature without pulling Node-only shims into the browser. */
const signatureToBase58 = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let encoded = "";
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i += 1) encoded += "1";
  for (let i = digits.length - 1; i >= 0; i -= 1) encoded += BASE58_ALPHABET[digits[i]];
  return encoded;
};

function usePercolatorTradeValue() {
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const send = useCallback(
    async (transaction: Uint8Array) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const result = await signAndSendTransaction({ transaction, wallet, chain: "solana:devnet" });
      const signature =
        typeof result === "object" && result !== null && "signature" in result
          ? (result as { signature: unknown }).signature
          : result;
      if (typeof signature === "string") return signature;
      if (signature instanceof Uint8Array) return signatureToBase58(signature);
      if (Array.isArray(signature)) return signatureToBase58(Uint8Array.from(signature));
      throw new Error("The wallet returned an unreadable transaction signature");
    },
    [wallets, signAndSendTransaction],
  );

  const ensurePortfolio = useCallback(
    async (market: MarketConfig, collateralMint: string): Promise<string> => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const owner = new PublicKey(wallet.address);
      const key = `parallel.portfolio.${market.id}.${wallet.address}`;
      const saved = localStorage.getItem(key);
      const connection = new Connection(RPC, "confirmed");
      if (saved && (await connection.getAccountInfo(new PublicKey(saved), "confirmed"))) return saved;

      const portfolio = Keypair.generate();
      const marketKey = new PublicKey(market.marketAccount);
      const mint = new PublicKey(collateralMint);
      const rent = await connection.getMinimumBalanceForRentExemption(PORTFOLIO_ACCOUNT_LEN);
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
        SystemProgram.createAccount({
          fromPubkey: owner,
          newAccountPubkey: portfolio.publicKey,
          lamports: rent,
          space: PORTFOLIO_ACCOUNT_LEN,
          programId: PERCOLATOR_PROGRAM_ID,
        }),
        initPortfolio(owner, marketKey, portfolio.publicKey),
        deposit(
          owner,
          marketKey,
          portfolio.publicKey,
          associatedTokenAddress(mint, owner),
          new PublicKey(market.collateralVault),
          PORTFOLIO_DEPOSIT,
        ),
      );
      transaction.feePayer = owner;
      transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      transaction.partialSign(portfolio);
      await send(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
      localStorage.setItem(key, portfolio.publicKey.toBase58());
      return portfolio.publicKey.toBase58();
    },
    [wallets, send],
  );

  // Returns the portfolio and market alongside the signature, because hedge
  // mode has to file its intent against the exact position it just opened.
  const openWithContext = useCallback(
    async (input: { code: string; side: "long" | "short"; marginUsdc: number; leverage: number }) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const marketResponse = await fetch("/api/markets", { cache: "no-store" });
      const marketBody = (await marketResponse.json()) as {
        markets: MarketConfig[];
        collateralMint: string | null;
      };
      const market = marketBody.markets.find((entry) => entry.code === input.code);
      if (!market || !marketBody.collateralMint) throw new Error("Market configuration is unavailable");
      if (!market.acceptingPositions) throw new Error("This market is paused");
      const portfolio = await ensurePortfolio(market, marketBody.collateralMint);

      const prepared = await fetch("/api/trade/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: wallet.address,
          portfolio,
          marketId: market.id,
          side: input.side,
          marginUsdc: input.marginUsdc,
          leverage: input.leverage,
        }),
      });
      const body = (await prepared.json()) as { transaction?: string; error?: string };
      if (!prepared.ok || !body.transaction) throw new Error(body.error ?? "Trade preparation failed");
      const signature = await send(bytesFromBase64(body.transaction));
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          wallet: wallet.address,
          portfolio,
          marketId: market.id,
          action: "open",
          leverage: input.leverage,
        }),
      }).catch(() => undefined);
      return { signature, portfolio, marketId: market.id };
    },
    [wallets, ensurePortfolio, send],
  );

  const open = useCallback(
    async (input: { code: string; side: "long" | "short"; marginUsdc: number; leverage: number }) =>
      (await openWithContext(input)).signature,
    [openWithContext],
  );

  /**
   * F9 — a hedge is a 1x long opened through the ordinary guarded path, plus
   * the intent filed against it. The position is real the moment Privy returns
   * a signature; if filing the intent then fails, the trade still happened, so
   * this reports `recorded: false` rather than claiming the hedge failed.
   */
  const hedge = useCallback(
    async (input: { code: string; amountLocal: number; marginUsdc: number; dueDate: string }) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const context = await openWithContext({
        code: input.code,
        side: "long",
        marginUsdc: input.marginUsdc,
        leverage: 1,
      });
      const recorded = await fetch("/api/hedge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature: context.signature,
          wallet: wallet.address,
          portfolio: context.portfolio,
          marketId: context.marketId,
          amountLocal: input.amountLocal,
          dueDate: input.dueDate,
        }),
      })
        .then((response) => response.ok)
        .catch(() => false);
      return { signature: context.signature, recorded };
    },
    [wallets, openWithContext],
  );

  const close = useCallback(
    async (input: { code: string; portfolio?: string }) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const marketResponse = await fetch("/api/markets", { cache: "no-store" });
      const marketBody = (await marketResponse.json()) as { markets: MarketConfig[] };
      const market = marketBody.markets.find((entry) => entry.code === input.code);
      if (!market) throw new Error("Market configuration is unavailable");
      // The portfolio page reads the real address off the chain, so it can pass
      // it in; a browser that opened the position has it in local storage. The
      // guarded route re-derives the close size either way, so neither source
      // is trusted for anything but *which* portfolio to read.
      const portfolio =
        input.portfolio ?? localStorage.getItem(`parallel.portfolio.${market.id}.${wallet.address}`);
      if (!portfolio) throw new Error("No on-chain portfolio was found for this market");

      const prepared = await fetch("/api/trade/close/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wallet.address, portfolio, marketId: market.id }),
      });
      const body = (await prepared.json()) as { transaction?: string; error?: string };
      if (!prepared.ok || !body.transaction) throw new Error(body.error ?? "Close preparation failed");
      const signature = await send(bytesFromBase64(body.transaction));
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          wallet: wallet.address,
          portfolio,
          marketId: market.id,
          action: "close",
          leverage: 1,
        }),
      }).catch(() => undefined);
      return signature;
    },
    [wallets, send],
  );

  return useMemo(() => ({ open, close, hedge }), [open, close, hedge]);
}

type PercolatorTrade = ReturnType<typeof usePercolatorTradeValue>;
const PercolatorTradeContext = createContext<PercolatorTrade | null>(null);

export function PercolatorTradeProvider({ children }: { children: ReactNode }) {
  const value = usePercolatorTradeValue();
  return createElement(PercolatorTradeContext.Provider, { value }, children);
}

export function usePercolatorTrade(): PercolatorTrade {
  const value = useContext(PercolatorTradeContext);
  if (!value) throw new Error("usePercolatorTrade must be used inside PercolatorTradeProvider");
  return value;
}
