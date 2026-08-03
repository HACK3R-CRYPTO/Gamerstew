'use server';

// GoodCollective choice · thin bridge to games-backend /api/collective/*.
// Same pattern as arena.ts: secrets stay server-side.

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3005';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export async function getCollectiveChoice(address: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/collective/${address.toLowerCase()}`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET ?? '' },
      cache: 'no-store',
    });
    const data = await res.json();
    return (data?.collectiveId as string) ?? null;
  } catch {
    return null;
  }
}

export async function chooseCollective(address: string, collectiveId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/collective/choose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ address, collectiveId }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return !!data?.success;
  } catch {
    return false;
  }
}
