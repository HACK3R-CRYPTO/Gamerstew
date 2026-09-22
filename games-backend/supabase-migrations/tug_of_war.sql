-- ─── Verified Tug of War ─────────────────────────────────────────────────────
-- Two teams. The rope moves on VERIFIED, PLAYING humans — not on wallets, and
-- not on raw referral count.
--
-- The design decisions encoded here all come from a specific attack found in
-- audit, so they are load-bearing rather than stylistic:
--
--  * We score IDENTITY ROOTS, not wallets. GoodDollar's connectAccount(address)
--    is permissionless and uncapped — one verified human can unilaterally claim
--    N addresses for ~$0.004 each, and getWhitelistedRoot returns the same
--    non-zero root for all of them. Scoring wallets meant one face could be 160
--    "verified humans" and take the whole pool for about $2.
--
--  * Qualification is SNAPSHOTTED, never re-derived. A first-ever GoodDollar
--    verification expires after 3 days, so in a 7-day event a live re-check at
--    scoring time silently zeroes most players. (That is a real bug in the
--    existing Cup scoring, which calls isVerified() at scoring time.)
--
--  * qualified_at comes from the on-chain block timestamp of the qualifying
--    score, tie-broken by (block, log index) — never wall clock. The bounty is
--    ordered by it, so "who was #160" has to be deterministic and re-derivable,
--    not dependent on how fast someone's client polled.

create table if not exists tug_events (
  id                text        primary key,
  name              text        not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  prize_total_g     bigint      not null,
  bounty_slots      int         not null default 160,
  bounty_amount_g   bigint      not null default 2500,
  daily_pull_cap    int         not null default 5,
  qualify_games     int         not null default 3,
  status            text        not null default 'scheduled',
  created_at        timestamptz not null default now()
);

create table if not exists tug_members (
  event_id          text        not null references tug_events(id) on delete cascade,
  -- Addresses are stored lowercase, always. Postgres text comparison is
  -- case-SENSITIVE while the scoring engine lowercases, so without this
  -- '0xAB…' and '0xab…' are two rows here and one human there — two seats in
  -- the database, one in the payout list, and no way to reconcile them.
  wallet            text        not null check (wallet = lower(wallet)),
  team              text        not null check (team in ('red','blue')),
  joined_at         timestamptz not null default now(),
  recruiter_wallet  text,
  -- true when the joiner proved control of the wallet. An unproven pick can be
  -- overwritten by a later proven one, so griefing a team assignment is always
  -- correctable. Mirrors season_v1_players.team_locked.
  team_locked       boolean     not null default false,
  primary key (event_id, wallet)
);
create index if not exists tug_members_team_idx on tug_members(event_id, team);

create table if not exists tug_qualifications (
  event_id          text        not null references tug_events(id) on delete cascade,
  wallet            text        not null check (wallet = lower(wallet)),
  identity_root     text        not null
                      check (identity_root ~ '^0x[0-9a-f]{40}$'),
  team              text        not null check (team in ('red','blue')),
  qualified_at      timestamptz not null,
  qualified_block   bigint,
  qualified_log_idx int,
  games_at_qualify  int         not null,
  -- When another wallet already qualified under this identity root, the later
  -- one lands here pointing at the earlier. We keep the row rather than
  -- dropping it: silently rejecting is exactly how a connectAccount poisoning
  -- attack would erase real players without anyone noticing.
  duplicate_of      text,
  -- Seat ownership is DERIVED, never claimed on insert. See below.
  counted           boolean     not null default false,
  primary key (event_id, wallet)
);

-- INGESTION MUST NOT DECIDE SEATS.
--
-- The obvious design — a unique index that the first inserter wins — enforces
-- "first row to ARRIVE keeps the seat", while the scoring engine enforces
-- "earliest ON-CHAIN position keeps the seat". Those disagree the moment rows
-- arrive out of chain order, which is the normal case for a poller doing a
-- retry, a backfill, or catching up behind a lagging RPC. The result is a
-- database and a payout list that name different winners, with nothing to
-- reconcile them.
--
-- So: the writer inserts every qualification with counted = false and claims
-- nothing. One idempotent scoring pass then assigns seats in on-chain order
-- (dedupeByIdentityRoot) inside a transaction. This index exists only to make
-- the invariant impossible to violate afterwards — it is an assertion, not the
-- arbiter.
create unique index if not exists tug_qual_root_seat
  on tug_qualifications(event_id, identity_root)
  where counted;

create index if not exists tug_qual_order_idx
  on tug_qualifications(event_id, qualified_at, qualified_block, qualified_log_idx);

-- Per-player, per-day play counts. Kept separately from qualification so the
-- daily pull cap can be applied per day rather than over the whole window — a
-- cumulative cap lets one fast phone decide the event on day two.
create table if not exists tug_daily_pulls (
  event_id          text        not null references tug_events(id) on delete cascade,
  wallet            text        not null check (wallet = lower(wallet)),
  play_date         date        not null,
  games             int         not null default 0,
  primary key (event_id, wallet, play_date)
);
