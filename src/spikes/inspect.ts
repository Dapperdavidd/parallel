/**
 * Inspect the live market: engine asset state next to the oracle profile.
 *
 * Exists because the two carry DIFFERENT copies of the target price, and
 * confusing them produces convincing nonsense. See DECISIONS.md.
 *
 *   npm run inspect
 */

import { existsSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getConnection, getAccountData, fromE6 } from "../lib/solana.js";
import { assetEngineOffset, assetSlotOffset, readAssetControlSequences } from "../lib/percolator.js";
import { parseAsset, parseAssetOracleProfile } from "../vendor/percolator-v16/index.js";

const STATE_PATH = "out/parallel-devnet.json";
const DIM = "\x1b[2m", OFF = "\x1b[0m";

async function main(): Promise<void> {
  if (!existsSync(STATE_PATH)) throw new Error(`${STATE_PATH} not found — run \`npm run spike1\``);
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { market?: string };
  if (!state.market) throw new Error("no market in state");

  const conn = getConnection();
  const market = new PublicKey(state.market);
  const data = await getAccountData(conn, market);

  const asset = parseAsset(data, assetEngineOffset(0), 0);
  const profile = parseAssetOracleProfile(data, assetSlotOffset(0), 0);
  const seqs = readAssetControlSequences(data, 0);
  const slot = await conn.getSlot("confirmed");

  const usd = (e6: bigint): string => `$${fromE6(e6).toFixed(6)}`;

  console.log(`\nmarket ${market.toBase58()}`);
  console.log(`${DIM}account ${data.length} B · current slot ${slot}${OFF}\n`);

  console.log("oracle profile (written by PushAuthMark)");
  console.log(`  oracle_mode              ${profile.oracleMode} ${DIM}(3 = AuthMark)${OFF}`);
  console.log(`  oracle_authority         ${profile.oracleAuthority.toBase58()}`);
  console.log(`  oracle_target_price_e6   ${profile.oracleTargetPriceE6}  ${usd(profile.oracleTargetPriceE6)}`);
  console.log(`  mark_ewma_e6             ${profile.markEwmaE6}  ${usd(profile.markEwmaE6)}`);
  console.log(`  last_good_oracle_slot    ${profile.lastGoodOracleSlot} ${DIM}(${slot - Number(profile.lastGoodOracleSlot)} slots ago)${OFF}`);
  console.log(`  unit_scale / invert      ${profile.unitScale} / ${profile.invert}`);

  console.log("\nengine asset (walked by PermissionlessCrank)");
  console.log(`  raw_oracle_target_price  ${asset.rawOracleTargetPrice}  ${usd(asset.rawOracleTargetPrice)}`);
  console.log(`  effective_price          ${asset.effectivePrice}  ${usd(asset.effectivePrice)}`);
  console.log(`  fund_px_last             ${asset.fundPxLast}  ${usd(asset.fundPxLast)}`);
  console.log(`  slot_last                ${asset.slotLast} ${DIM}(${slot - Number(asset.slotLast)} slots ago)${OFF}`);
  console.log(`  open interest            long ${asset.oiEffLongQ}, short ${asset.oiEffShortQ}`);
  console.log(`  positions                long ${asset.storedPosCountLong}, short ${asset.storedPosCountShort}`);
  console.log(`  lifecycle                ${asset.lifecycle}`);

  console.log("\ncontrol sequences");
  console.log(`  oracle_observation       ${seqs.oracleObservation}`);
  console.log(`  authority_epoch          ${seqs.authorityEpoch}`);

  const lag = profile.oracleTargetPriceE6 !== asset.effectivePrice;
  console.log(
    `\n${lag ? "⚠ target/effective lag" : "✓ effective price is at target"}` +
      `${lag ? ` — crank to close it` : ""}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("inspect failed:", err);
    process.exit(1);
  });
