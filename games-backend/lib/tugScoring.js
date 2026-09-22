// ─── Verified Tug of War — scoring ───────────────────────────────────────────
// Pure functions. No network, no DB, no clock except what is passed in, so the
// rules can be tested exhaustively and a result is always re-derivable from the
// same inputs. That matters: with a prize attached, "why was I #161" has to be
// answerable.

const POINTS_PER_QUALIFIED_HUMAN = 10;

// ── Identity dedupe ──────────────────────────────────────────────────────────
// GoodDollar's connectAccount(address) is permissionless, uncapped, and needs
// no consent from the address being linked, so one verified human can hold many
// wallets that all resolve to the same whitelisted root. Scoring wallets would
// let one face be N humans. We score roots.
//
// Ordering is by ON-CHAIN position, never wall clock: earliest block, then log
// index, then wallet as a final deterministic tiebreak. The earliest qualifier
// under a root keeps the seat; later ones are marked duplicates and keep their
// row so a poisoning attempt is visible instead of silently deleting players.
function dedupeByIdentityRoot(quals) {
  const ordered = [...quals].sort(compareQualificationOrder);
  const seatByRoot = new Map();
  return ordered.map((q) => {
    const root = String(q.identity_root || '').toLowerCase();
    const wallet = String(q.wallet || '').toLowerCase();
    if (!root || root === '0x0000000000000000000000000000000000000000') {
      return { ...q, duplicate_of: null, counted: false, reason: 'no_identity_root' };
    }
    // Seat is held by the ROOT, full stop. An earlier version only rejected a
    // row when the holder was a DIFFERENT wallet, so the same wallet appearing
    // twice (a backfill, a re-import, or two rows differing only in address
    // casing) was counted as two humans and paid twice.
    if (seatByRoot.has(root)) {
      return { ...q, duplicate_of: seatByRoot.get(root), counted: false, reason: 'duplicate_identity' };
    }
    seatByRoot.set(root, wallet);
    return { ...q, duplicate_of: null, counted: true, reason: null };
  });
}

// ON-CHAIN POSITION is the ordering truth, and it is checked FIRST.
//
// This used to lead with Date.parse(qualified_at). NaN !== NaN is true, so an
// unparseable timestamp returned NaN from the comparator — which V8 treats as
// "not greater than zero", i.e. a tie — and the block/log-index tiebreaks below
// were never reached. Measured: a row with a bad timestamp took bounty rank #1
// or not depending purely on input array order. For a list that pays money,
// non-deterministic is the same as wrong.
//
// qualified_at is derived from the block anyway, so it adds nothing but a NaN
// surface and is no longer consulted. Missing position data throws rather than
// silently mis-ranking someone out of a prize.
function compareQualificationOrder(a, b) {
  const ab = Number(a.qualified_block), bb = Number(b.qualified_block);
  if (!Number.isFinite(ab) || !Number.isFinite(bb)) {
    throw new Error(`qualification missing qualified_block: ${a.wallet} / ${b.wallet}`);
  }
  if (ab !== bb) return ab - bb;
  const ai = Number(a.qualified_log_idx), bi = Number(b.qualified_log_idx);
  if (!Number.isFinite(ai) || !Number.isFinite(bi)) {
    throw new Error(`qualification missing qualified_log_idx: ${a.wallet} / ${b.wallet}`);
  }
  if (ai !== bi) return ai - bi;
  // Byte order, never localeCompare — ICU collation is locale- and build-
  // dependent, so the same data could produce a different #160 cutoff on a dev
  // machine and on the deployed container.
  const aw = String(a.wallet || '').toLowerCase(), bw = String(b.wallet || '').toLowerCase();
  return aw < bw ? -1 : aw > bw ? 1 : 0;
}

// ── Play pulls ───────────────────────────────────────────────────────────────
// Pulls come from HOW WELL you played, not how many times you pressed start.
//
// Counting games was farmable in the dumbest possible way: start a run, quit
// immediately, repeat. That is a point per second of effort and it rewards
// exactly the behaviour the last tournament had to stamp out. So a day is worth
// the sum of your BEST score in each game that day, divided by a per-game
// divisor — the same shape the Arena Cup already uses (CUP_DIVISOR). A bailed
// run scores near zero and never displaces a real one, so quitting earns
// nothing at all.
//
// Still capped PER DAY, not per event. A cumulative cap lets one player bank
// the whole allowance on day one and makes the rest of the week decorative; a
// daily cap keeps every day live and keeps the marginal incentive pointed at
// recruiting, since a verified human is worth far more than a good run.

