-- 2026-11-24 · The inbox. Run once in the Supabase SQL editor. Safe to run again.
--
-- notifications_feed already holds every notification sent. This adds what the
-- bell needs to be a real inbox: read and deleted remembered per player on the
-- server, announcements with a kind, and a key that stops the same thing being
-- sent twice.

alter table notifications_feed add column if not exists kind text;
alter table notifications_feed add column if not exists dedupe_key text;
-- the same event can only be recorded once
create unique index if not exists notifications_feed_dedupe on notifications_feed (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_feed_broadcast_idx on notifications_feed (sent_at desc) where wallet_address is null;

-- Per player, per notification. A broadcast is one row in the feed for
-- everyone; this is where one player's "read" and "deleted" for it live.
create table if not exists notification_state (
  wallet          text        not null,
  notification_id bigint      not null references notifications_feed (id) on delete cascade,
  read_at         timestamptz,
  deleted_at      timestamptz,
  primary key (wallet, notification_id)
);

-- "Mark all read" and "Clear all" are one timestamp each, not a row per
-- notification: everything sent up to that moment is read, or gone.
create table if not exists inbox_prefs (
  wallet         text primary key,
  read_before    timestamptz,
  cleared_before timestamptz,
  updated_at     timestamptz not null default now()
);

-- A page of one player's inbox, newest first. Their own notifications, plus
-- broadcasts from the last 60 days, minus what they deleted or cleared.
create or replace function inbox_page(p_wallet text, p_limit int, p_before timestamptz)
returns table (id bigint, kind text, category text, title text, body text, url text, sent_at timestamptz, is_broadcast boolean, read boolean)
language sql stable as $$
  select f.id, f.kind, f.category, f.title, f.body, f.url, f.sent_at,
         f.wallet_address is null as is_broadcast,
         (s.read_at is not null or (p.read_before is not null and f.sent_at <= p.read_before)) as read
  from notifications_feed f
  left join notification_state s on s.wallet = p_wallet and s.notification_id = f.id
  left join inbox_prefs p on p.wallet = p_wallet
  where (lower(f.wallet_address) = p_wallet or (f.wallet_address is null and f.sent_at > now() - interval '60 days'))
    and s.deleted_at is null
    and (p.cleared_before is null or f.sent_at > p.cleared_before)
    and (p_before is null or f.sent_at < p_before)
  order by f.sent_at desc
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function inbox_unread(p_wallet text)
returns bigint
language sql stable as $$
  select count(*)
  from notifications_feed f
  left join notification_state s on s.wallet = p_wallet and s.notification_id = f.id
  left join inbox_prefs p on p.wallet = p_wallet
  where (lower(f.wallet_address) = p_wallet or (f.wallet_address is null and f.sent_at > now() - interval '60 days'))
    and s.deleted_at is null and s.read_at is null
    and (p.cleared_before is null or f.sent_at > p.cleared_before)
    and (p.read_before is null or f.sent_at > p.read_before);
$$;
