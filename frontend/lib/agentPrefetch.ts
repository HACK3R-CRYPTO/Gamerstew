"use client";

// ─── GoodAgents prefetch cache ───────────────────────────────────────────────
// The Challenge AI lobby knows what's next: the settings schema and the
// agent's configuration. Warm both the moment the lobby mounts so the
// settings screen and the play flow open on already-loaded data instead of
// spinners. Module-level promise cache with a short TTL — repeat visits
// within the window reuse the in-flight/settled promise; stale entries
// refetch transparently.

import {
  goodAgentsSchema, goodAgentsSettings,
  type AgentSettingsSchema, type AgentSettings,
} from "@/app/actions/goodagents";

const TTL_MS = 60_000;

let schemaCache: { p: Promise<AgentSettingsSchema>; at: number } | null = null;
const settingsCache = new Map<string, { p: Promise<AgentSettings>; at: number }>();

export function getSchemaCached(): Promise<AgentSettingsSchema> {
  if (!schemaCache || Date.now() - schemaCache.at > TTL_MS) {
    schemaCache = { p: goodAgentsSchema(), at: Date.now() };
  }
  return schemaCache.p;
}

export function getSettingsCached(owner: string): Promise<AgentSettings> {
  const key = owner.toLowerCase();
  const hit = settingsCache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    settingsCache.set(key, { p: goodAgentsSettings(key), at: Date.now() });
  }
  return settingsCache.get(key)!.p;
}

// After a signed settings save the host state changed — drop the cache so the
// next read reflects it.
export function invalidateSettings(owner: string): void {
  settingsCache.delete(owner.toLowerCase());
}

// Fire-and-forget warmup from the lobby.
export function prefetchAgentData(owner?: string | null): void {
  void getSchemaCached();
  if (owner) void getSettingsCached(owner);
}