// Score needed for one point, per game. Mirrors CUP_DIVISOR in server.js:
// rhythm scores run large, stack runs small, so they are normalised.
const GAME_DIVISOR = { 0: 100, 1: 20, 2: 5 };

/** Points earned on ONE day from that day's best score in each game. */
function dayPoints(bestByGame) {
  let pts = 0;
  for (const [gt, score] of bestByGame) {
    const div = GAME_DIVISOR[Number(gt)];
    if (!div) continue;                       // unknown game type earns nothing
    const s = Number(score);
    if (!Number.isFinite(s) || s <= 0) continue;
    pts += Math.floor(s / div);
  }
  return pts;
}
function assertDailyCap(dailyCap) {
  // Math.min(n, null) is 0 and Math.min(n, undefined) is NaN, so a cap that
  // failed to load silently zeroed every pull in the event (rope frozen at
  // head-count, daily tick permanently 0-0) or poisoned the score with NaN.
  // Neither raised anything. Fail loud instead.
  if (!Number.isInteger(dailyCap) || dailyCap <= 0) {
    throw new Error(`bad dailyCap: ${dailyCap}`);
  }
}

// ── The daily limit is a SOFT cap ───────────────────────────────────────────
// A hard clip cancelled out the skill scoring it sits next to. With a cap of 5,
// a stack score of 25 already maxes the day, so lollyposh scoring 134 earned
// exactly what someone scraping 25 earned. Above a very low bar, playing well
// paid nothing and the correct move was to hit the cap and stop.
//
// Past the cap, points keep accruing at a reduced rate. Skill therefore always
// pays something, while the curve still flattens hard enough that one player
// cannot out-grind the recruiting that the event exists to drive. Same shape
// Valor uses for its weekly earn cap, and for the same reason: a hard stop
// tells a player who capped on Tuesday not to come back until Monday.
// 0.12 tuned against live scores, not picked as a round number. The best real
// day in the data is a raw 38 points (lollyposh: stack 134, simon 108, rhythm
// 789), which pays 9 here. A recruit pays 10 and then plays as well, so
// recruiting stays the better move while a great day still pays nearly double
// a mediocre one. At 0.25 that same day paid 13 and playing beat recruiting,
// which inverts the whole point of the event.
const OVER_CAP_RATE = Number(process.env.TUG_OVER_CAP_RATE || 0.12);

// Returns a FRACTIONAL value on purpose. Rounding each day separately threw
// away every small overage: a raw 9 rounded back down to 5, so it paid exactly
// what a raw 5 paid and a whole week of slightly-above-cap days lost several
// points to rounding. playPulls rounds once, at the end, after summing.
function applySoftCap(raw, cap, overRate = OVER_CAP_RATE) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw <= cap) return raw;
  return cap + (raw - cap) * overRate;
}

/**
 * @param dailyRows [{ play_date, best }] where `best` is a Map(gameType -> score).
 *
 * A row WITHOUT `best` scores zero. There used to be a fallback that took a
 * plain game count and paid a point each, which was harmless beside a hard cap
 * and became a hole the moment the cap went soft: 999 started-and-quit games
 * would have paid 254 points, against 20 for two recruits. Points come from
 * scores now, so a caller with no scores has nothing to score.
 */
function playPulls(dailyRows, dailyCap) {
  assertDailyCap(dailyCap);
  let total = 0;
  for (const r of dailyRows) {
    if (!(r.best instanceof Map)) continue;
    total += applySoftCap(dayPoints(r.best), dailyCap);
  }
  return Math.round(total);
}

/**
 * @param {object} p
 * @param {Array}  p.qualifications  rows from tug_qualifications
 * @param {Map<string, Array>} p.dailyByWallet  wallet -> [{play_date, games}]
 * @param {number} p.dailyCap
 * @param {string} [p.onlyDate]  when set, score just that day (the daily tick)
 */
