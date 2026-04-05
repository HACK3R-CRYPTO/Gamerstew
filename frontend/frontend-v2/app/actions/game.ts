'use server';

import { PrivyClient } from '@privy-io/server-auth';
import { supabase } from '@/lib/supabase';

// ─── Privy server-side client ─────────────────────────────────────────────────
// PRIVY_APP_SECRET never leaves the server — not in NEXT_PUBLIC_ so browser can't see it
const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

// ─── Season helpers ──────────────────────────────────────────────────────────
const SEASON_EPOCH = 1770249600;
const SEASON_DAYS  = 7;

function currentSeason() {
  return Math.floor((Math.floor(Date.now() / 1000) - SEASON_EPOCH) / (SEASON_DAYS * 86400)) + 1;
}

// ─── Verify caller owns the wallet ───────────────────────────────────────────
async function verifyUser(accessToken: string, claimedAddress: string) {
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    // claims.userId is the Privy user ID — we also need their linked wallet
    const user = await privy.getUser(claims.userId);
    const wallet = user.linkedAccounts.find(
      (a: { type: string }) => a.type === 'wallet'
    ) as { type: string; address: string } | undefined;
    if (!wallet) return false;
    return wallet.address.toLowerCase() === claimedAddress.toLowerCase();
  } catch {
    return false;
  }
}

// ─── submitScore ─────────────────────────────────────────────────────────────
// Called from game components — runs entirely on the server.
// Supabase URL, anon key, and Privy app secret never touch the browser.
export async function submitScore(
  accessToken: string,
  playerAddress: string,
  scoreData: {
    game: 'rhythm' | 'simon';
    score: number;
    gameTime: number;
    wagered?: string | null;
    wagerId?: string | null;
  }
) {
  // 1. Verify the caller actually owns this wallet via Privy
  const isValid = await verifyUser(accessToken, playerAddress);
  if (!isValid) {
    return { success: false, error: 'Unauthorized' };
  }

  // 2. Basic score sanity
  const { game, score, gameTime } = scoreData;
  if (score < 0 || score > 1_000_000) return { success: false, error: 'Score out of range' };
  if (gameTime < 5000) return { success: false, error: 'Game time too short' };

  const season = currentSeason();
  const lower  = playerAddress.toLowerCase();

  // 3. Register / update streak
  const streak = await registerUser(lower);

  // 4. Forward to Express backend — handles on-chain tx + full DB save
  //    BACKEND_URL is a server env var — browser never sees it
  let txHash: string | null = null;
  let backendHandled = false;
  let rank = 0;
  try {
    const backendRes = await fetch(`${process.env.BACKEND_URL}/api/submit-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET! },
      body: JSON.stringify({ playerAddress, scoreData }),
    });
    const backendData = await backendRes.json();
    if (backendRes.ok && backendData.success) {
      txHash = backendData.txHash || null;
      rank = backendData.rank || 0;
      backendHandled = true;
    }
  } catch (_) {}

  // 5. Fallback: save directly to Supabase only if Express failed
  if (!backendHandled) {
    await saveScore({
      wallet_address: lower,
      game,
      score,
      game_time: gameTime,
      season_number: season,
      wagered: scoreData.wagered || null,
      wager_id: scoreData.wagerId || null,
      tx_hash: txHash,
    });
    const leaderboard = await getLeaderboard(game);
    rank = leaderboard.findIndex(e => e.wallet_address === lower) + 1;
  }

  return { success: true, score, rank, txHash, streak };
}

// ─── getLeaderboard ──────────────────────────────────────────────────────────
export async function getLeaderboard(game: 'rhythm' | 'simon', limit = 50) {
  const season = currentSeason();
  const { start } = {
    start: SEASON_EPOCH + (season - 1) * SEASON_DAYS * 86400,
  };
  const startDate = new Date(start * 1000).toISOString();

  const { data } = await supabase
    .from('scores')
    .select('*')
    .eq('game', game)
    .gte('created_at', startDate)
    .order('score', { ascending: false })
    .limit(500);

  if (!data) return [];

  const seen = new Map<string, typeof data[0]>();
  for (const row of data) {
    const key = row.wallet_address?.toLowerCase();
    if (!key) continue;
    if (!seen.has(key) || row.score > seen.get(key)!.score) seen.set(key, row);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── getStreak ───────────────────────────────────────────────────────────────
export async function getStreak(address: string) {
  const lower = address.toLowerCase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data } = await supabase
    .from('users')
    .select('play_streak, last_play_date')
    .eq('wallet_address', lower)
    .limit(1);

  if (!data || data.length === 0) return { streak: 0, playedToday: false };

  const user = data[0];
  const playedToday = user.last_play_date === today;
  let streak = user.play_streak || 0;
  if (!playedToday && user.last_play_date !== yesterday) streak = 0;

  return { streak, playedToday };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
async function registerUser(lower: string) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const { data: rows } = await supabase
    .from('users')
    .select('wallet_address, play_streak, last_play_date')
    .eq('wallet_address', lower)
    .limit(1);

  if (!rows || rows.length === 0) {
    await supabase.from('users').insert({ wallet_address: lower, play_streak: 1, last_play_date: today });
    return 1;
  }

  const user = rows[0];
  if (user.last_play_date === today) return user.play_streak || 1;

  const newStreak = user.last_play_date === yesterday ? (user.play_streak || 0) + 1 : 1;
  await supabase.from('users').update({ play_streak: newStreak, last_play_date: today }).eq('wallet_address', lower);
  return newStreak;
}

async function saveScore(entry: {
  wallet_address: string;
  game: string;
  score: number;
  game_time: number;
  season_number: number;
  wagered: string | null;
  wager_id: string | null;
  tx_hash: string | null;
}) {
  const { data: rows } = await supabase
    .from('scores')
    .select('id, score')
    .eq('wallet_address', entry.wallet_address)
    .eq('game', entry.game)
    .order('score', { ascending: false })
    .limit(1);

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing && existing.score >= entry.score) {
    await supabase.from('activity').insert({
      wallet_address: entry.wallet_address,
      game: entry.game,
      score: entry.score,
      tx_hash: entry.tx_hash,
    });
    return;
  }

  if (existing) {
    await supabase.from('scores').delete().eq('id', existing.id);
  }
  await supabase.from('scores').insert(entry);
  await supabase.from('activity').insert({
    wallet_address: entry.wallet_address,
    game: entry.game,
    score: entry.score,
    tx_hash: entry.tx_hash,
  });
}
