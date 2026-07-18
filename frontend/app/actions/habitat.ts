'use server';

// ─── Habitat server actions ──────────────────────────────────────────────────
// Thin bridge to games-backend /api/habitat/*. Runs on the Next server so
// BACKEND_URL and INTERNAL_SECRET never reach the browser · same pattern as
// app/actions/perks.ts and app/actions/arena.ts.
//
// WHY THIS EXISTS (2026-07-17 audit): useHabitats used to POST /api/habitat/equip
// straight from the browser. A browser cannot hold the internal secret, so that
// endpoint had to stay ungated, and the CORS origin check is NOT authentication
// (any script can forge an Origin header). Result: anyone could change anyone
// else's equipped habitat. Routing through a server action lets the endpoint
// require the secret like every other write.

const BACKEND_URL     = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export async function setHabitatEquip(
  address: string,
  tier: number,
): Promise<{ success?: boolean; equipped?: number; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/habitat/equip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET ?? '',
      },
      body: JSON.stringify({ address, tier }),
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { error: 'backend_unreachable' };
  }
}
