import { BigInt } from "@graphprotocol/graph-ts";
import {
  PassMinted,
  UsernameChanged,
  ScoreRecorded,
} from "../generated/GamePass/GamePass";
import { Score } from "../generated/schema";
import {
  getOrCreatePlayer,
  getOrCreateDailyStat,
  getOrCreateGlobalStat,
  eventId,
  ZERO_BI,
  ONE_BI,
} from "./helpers";

export function handlePassMinted(event: PassMinted): void {
  let player = getOrCreatePlayer(event.params.player);
  let isNew = player.passMintedAt === null;

  player.username = event.params.username;
  player.passTokenId = event.params.tokenId;
  player.passMintedAt = event.block.timestamp;
  player.save();

  // Daily new-player counter (only on the first mint for a wallet).
  if (isNew) {
    let day = getOrCreateDailyStat(event.block.timestamp);
    day.newPlayers = day.newPlayers.plus(ONE_BI);
    day.save();

    let global = getOrCreateGlobalStat(event.block.timestamp);
    global.totalPlayers = global.totalPlayers.plus(ONE_BI);
    global.save();
  }
}

export function handleUsernameChanged(event: UsernameChanged): void {
  let player = getOrCreatePlayer(event.params.player);
  player.username = event.params.newName;
  player.save();
}

export function handleScoreRecorded(event: ScoreRecorded): void {
  let player = getOrCreatePlayer(event.params.player);
  let gameType = event.params.gameType;
  let score = event.params.score;

  // Per-player counters
  player.totalGames = event.params.totalGames;
  player.lastPlayedAt = event.block.timestamp;
  if (gameType == 0) {
    player.rhythmPlays = player.rhythmPlays.plus(ONE_BI);
    if (score.gt(player.bestRhythmScore)) player.bestRhythmScore = score;
  } else if (gameType == 1) {
    player.simonPlays = player.simonPlays.plus(ONE_BI);
    if (score.gt(player.bestSimonScore)) player.bestSimonScore = score;
  } else if (gameType == 2) {
    // Stack Tower — uint8 gameType is open on GamePass, no contract
    // change needed; we just bucket gameType=2 events as stack plays.
    player.stackPlays = player.stackPlays.plus(ONE_BI);
    if (score.gt(player.bestStackScore)) player.bestStackScore = score;
  }
  player.save();

  // Immutable Score row — full audit trail
  let s = new Score(eventId(event.transaction.hash, event.logIndex));
  s.player = player.id;
  s.gameType = gameType;
  s.score = score;
  s.season = event.params.season;
  s.totalGamesAtTime = event.params.totalGames;
  s.blockTimestamp = event.block.timestamp;
  s.txHash = event.transaction.hash;
  s.save();

  // Daily aggregate
  let day = getOrCreateDailyStat(event.block.timestamp);
  day.scoresRecorded = day.scoresRecorded.plus(ONE_BI);
  if (gameType == 0) day.rhythmPlays = day.rhythmPlays.plus(ONE_BI);
  else if (gameType == 1) day.simonPlays = day.simonPlays.plus(ONE_BI);
  else if (gameType == 2) day.stackPlays = day.stackPlays.plus(ONE_BI);
  day.save();

  // Global aggregate
  let global = getOrCreateGlobalStat(event.block.timestamp);
  global.totalScores = global.totalScores.plus(ONE_BI);
  if (gameType == 0) global.totalRhythmPlays = global.totalRhythmPlays.plus(ONE_BI);
  else if (gameType == 1) global.totalSimonPlays = global.totalSimonPlays.plus(ONE_BI);
  else if (gameType == 2) global.totalStackPlays = global.totalStackPlays.plus(ONE_BI);
  global.save();
}
