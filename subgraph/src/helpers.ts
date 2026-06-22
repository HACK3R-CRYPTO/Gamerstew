import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Player, DailyStat, GlobalStat } from "../generated/schema";

// ─── Constants ───────────────────────────────────────────────────────────────
export const ZERO_BI = BigInt.zero();
export const ONE_BI = BigInt.fromI32(1);
const SECONDS_PER_DAY = BigInt.fromI32(86400);

// ─── Player ──────────────────────────────────────────────────────────────────
// Idempotent fetch-or-init. Used by every event handler so Player rows are
// always present even before the wallet has minted a GamePass (e.g. they
// donated to UBI before claiming an NFT).
export function getOrCreatePlayer(addr: Address): Player {
  let id = addr.toHexString();
  let p = Player.load(id);
  if (p == null) {
    p = new Player(id);
    p.totalGames = ZERO_BI;
    p.rhythmPlays = ZERO_BI;
    p.simonPlays = ZERO_BI;
    p.stackPlays = ZERO_BI;
    p.bestRhythmScore = ZERO_BI;
    p.bestSimonScore = ZERO_BI;
    p.bestStackScore = ZERO_BI;
    p.highestHabitatTier = 0;
    p.totalUbiDonated = ZERO_BI;
    p.totalWagers = ZERO_BI;
    p.totalWageredG = ZERO_BI;
    p.totalWonG = ZERO_BI;
    p.wagersWon = ZERO_BI;
    p.wagersLost = ZERO_BI;
  }
  return p as Player;
}

// ─── DailyStat ───────────────────────────────────────────────────────────────
// One row per UTC day. Events bucketed by `block.timestamp / 86400`. Charts
// query DailyStat directly so the frontend never has to aggregate.
export function getOrCreateDailyStat(timestamp: BigInt): DailyStat {
  let dayStart = timestamp.div(SECONDS_PER_DAY).times(SECONDS_PER_DAY);
  let id = dayStart.toString();
  let d = DailyStat.load(id);
  if (d == null) {
    d = new DailyStat(id);
    d.date = dayStart;
    d.newPlayers = ZERO_BI;
    d.scoresRecorded = ZERO_BI;
    d.rhythmPlays = ZERO_BI;
    d.simonPlays = ZERO_BI;
    d.stackPlays = ZERO_BI;
    d.habitatUnlocks = ZERO_BI;
    d.ubiDonatedG = ZERO_BI;
    d.wagersCreated = ZERO_BI;
  }
  return d as DailyStat;
}

// ─── GlobalStat ──────────────────────────────────────────────────────────────
// Single "global" row. Every handler increments here so the dashboard can
// pull live totals in one query. ID is always "global".
export function getOrCreateGlobalStat(timestamp: BigInt): GlobalStat {
  let g = GlobalStat.load("global");
  if (g == null) {
    g = new GlobalStat("global");
    g.totalPlayers = ZERO_BI;
    g.totalScores = ZERO_BI;
    g.totalRhythmPlays = ZERO_BI;
    g.totalSimonPlays = ZERO_BI;
    g.totalStackPlays = ZERO_BI;
    g.totalHabitatUnlocks = ZERO_BI;
    g.totalUbiDonatedG = ZERO_BI;
    g.totalTreasuryG = ZERO_BI;
    g.totalWagers = ZERO_BI;
    g.totalWageredG = ZERO_BI;
  }
  g.lastUpdatedAt = timestamp;
  return g as GlobalStat;
}

export function eventId(txHash: Bytes, logIndex: BigInt): string {
  return txHash.toHexString().concat("-").concat(logIndex.toString());
}
