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
    // ── Referral event ────────────────────────────────────────────────────
    // Runs alongside the rope on the same window. Placement prizes, biggest
    // first. A recruit only counts once they have VERIFIED and qualified, so
    // every point here is a real human who actually played — you cannot farm
    // this with wallets the way an ordinary referral contest can be farmed.
    referralPrizesG: (process.env.TUG_REFERRAL_PRIZES_G || '500000,300000,200000')
      .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0),
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

// ── Sides: the system assigns, recruiting pays the recruiter ────────────────
// Teams are decided by the system alone. Nobody picks a side and a recruit does
// NOT inherit their recruiter's side, because a pure hash is only fair in
// expectation: it splits 50.1/49.9 across 20,000 identities and 0/4 across four,
// and referral inheritance made it worse, since one recruiter with ten friends
// dragged all ten onto one side. Measured live: red 0, blue 4.
//
// Recruiting is still paid, just not in territory. A recruit's 10-point human
// bounty is credited to their RECRUITER's side via bounty_team, so bringing a
// friend always pulls your own rope even though your friend may be playing
// against you. Their game pulls score for whichever side they were put on.
//
// STABILITY MATTERS MORE THAN PERFECT BALANCE. A player must never change team
// between one poll and the next. Assignment is therefore a pure function of
// on-chain qualification order: your position is fixed the moment you qualify,
// earlier players keep theirs, and a new qualifier only ever appends.
// Recomputing from scratch always produces the same answer.
const MAX_REFERRAL_DEPTH = 6;

function assignTeam(identityRoot) {
  const h = crypto.createHash('sha256').update(String(identityRoot).toLowerCase()).digest();
  return (h[0] & 1) === 0 ? 'red' : 'blue';
}

/**
 * Assign every qualifier a side and a bounty recipient, in place.
 * @param {Array}    quals       qualification rows, any order
 * @param {Map}      referrerOf  wallet -> referrer wallet
 * @param {Function} cmp         the on-chain ordering comparator
 */
function assignSides(quals, referrerOf, cmp) {
  const ordered = [...quals].sort(cmp);
  const teamOf = new Map();
  const count = { red: 0, blue: 0 };

  // Pass 1: balance. Ties break on the identity hash so the first player of an
  // event is not always red.
  for (const q of ordered) {
    const side = count.red === count.blue
      ? assignTeam(q.identity_root)
      : (count.red < count.blue ? 'red' : 'blue');
    q.team = side;
    count[side] += 1;
    teamOf.set(String(q.wallet).toLowerCase(), side);
  }

  // Pass 2: route each recruit's bounty to their recruiter's side. Separate
  // pass because a recruit can qualify BEFORE their recruiter does, so the
  // recruiter's side is not yet known during pass 1.
  for (const q of ordered) {
    let ref = referrerOf.get(String(q.wallet).toLowerCase());
    let depth = 0;
    while (ref && depth < MAX_REFERRAL_DEPTH) {
      const side = teamOf.get(String(ref).toLowerCase());
      // An unqualified recruiter has no side to lend, so the bounty stays with
      // the player. Walking further up would pay a grandparent for a recruit
      // they never brought, so the chain is followed only through people who
      // are themselves in the event.
      if (side) { q.bounty_team = side; break; }
      break;
    }
    if (!q.bounty_team) q.bounty_team = q.team;
  }
  return quals;
}

