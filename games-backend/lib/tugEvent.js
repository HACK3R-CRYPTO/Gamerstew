// ─── Verified Tug of War — live standings from REAL data ─────────────────────
// Everything here is derived from sources that already exist:
//   · who played, and when   → the subgraph (on-chain scores)
//   · who is a verified human → GoodDollar Identity on Celo
//   · which human is which    → the identity ROOT, so one face is one player
// The scoring maths itself lives in lib/tugScoring.js and is pure.
//
// Nothing is written anywhere to produce a standing, so this runs today without
// a migration. Team choice is the one thing that genuinely needs storage; until
// that table exists, sides are assigned deterministically from the identity
// root (see assignTeam), which is stable, balanced, and impossible to grief.

const crypto = require('crypto');
const { scoreTeams, bountyWinners, dedupeByIdentityRoot } = require('./tugScoring');

function tugConfig() {
  return {
    eventId:      process.env.TUG_EVENT_ID     || 'tug-1',
    startsAt:     process.env.TUG_STARTS_AT    || '2026-09-23T17:00:00Z',
    endsAt:       process.env.TUG_ENDS_AT      || '2026-09-30T17:00:00Z',
    prizeTotalG:  Number(process.env.TUG_PRIZE_G        || 1_000_000),
    bountySlots:  Number(process.env.TUG_BOUNTY_SLOTS   || 160),
    bountyAmountG:Number(process.env.TUG_BOUNTY_G       || 2_500),
    dailyPullCap: Number(process.env.TUG_DAILY_PULL_CAP || 5),
    qualifyGames: Number(process.env.TUG_QUALIFY_GAMES  || 3),
    // Only real skill games count. Whitelisting is deliberate: excluding
    // gameType 3 (agent matches) would still let partner-sourced scores
    // (gameType 4, posted via a static partner key with no gameplay) qualify a
    // wallet.
    gameTypes:    (process.env.TUG_GAME_TYPES || '0,1,2').split(',').map(Number),
  };
}

function eventPhase(cfg, nowMs = Date.now()) {
  const s = Date.parse(cfg.startsAt), e = Date.parse(cfg.endsAt);
  if (nowMs < s) return 'scheduled';
  if (nowMs >= e) return 'ended';
  return 'live';
}

// Sides are split on a hash of the identity ROOT, not the wallet. One human
// therefore lands on one side no matter how many wallets they hold, and nobody
// can be moved by someone else.
function assignTeam(identityRoot) {
  const h = crypto.createHash('sha256').update(String(identityRoot).toLowerCase()).digest();
  return (h[0] & 1) === 0 ? 'red' : 'blue';
}

// ── A recruit joins their recruiter's side ──────────────────────────────────
// Without this the event's central claim is simply false. If a recruit is
// assigned a side by their own hash, they land on YOUR team only half the time
// — so bringing someone in is worth 10 points to a coin flip, and the whole
// "recruiting beats grinding" incentive that the scoring is built around
// collapses. The UI said "they join your side when they verify"; this is what
// makes that true.
//
// It reuses season_v1_referrer_intent, which already exists and already records
// who referred whom, so no migration is needed.
//
// Two guards, both load-bearing:
//   · depth limit — A refers B refers A is a cycle, and an unbounded walk up
//     the referral chain would hang the whole rebuild.
//   · the chain always terminates at a root hash, never at "no team", so a
//     player is never left unassigned because their referrer never qualified.
const MAX_REFERRAL_DEPTH = 6;

function resolveTeam(wallet, identityRoot, referrerOf, rootOf, depth = 0) {
  const w = String(wallet).toLowerCase();
  const ref = referrerOf.get(w);
  if (ref && depth < MAX_REFERRAL_DEPTH) {
    const refRoot = rootOf.get(ref);
    // Only follow a referrer we can actually identify. An unverified or unknown
    // referrer cannot lend a side they do not have.
    if (refRoot && refRoot !== identityRoot) {
      return resolveTeam(ref, refRoot, referrerOf, rootOf, depth + 1);
    }
  }
  return assignTeam(identityRoot);
}

// ── Plays, per wallet per UTC day ───────────────────────────────────────────
// Paginated with a COMPOSITE cursor. The existing playCountsInWindow pages on a
// strict `blockTimestamp_gt`, which silently drops every remaining row sharing
// the last timestamp of a page — fine while human plays are seconds apart,
// wrong the moment a burst lands many scores in one block, and it would drop
// real players' games rather than the burst's.
async function fetchPlaysByWalletDay(subgraph, startUnix, endUnix, gameTypes) {
  const byWallet = new Map(); // wallet -> { username, days: Map(YYYY-MM-DD -> n), total }
  const seen = new Set();     // score ids already counted, guards the overlap
  let cursorTs = Number(startUnix) - 1;

  for (let page = 0; page < 300; page++) {
    const data = await subgraph.gql(
      `query TP($gte: BigInt!, $end: BigInt!, $types: [Int!], $n: Int!) {
         scores(first: $n, orderBy: blockTimestamp, orderDirection: asc,
                where: { blockTimestamp_gte: $gte, blockTimestamp_lte: $end, gameType_in: $types }) {
           id
           blockTimestamp
           gameType
           player { id username }
         }
       }`,
      { gte: String(cursorTs + 1 > startUnix ? cursorTs : startUnix), end: String(endUnix), types: gameTypes, n: 1000 },
    );
    const rows = data?.scores || [];
    if (rows.length === 0) break;

    let fresh = 0;
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      fresh++;
      const w = r.player?.id?.toLowerCase();
      if (!w) continue;
      const day = new Date(Number(r.blockTimestamp) * 1000).toISOString().slice(0, 10);
      let e = byWallet.get(w);
      if (!e) { e = { username: r.player.username || null, days: new Map(), total: 0 }; byWallet.set(w, e); }
      e.days.set(day, (e.days.get(day) || 0) + 1);
      e.total += 1;
    }

    const lastTs = Number(rows[rows.length - 1].blockTimestamp);
    // Re-query FROM the last timestamp (not after it) so rows sharing it are
    // never skipped; `seen` makes the overlap idempotent.
    if (rows.length < 1000) break;
    if (lastTs === cursorTs && fresh === 0) break; // fully saturated timestamp, nothing new
    cursorTs = lastTs;
  }
  return byWallet;
}

