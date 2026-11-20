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
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    market?: string;
    portfolioA?: string;
    portfolioB?: string;
  };
  if (!state.market) throw new Error("no market in state");

  const conn = getConnection();
  const market = new PublicKey(state.market);
  const data = await getAccountData(conn, market);

  const asset = parseAsset(data, assetEngineOffset(0), 0);
  const profile = parseAssetOracleProfile(data, assetSlotOffset(0), 0);
  const seqs = readAssetControlSequences(data, 0);
  const slot = await conn.getSlot("confirmed");

  const usd = (e6: bigint): string => `$${fromE6(e6).toFixed(6)}`;
  const fmtAtoms = (a: bigint): string =>
    (Number(a) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  // Portfolios, if spikes 2-3 have created them.
  const pfs: [string, string | undefined][] = [
    ["A (admin) ", (state as { portfolioA?: string }).portfolioA],
    ["B (trader)", (state as { portfolioB?: string }).portfolioB],
  ];
  const anyPf = pfs.some(([, k]) => k);
  if (anyPf) {
    const { parsePortfolio } = await import("../vendor/percolator-v16/index.js");
    const { parseMarketGroup } = await import("../vendor/percolator-v16/index.js");
    const group = parseMarketGroup(data);
    console.log("\nmarket group");
    console.log(`  mode                     ${group.mode} ${DIM}(0 = Live, 1 = Resolved, 2 = Recovery)${OFF}`);
    console.log(`  vault / insurance        ${fmtAtoms(group.vault)} / ${fmtAtoms(group.insurance)}`);
    console.log(`  c_tot                    ${fmtAtoms(group.cTot)}`);
    console.log(`  loss_stale_active        ${group.lossStaleActive}`);
    console.log(`  bankruptcy_hlock_active  ${group.bankruptcyHlockActive}`);
    console.log(`  asset_slot_capacity      ${group.assetSlotCapacity} ${DIM}(layout drift check)${OFF}`);

    console.log("\nportfolios");
    for (const [name, key] of pfs) {
      if (!key) continue;
      const p = parsePortfolio(await getAccountData(conn, new PublicKey(key)));
      const leg = p.legs.find((l) => l.assetIndex === 0);
      const pos = leg?.basisPosQ ?? 0n;
      const notional = (pos < 0n ? -pos : pos) * asset.effectivePrice / 1_000_000n;
      const equity = p.capital + p.pnl;
      console.log(
        `  ${name} capital ${fmtAtoms(p.capital).padStart(14)}  pnl ${fmtAtoms(p.pnl).padStart(14)}  ` +
          `equity ${fmtAtoms(equity).padStart(14)}`,
      );
      console.log(
        `             pos ${pos.toString().padStart(14)}  notional ${fmtAtoms(notional).padStart(12)}  ` +
          `${notional > 0n ? `equity/notional ${((Number(equity) / Number(notional)) * 100).toFixed(2)}%` : ""}`,
      );
      console.log(
        `             ${DIM}stale ${p.staleState} bStale ${p.bStaleState} ` +
          `rebalanceLock ${p.rebalanceLock} liquidationLock ${p.liquidationLock}${OFF}`,
      );
    }
  }

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