// ── Plays, per wallet per UTC day ───────────────────────────────────────────
// Paginated with a COMPOSITE cursor. The existing playCountsInWindow pages on a
// strict `blockTimestamp_gt`, which silently drops every remaining row sharing
// the last timestamp of a page — fine while human plays are seconds apart,
// wrong the moment a burst lands many scores in one block, and it would drop
// real players' games rather than the burst's.
async function fetchPlaysByWalletDay(subgraph, startUnix, endUnix, gameTypes) {
  // wallet -> { username, total, days: Map(date -> { n, best: Map(gameType -> score) }) }
  const byWallet = new Map();
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
           score
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
      let d = e.days.get(day);
      if (!d) { d = { n: 0, best: new Map() }; e.days.set(day, d); }
      d.n += 1;
      // Keep only the BEST score per game per day. This is what makes quitting
      // worthless: a bailed run scores low and never displaces a real one.
      const gt = Number(r.gameType), sc = Number(r.score) || 0;
      if (!d.best.has(gt) || sc > d.best.get(gt)) d.best.set(gt, sc);
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
  if (phase === 'scheduled') {
    // The prize structure is known before the event opens, and the pre-event
    // screen is precisely where it has to be visible — that screen exists to
    // make people verify early. Returning bare `base` here meant the recruiter
    // pool read as 0 and the biggest prize was invisible until launch.
    base.referral = {
      prizesG: cfg.referralPrizesG,
      totalG: cfg.referralPrizesG.reduce((a, n) => a + n, 0),
      top: [],
      entrants: 0,
    };
    return { standings: base, players: [], byWallet: new Map(), cfg, referralBoard: [] };
  }

  const plays = await fetchPlaysByWalletDay(subgraph, startUnix, endUnix, cfg.gameTypes);

  // Only wallets that could possibly qualify get an on-chain read. Checking all
  // 752 players every poll would be pointless traffic.
  // Qualifying needs real runs, not three taps on start. Without the points
  // check, quitting three times would claim a 2,500 G$ bounty slot.
  const { dayPoints } = require('./tugScoring');
  const earnedAny = (e) => [...e.days.values()].some((d) => dayPoints(d.best) > 0);
  const candidates = [...plays.entries()]
    .filter(([, e]) => e.total >= cfg.qualifyGames && earnedAny(e))
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

  // Decide sides once, in on-chain order, after the chain pass so every root is
  // known. Recruits follow their recruiter; everyone else balances the sides.
  const referrerOf = referrerMap ? await referrerMap() : new Map();
  const { compareQualificationOrder } = require('./tugScoring');
  assignSides(quals, referrerOf, compareQualificationOrder);

  const dailyByWallet = new Map(
    quals.map((q) => {
      const e = plays.get(q.wallet);
      return [q.wallet, [...e.days.entries()].map(([play_date, d]) => ({ play_date, best: d.best, games: d.n }))];
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

  // ── Referral leaderboard ────────────────────────────────────────────────
  // Counted on QUALIFIED recruits only. Someone who clicks a link and never
  // verifies is not growth, and paying for them is how referral contests get
  // farmed. Ties break on who got there first on-chain, so placement is
  // deterministic rather than whichever row the database happened to return.
  const nameOf = new Map(quals.map((q) => [q.wallet, q.username]));
  const recruitsBy = new Map();
  for (const q of quals) {
    if (!q.counted) continue;
    const ref = referrerOf.get(q.wallet);
    if (!ref || ref === q.wallet) continue;
    if (!recruitsBy.has(ref)) recruitsBy.set(ref, []);
    recruitsBy.get(ref).push(q.wallet);
  }
  const firstQualifiedAt = new Map(
    cumulative.players.filter((p) => p.counted)
      .map((p) => [p.wallet, Number(p.qualified_block) || 0]),
  );
  const referralBoard = [...recruitsBy.entries()]
    .map(([wallet, recruits]) => ({
      wallet,
      username: nameOf.get(wallet) || null,
      recruits: recruits.length,
      tiebreak: firstQualifiedAt.get(wallet) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => b.recruits - a.recruits || a.tiebreak - b.tiebreak
                 || String(a.wallet).localeCompare(String(b.wallet)))
    .map((r, i) => ({
      wallet: r.wallet,
      username: r.username,
      recruits: r.recruits,
      rank: i + 1,
      prizeG: cfg.referralPrizesG[i] ?? 0,
    }));

  standings.referral = {
    prizesG: cfg.referralPrizesG,
    totalG: cfg.referralPrizesG.reduce((a, n) => a + n, 0),
    // Only the prize-winning places are public. Publishing the full board
    // would expose every recruiter's wallet and recruit count to anyone.
    top: referralBoard.slice(0, cfg.referralPrizesG.length)
      .map(({ wallet, username, recruits, rank, prizeG }) => ({
        name: username || String(wallet).slice(2, 8), recruits, rank, prizeG,
      })),
    entrants: referralBoard.length,
  };

  return {
    standings, players: cumulative.players, byWallet, bountyRank,
    plays, cfg, todayStr, dailyByWallet, referralBoard,
  };
}

module.exports = {
  tugConfig, eventPhase, assignTeam, assignSides, fetchPlaysByWalletDay, buildStandings,
  // re-exported so callers never reach past this module for scoring
  dedupeByIdentityRoot,
};
