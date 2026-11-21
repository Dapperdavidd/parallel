"use client";

import { useCallback } from "react";
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

export function usePercolatorTrade() {
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const send = useCallback(
    async (transaction: Uint8Array) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Your Solana wallet is not ready");
      const result = await signAndSendTransaction({ transaction, wallet, chain: "solana:devnet" });
      return typeof result === "object" && result !== null && "signature" in result
        ? String((result as { signature: unknown }).signature)
        : String(result);
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

  const open = useCallback(
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
      return send(bytesFromBase64(body.transaction));
    },
    [wallets, ensurePortfolio, send],
  );

  return { open };
}
