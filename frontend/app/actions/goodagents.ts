'use server';

// ─── GoodAgents partner API bridge ───────────────────────────────────────────
// Server-to-server calls to GoodAgents' partner host. The partner key (if set)
// never reaches the browser. Write calls (play, settings) carry the player's
// own EIP-191 wallet signature — built and signed client-side — so the host can
// verify the owner authorised the action. We only relay it.
//
// Contract: packages/widget/GAMEARENA_PARTNER_API.md (sam-thetutor/gooddollar-agent-id)

const BASE =
  process.env.GOODAGENTS_PARTNER_BASE || 'https://goodagentids.xyz/host/partners/gamearena';
const PARTNER_KEY = process.env.GOODAGENTS_PARTNER_KEY || '';

function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (PARTNER_KEY) h['x-partner-key'] = PARTNER_KEY;
  return h;
}

export type AgentSettingField = {
  key: string;
  type: string;              // "enum" | "number" | "boolean" | "string" | ...
  label: string;
  default?: unknown;
  options?: string[];        // present for enum
  hint?: string;             // helper text under the label
  when?: Record<string, string>; // show only when these other fields hold these values
};
export type AgentSettingsSchema = { skillId?: string; fields: AgentSettingField[]; error?: string };

export async function goodAgentsSchema(): Promise<AgentSettingsSchema> {
  try {
    const res = await fetch(`${BASE}/settings/schema`, { headers: authHeaders(false), cache: 'no-store' });
    const data = await res.json();
    return { skillId: data?.skillId, fields: Array.isArray(data?.fields) ? data.fields : [] };
  } catch {
    return { fields: [], error: 'unreachable' };
  }
}

export type AgentSettings = {
  deployId?: string;
  displayName?: string;
  agentAddress?: string;
  status?: string;
  verified?: boolean;
  readyToPlay?: boolean;
  configuration?: Record<string, unknown>;
  error?: string;
};

export async function goodAgentsSettings(owner: string): Promise<AgentSettings> {
  try {
    const res = await fetch(`${BASE}/settings?owner=${owner}`, { headers: authHeaders(false), cache: 'no-store' });
    if (!res.ok) return { error: res.status === 404 ? 'no_agent' : 'error' };
    return await res.json();
  } catch {
    return { error: 'unreachable' };
  }
}

// body carries the player's signature over the "configuration" action.
export async function goodAgentsPatchSettings(
  owner: string,
  body: { ownerWallet: string; issuedAt: number; signature: string; configuration: Record<string, unknown> },
): Promise<{ ok?: boolean; restarted?: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/settings?owner=${owner}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error || `http_${res.status}` };
    return { ok: true, restarted: !!data?.restarted };
  } catch {
    return { error: 'unreachable' };
  }
}

export type PlayResult = {
  matchId?: string;
  agentAddress?: string;
  liveWatchUrl?: string;
  livePhase?: string;
  error?: string;
};

// body carries the player's signature over the "play" action. Returns the
// matchId + liveWatchUrl to open the live viewer.
export async function goodAgentsPlay(
  owner: string,
  body: { ownerWallet: string; issuedAt: number; signature: string },
): Promise<PlayResult> {
  try {
    const res = await fetch(`${BASE}/play?owner=${owner}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error || `http_${res.status}` };
    return { matchId: data?.matchId, agentAddress: data?.agentAddress, liveWatchUrl: data?.liveWatchUrl, livePhase: data?.livePhase };
  } catch {
    return { error: 'unreachable' };
  }
}
