'use server';

// ─── Push server actions ─────────────────────────────────────────────────────
// Thin bridge to games-backend /api/push/*. Runs on the Next server so
// BACKEND_URL and INTERNAL_SECRET never reach the browser · same pattern as
// app/actions/perks.ts, arena.ts and habitat.ts.
//
// WHY THIS EXISTS (2026-07-17 audit): usePushNotifications POSTed these three
// routes straight from the browser. A browser cannot hold the internal secret,
// so the endpoints had to stay ungated, and the CORS origin check is NOT
// authentication (any script can forge an Origin header). That left them
// world-writable:
//   · subscribe   → register a push subscription against ANY wallet
//   · unsubscribe → kill ANY player's subscription by endpoint (griefing)
//   · prefs       → flip ANY player's notification preferences
// Routing through server actions lets each endpoint demand the secret.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

async function backend(path: string, body: object) {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET ?? '',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function pushSubscribe(
  walletAddress: string,
  subscription: PushSubscriptionPayload,
): Promise<{ success?: boolean; error?: string }> {
  return backend('/api/push/subscribe', { walletAddress, subscription });
}

export async function pushUnsubscribe(
  endpoint: string,
): Promise<{ success?: boolean; error?: string }> {
  return backend('/api/push/unsubscribe', { endpoint });
}

export async function pushSetPrefs(
  walletAddress: string,
  prefs: {
    streak_warnings?: boolean;
    cup_deadlines?: boolean;
    rank_changes?: boolean;
    reengagement?: boolean;
  },
): Promise<{ success?: boolean; error?: string }> {
  return backend('/api/push/prefs', { walletAddress, ...prefs });
}
