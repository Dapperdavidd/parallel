/** Print the devnet balance of every wallet in wallets/. */
import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync, readdirSync } from "node:fs";

const conn = new Connection(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  "confirmed",
);

for (const file of readdirSync("wallets").filter((f) => f.endsWith(".json"))) {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`wallets/${file}`, "utf8")) as number[]),
  );
  const sol = (await conn.getBalance(kp.publicKey)) / 1e9;
  console.log(`${file.replace(".json", "").padEnd(18)} ${kp.publicKey.toBase58()}  ${sol.toFixed(4)} SOL`);
}
