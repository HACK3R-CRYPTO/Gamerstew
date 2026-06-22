-- In-app notification feed.
--
-- The web-push pipeline (lib/push.js) fires deliveries to the device but
-- doesn't preserve the payload anywhere queryable — only `notification_log`
-- exists, which records `(wallet, category, sent_on, payload_tag)` for
-- de-duplication, NOT the title/body/url. That's fine for de-dupe but
-- worthless if you want to render the same events in the bell icon when
-- a player opens the app on a device that wasn't subscribed.
--
-- This table stores the full payload of every send, both targeted
-- (per-wallet, e.g. achievement_unlocked, rank_change, mission_expire)
-- and broadcast (`wallet_address IS NULL` rows · everyone sees them).
-- The frontend's bell fetches recent rows for the player + recent
-- broadcasts in a single query.

CREATE TABLE IF NOT EXISTS notifications_feed (
  id              BIGSERIAL PRIMARY KEY,
  -- NULL means "broadcast to everyone". Per-wallet sends populate this.
  wallet_address  TEXT,
  -- Same `category` strings sendToWallet uses (achievement_*, wager_*,
  -- rank_change, cup_deadline, streak_warning, daily_g_claim,
  -- mission_expire, reengagement_d*, broadcast). Lets the frontend
  -- group/filter later without re-parsing the title.
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  -- Optional click-through. Frontend renders the row as a link when set.
  url             TEXT,
  -- Browser-side tag used by the service worker for collapsing (e.g.
  -- "season1-kickoff"). Mostly for ops grepping.
  tag             TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query patterns:
--   1. Per-wallet feed: WHERE (wallet_address = $1 OR wallet_address IS NULL)
--      ORDER BY sent_at DESC LIMIT 50
--   2. Recent broadcasts only: WHERE wallet_address IS NULL ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS notifications_feed_wallet_idx
  ON notifications_feed (wallet_address, sent_at DESC);
CREATE INDEX IF NOT EXISTS notifications_feed_broadcast_idx
  ON notifications_feed (sent_at DESC) WHERE wallet_address IS NULL;