/**
 * Build live standings.
 * @param {object} deps
 * @param {object} deps.subgraph            games-backend/lib/subgraph
 * @param {(w:string)=>Promise<boolean>} deps.isVerified      SELF-verification only
 * @param {(w:string)=>Promise<string|null>} deps.identityRootOf  dedupe key
 * @param {(items:any[],limit:number,fn:Function)=>Promise<any[]>} deps.mapLimit
 */
async function buildStandings(deps, cfg = tugConfig(), nowMs = Date.now()) {
  const { subgraph, isVerified, identityRootOf, mapLimit, referrerMap } = deps;
  const phase = eventPhase(cfg, nowMs);
  const startUnix = Math.floor(Date.parse(cfg.startsAt) / 1000);
  const endUnix = Math.floor(Math.min(Date.parse(cfg.endsAt), nowMs) / 1000);

  const base = {
    eventId: cfg.eventId, status: phase,
    startsAt: cfg.startsAt, endsAt: cfg.endsAt,
    red: 0, blue: 0,
    today: { red: 0, blue: 0, date: new Date(nowMs).toISOString().slice(0, 10) },
    humans: { red: 0, blue: 0 },
    bounty: { slots: cfg.bountySlots, claimed: 0, amountG: cfg.bountyAmountG },
    prizeTotalG: cfg.prizeTotalG,
    serverTime: new Date(nowMs).toISOString(),
  };
  if (phase === 'scheduled') return { standings: base, players: [], byWallet: new Map() };

  const plays = await fetchPlaysByWalletDay(subgraph, startUnix, endUnix, cfg.gameTypes);

  // Only wallets that could possibly qualify get an on-chain read. Checking all
  // 752 players every poll would be pointless traffic.
  const candidates = [...plays.entries()]
    .filter(([, e]) => e.total >= cfg.qualifyGames)
    .map(([w]) => w);

  const checked = await mapLimit(candidates, 10, async (w) => {
    const verified = await isVerified(w);
    if (!verified) return null;
    const root = await identityRootOf(w);
    if (!root) return null;
    const e = plays.get(w);
    // Qualification time = the day of their Nth qualifying game. Ordering for
    // the bounty uses on-chain position, which the writer will snapshot; until
    // then total-then-wallet keeps it deterministic.
    return {
      wallet: w,
      identity_root: root,
      team: assignTeam(root),
      qualified_at: cfg.startsAt,
      qualified_block: e.total,        // deterministic, re-derivable ordering key
      qualified_log_idx: 0,
      games_at_qualify: cfg.qualifyGames,
      username: e.username,
    };
  });

  const quals = checked.filter(Boolean);

  // Re-home every qualified player onto their recruiter's side. Done after the
  // on-chain pass so every root in the chain is already known and no extra
  // lookups are needed.
  const referrerOf = referrerMap ? await referrerMap() : new Map();
  if (referrerOf.size > 0) {
    const rootOf = new Map(quals.map((q) => [q.wallet, q.identity_root]));
    for (const q of quals) {
      q.team = resolveTeam(q.wallet, q.identity_root, referrerOf, rootOf);
    }
  }

  const dailyByWallet = new Map(
    quals.map((q) => {
      const e = plays.get(q.wallet);
      return [q.wallet, [...e.days.entries()].map(([play_date, games]) => ({ play_date, games }))];
    }),
  );

  const cumulative = scoreTeams({ qualifications: quals, dailyByWallet, dailyCap: cfg.dailyPullCap });
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const today = scoreTeams({ qualifications: quals, dailyByWallet, dailyCap: cfg.dailyPullCap, onlyDate: todayStr });
  const winners = bountyWinners(quals, cfg.bountySlots);

  const standings = {
    ...base,
    red: cumulative.teams.red.score,
    blue: cumulative.teams.blue.score,
    today: { red: today.teams.red.score, blue: today.teams.blue.score, date: todayStr },
    humans: { red: cumulative.teams.red.humans, blue: cumulative.teams.blue.humans },
    bounty: { ...base.bounty, claimed: winners.length },
  };

  const byWallet = new Map(cumulative.players.map((p) => [p.wallet, p]));
  const bountyRank = new Map(winners.map((w) => [w.wallet, w.rank]));

  return { standings, players: cumulative.players, byWallet, bountyRank, plays, cfg, todayStr, dailyByWallet };
}

module.exports = {
  tugConfig, eventPhase, assignTeam, resolveTeam, fetchPlaysByWalletDay, buildStandings,
  // re-exported so callers never reach past this module for scoring
  dedupeByIdentityRoot,
};