function scoreTeams({ qualifications, dailyByWallet, dailyCap, onlyDate }) {
  assertDailyCap(dailyCap);
  const deduped = dedupeByIdentityRoot(qualifications);
  const teams = { red: { humans: 0, pulls: 0, score: 0 }, blue: { humans: 0, pulls: 0, score: 0 } };
  const players = [];

  for (const q of deduped) {
    if (!q.counted) { players.push({ ...q, pulls: 0, points: 0 }); continue; }
    const team = q.team === 'red' || q.team === 'blue' ? q.team : null;
    if (!team) {
      // "why was I #161" has to be answerable for every zero-scored row.
      players.push({ ...q, pulls: 0, points: 0, counted: false, reason: 'invalid_team' });
      continue;
    }

    let rows = dailyByWallet.get(q.wallet) || [];
    if (onlyDate) rows = rows.filter(r => r.play_date === onlyDate);
    const pulls = playPulls(rows, dailyCap);

    // The daily view is a pure comparison of today's effort, so the one-off
    // "you exist and are verified" bonus must not be counted into it — it would
    // make today's number a restatement of the cumulative one and the daily
    // tick would stop being winnable for the trailing side.
    const points = onlyDate ? pulls : POINTS_PER_QUALIFIED_HUMAN + pulls;

    teams[team].humans += 1;
    teams[team].pulls += pulls;
    teams[team].score += points;
    players.push({ ...q, pulls, points });
  }
  return { teams, players };
}

// ── The rope ─────────────────────────────────────────────────────────────────
// A linear share->offset map makes a 60/40 lead look like a tie, which reads as
// a broken widget. Compress with a power curve and PIN at a capped relative
// lead so the ends stay meaningful. The cap must be disclosed in the UI — an
// undisclosed pin looks rigged, and with money attached people will say so.
// A 25% relative lead pinned the rope — that is only a 125/75 score split, and
// with ~100 verified humans a 65/39 team imbalance is an ordinary outcome, not
// an extreme one. The widget whose entire job is keeping the trailing side
// playing would have sat maxed out from day two. 0.55 keeps the ends meaningful
// while leaving real travel across the range this event will actually occupy.
const ROPE_CAP = 0.55;
const ROPE_CURVE = 0.6;

function ropeOffset(redScore, blueScore, maxPx = 140) {
  const total = Number(redScore) + Number(blueScore);
  // `NaN <= 0` is false, so a NaN score slipped through a bare `total <= 0`
  // guard and returned NaN — which React renders as an undefined transform.
  if (!Number.isFinite(total) || total <= 0) return 0;
  const share = redScore / total;
  const lead = (share - 0.5) * 2;                  // -1 .. 1
  const mag = Math.min(1, Math.pow(Math.abs(lead) / ROPE_CAP, ROPE_CURVE));
  // Positive = RED winning = knot pulled toward RED's side (negative X on screen
  // is handled by the caller); here positive simply means "red ahead".
  return Math.sign(lead) * mag * maxPx;
}

// ── Bounty ───────────────────────────────────────────────────────────────────
// A flat, team-independent guarantee for the first N qualifiers. This is the
// answer to "the losing team quits": a player on the trailing side can still
// have banked a full bounty, and that has to be true structurally, not as
// consolation. Ordered by on-chain position so the cutoff is re-derivable.
function bountyWinners(qualifications, slots) {
  // Array.slice(0, undefined) returns EVERYTHING. With 752 players at 2,500 G$
  // that is 1,880,000 G$ against a 1,000,000 G$ pool; slice(0, null) silently
  // pays nobody; slice(0, -1) quietly drops the last legitimate winner. A bad
  // slot count must never resolve to a plausible-looking payout list.
  const n = Number(slots);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`bad bounty slots: ${slots}`);
  // dedupeByIdentityRoot already returns on-chain order; re-sorting here paid
  // for a second full sort and hid that dependency.
  return dedupeByIdentityRoot(qualifications)
    .filter(q => q.counted)
    .slice(0, n)
    .map((q, i) => ({ wallet: q.wallet, rank: i + 1, identity_root: q.identity_root }));
}

module.exports = {
  POINTS_PER_QUALIFIED_HUMAN, ROPE_CAP, ROPE_CURVE,
  dedupeByIdentityRoot, compareQualificationOrder, playPulls, assertDailyCap,
  dayPoints, GAME_DIVISOR, applySoftCap, OVER_CAP_RATE,
  scoreTeams, ropeOffset, bountyWinners,
};
