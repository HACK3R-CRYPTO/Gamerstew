-- Cash outs to a bank, paid by GoodCash (docs/cash-out.md).
-- GameArena moves no money here. GoodCash tells the game server each time a cash
-- out changes (a signed webhook); these tables keep that news so the dashboard
-- can count it and a player is told once when their money lands.
--
-- Safe to run more than once.

create table if not exists cashouts (
  id           text primary key,                       -- GoodCash's own id for the cash out
  wallet       text check (wallet is null or wallet ~ '^0x[a-f0-9]{40}$'),
  amount_g     numeric not null check (amount_g >= 0), -- G$ the player sent
  naira        numeric not null check (naira >= 0),    -- naira the player gets
  fee_percent  numeric check (fee_percent is null or (fee_percent >= 0 and fee_percent <= 100)),
  status       text not null check (status in ('awaiting_signature', 'sent', 'processing', 'paid', 'failed', 'refunded', 'expired')),
  mode         text not null check (mode in ('live', 'test')),
  tx_hash      text check (tx_hash is null or tx_hash ~ '^0x[a-f0-9]{64}$'),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists cashouts_wallet_idx on cashouts (wallet, created_at desc);
create index if not exists cashouts_created_idx on cashouts (created_at desc);

-- One row per event GoodCash has sent, so the same event is acted on once.
create table if not exists cashout_events (
  id          text primary key,
  type        text not null,
  cashout_id  text not null,
  at          timestamptz not null default now()
);

-- Only the game server reads or writes these (it uses the service-role key).
alter table cashouts enable row level security;
alter table cashout_events enable row level security;

-- How far along a cash out is. A later event may only move it forward: GoodCash
-- retries, so an old "sent" can arrive after "paid" and must not undo it.
create or replace function cashout_rank(s text) returns int language sql immutable as $$
  select case s when 'awaiting_signature' then 0 when 'sent' then 1 when 'processing' then 2 when 'failed' then 3 when 'expired' then 3 when 'refunded' then 4 when 'paid' then 4 else -1 end;
$$;

create or replace function cashout_save(
  p_id text, p_wallet text, p_amount_g numeric, p_naira numeric, p_fee_percent numeric,
  p_status text, p_mode text, p_tx_hash text, p_created_at timestamptz, p_paid_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cashouts (id, wallet, amount_g, naira, fee_percent, status, mode, tx_hash, created_at, paid_at, updated_at)
  values (p_id, p_wallet, p_amount_g, p_naira, p_fee_percent, p_status, p_mode, p_tx_hash, coalesce(p_created_at, now()), p_paid_at, now())
  on conflict (id) do update set
    status      = case when cashout_rank(excluded.status) >= cashout_rank(cashouts.status) then excluded.status else cashouts.status end,
    wallet      = coalesce(cashouts.wallet, excluded.wallet),
    naira       = case when cashout_rank(excluded.status) >= cashout_rank(cashouts.status) then excluded.naira else cashouts.naira end,
    tx_hash     = coalesce(excluded.tx_hash, cashouts.tx_hash),
    paid_at     = coalesce(excluded.paid_at, cashouts.paid_at),
    fee_percent = coalesce(excluded.fee_percent, cashouts.fee_percent),
    updated_at  = now();
end;
$$;

-- For the admin dashboard. Real money only ('live'); test cash outs are counted apart.
create or replace function admin_cashouts(from_day date, to_day date) returns jsonb language sql stable security definer set search_path = public as $$
  with live as (select * from cashouts where mode = 'live'),
       period as (select * from live where created_at >= from_day and created_at < to_day + 1)
  select jsonb_build_object(
    'period', (select jsonb_build_object(
        'started', count(*), 'paid', count(*) filter (where status = 'paid'), 'in_flight', count(*) filter (where status in ('sent', 'processing')),
        'not_paid', count(*) filter (where status in ('failed', 'refunded', 'expired')),
        'players', count(distinct wallet) filter (where status = 'paid'),
        'g_paid', coalesce(sum(amount_g) filter (where status = 'paid'), 0), 'naira_paid', coalesce(sum(naira) filter (where status = 'paid'), 0)) from period),
    'all_time', (select jsonb_build_object(
        'paid', count(*) filter (where status = 'paid'), 'players', count(distinct wallet) filter (where status = 'paid'),
        'g_paid', coalesce(sum(amount_g) filter (where status = 'paid'), 0), 'naira_paid', coalesce(sum(naira) filter (where status = 'paid'), 0),
        'first', (select to_char(min(created_at), 'YYYY-MM-DD') from live where status = 'paid')) from live),
    'by_status', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (select status, count(*) as n, coalesce(sum(amount_g), 0) as g, coalesce(sum(naira), 0) as naira from period group by status) x),
    'by_day', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
        select to_char(created_at::date, 'YYYY-MM-DD') as day, count(*) filter (where status = 'paid') as paid, coalesce(sum(naira) filter (where status = 'paid'), 0) as naira, coalesce(sum(amount_g) filter (where status = 'paid'), 0) as g
        from period group by created_at::date) x),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id, wallet, amount_g, naira, fee_percent, status, tx_hash, created_at as at, paid_at from period order by created_at desc limit 40) x),
    'test_count', (select count(*) from cashouts where mode = 'test' and created_at >= from_day and created_at < to_day + 1)
  );
$$;

-- These are for the game server alone.
revoke execute on function cashout_save(text, text, numeric, numeric, numeric, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function admin_cashouts(date, date) from public, anon, authenticated;
grant execute on function cashout_save(text, text, numeric, numeric, numeric, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function admin_cashouts(date, date) to service_role;
