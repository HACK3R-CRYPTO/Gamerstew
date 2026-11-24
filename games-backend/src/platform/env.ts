// ─── Every setting this server reads, in one catalogue ───────────────────────
// The backend reads about seventy environment variables, in files all over the
// codebase. Nothing listed them, nothing checked them, and a typo in one (a date
// that does not parse, an address missing a digit) surfaced weeks later as a
// feature quietly doing the wrong thing.
//
// This file is the list. For each setting: what kind of value it is, whether it
// is a secret, what happens when it is absent, and a line saying what it is for.
// At boot the real environment is checked against it and anything malformed is
// reported loudly. It never stops the server: a wrong event date must not take
// score signing down with it.
//
// Two tests keep it honest: one fails if any code reads a variable that is not
// listed here, the other fails if .env.example falls out of step with this list.

export type Kind = 'string' | 'int' | 'number' | 'bool' | 'address' | 'privateKey' | 'url' | 'date' | 'list' | 'origins';
export interface Setting { kind: Kind; group: string; note: string; secret?: boolean; required?: boolean; default?: string }

const s = (group: string, kind: Kind, note: string, extra: Partial<Setting> = {}): Setting => ({ group, kind, note, ...extra });

export const SETTINGS: Record<string, Setting> = {
  // ── server ──
  PORT: s('Server', 'int', 'Port to listen on. The platform sets this.', { default: '3005' }),
  ALLOWED_ORIGINS: s('Server', 'origins', 'Comma-separated browser origins allowed to call the API.', { required: true }),
  INTERNAL_SECRET: s('Server', 'string', 'Shared with the frontend server. The server refuses to start without it.', { secret: true, required: true }),
  SLOW_REQUEST_MS: s('Server', 'int', 'A request slower than this is logged.', { default: '1500' }),
  REQUEST_TIMEOUT_MS: s('Server', 'int', 'A request with no reply after this long is answered 504.', { default: '30000' }),
  SHUTDOWN_GRACE_MS: s('Server', 'int', 'How long requests in flight get to finish on a redeploy.', { default: '10000' }),
  DB_TIMEOUT_MS: s('Server', 'int', 'Deadline for every database call.', { default: '12000' }),
  GAMEARENA_APP_URL: s('Server', 'url', 'Public site address, used in notification links.', { default: 'https://gamearenahq.xyz' }),

  // ── data ──
  SUPABASE_URL: s('Data', 'url', 'Supabase project URL.', { required: true }),
  SUPABASE_ANON_KEY: s('Data', 'string', 'Supabase API key.', { secret: true, required: true }),
  SUBGRAPH_URL: s('Data', 'url', 'Goldsky subgraph endpoint. Defaults to the public one.'),

  // ── chain ──
  CELO_RPC_URL: s('Chain', 'url', 'Celo RPC endpoint.', { default: 'https://forno.celo.org' }),
  CELO_RPC: s('Chain', 'url', 'Older name for CELO_RPC_URL, still read by one module.', { default: 'https://forno.celo.org' }),
  VALIDATOR_PRIVATE_KEY: s('Chain', 'privateKey', 'Signs score vouchers and resolves wagers. Without it scores cannot be signed.', { secret: true }),
  FAUCET_PRIVATE_KEY: s('Chain', 'privateKey', 'Gas-drip wallet. Falls back to the validator key.', { secret: true }),
  ARENA_RELAYER_KEY: s('Chain', 'privateKey', 'Relays arena purchases. Falls back to the validator key.', { secret: true }),
  FEEDBACK_ORACLE_KEY: s('Chain', 'privateKey', 'Writes MARKOV match feedback on-chain.', { secret: true }),
  GAME_PASS_ADDRESS: s('Chain', 'address', 'GamePass contract.', { default: '0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE' }),
  SOLO_WAGER_ADDRESS: s('Chain', 'address', 'SoloWager contract. Unset turns wagers off.'),
  HABITAT_REGISTRY_ADDRESS: s('Chain', 'address', 'Habitat registry contract.'),
  DUEL_ESCROW_ADDRESS: s('Chain', 'address', 'DuelEscrow contract. Unset turns duel rooms off.'),
  PERK_SHOP_ADDRESS: s('Chain', 'address', 'PerkShop contract.', { default: '0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5' }),
  G_TOKEN_ADDR: s('Chain', 'address', 'G$ token contract.', { default: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' }),
  SIGNER_MIN_CELO: s('Chain', 'number', 'Warn when the signer holds less CELO than this.', { default: '5' }),

  // ── gasless ──
  SCORE_ENFORCE: s('Anti-cheat', 'list', 'Games whose score is cut to what the run log supports. "none" switches it off.', { default: 'stack' }),
  GASLESS_SKILL_GAMES: s('Gasless', 'bool', 'Backend pays gas for skill-game scores. On unless set to "false".', { default: 'true' }),
  GASLESS_MAX_PER_WALLET_DAY: s('Gasless', 'int', 'Gasless saves one wallet may make per day.', { default: '60' }),
  GASLESS_MAX_GLOBAL_DAY: s('Gasless', 'int', 'Gasless saves across all wallets per day.', { default: '3000' }),

  // ── faucet ──
  FAUCET_DRIP_CELO: s('Faucet', 'number', 'CELO sent to a fresh wallet.', { default: '0.7' }),
  FAUCET_PARTNER_DRIP_CELO: s('Faucet', 'number', 'CELO sent on a partner request.', { default: '0.1' }),
  FAUCET_FRESH_THRESHOLD_CELO: s('Faucet', 'number', 'A wallet below this balance counts as fresh.', { default: '0.05' }),
  FAUCET_MAX_PER_DAY: s('Faucet', 'int', 'Drips per day, all wallets.', { default: '50' }),
  FAUCET_MAX_PER_IP_DAY: s('Faucet', 'int', 'Drips per day from one address.', { default: '5' }),
  FAUCET_REQUIRE_GOODDOLLAR: s('Faucet', 'bool', 'Only verified humans may use the faucet.', { default: 'false' }),

  // ── notifications ──
  VAPID_PUBLIC_KEY: s('Notifications', 'string', 'Web-push public key. Unset turns push off.'),
  VAPID_PRIVATE_KEY: s('Notifications', 'string', 'Web-push private key.', { secret: true }),
  VAPID_CONTACT_EMAIL: s('Notifications', 'string', 'Contact address sent with pushes.', { default: 'mailto:notify@gamearenahq.xyz' }),

  // ── arena ──
  ARENA_FREE_MATCHES_PER_DAY: s('Arena', 'int', 'Free MARKOV matches per player per day.', { default: '10' }),
  ARENA_POOL_WALLET: s('Arena', 'address', 'Wallet that holds the weekly arena pool.'),
  ARENA_WEEKLY_POOL_GS: s('Arena', 'number', 'Weekly arena pool in G$.', { default: '500' }),
  AGENT_PLAY_KEY: s('Arena', 'string', 'Scoped key for the agent-play partner. Unset closes those routes.', { secret: true }),
  FEEDBACK_MIN_INTERVAL_MS: s('Arena', 'int', 'Least time between on-chain feedback writes.', { default: '600000' }),

  // ── events ──
  CUP_STARTS_AT: s('Events', 'date', 'Arena Cup start.', { default: '2026-08-07T16:00:00Z' }),
  CUP_ENDS_AT: s('Events', 'date', 'Arena Cup end.', { default: '2026-08-21T16:00:00Z' }),
  CUP_MAX_SPEND_PTS: s('Events', 'int', 'Most points a player may spend in the Cup.', { default: '60' }),
  SPRINT_STARTS_AT: s('Events', 'date', 'Private sprint start.', { default: '2026-09-01T00:00:00Z' }),
  SPRINT_ENDS_AT: s('Events', 'date', 'Private sprint end.', { default: '2026-09-06T21:00:00Z' }),
  SPRINT_POOL_G: s('Events', 'number', 'Sprint prize pool in G$.', { default: '430000' }),
  SPRINT_WINNERS: s('Events', 'int', 'How many sprint places pay.', { default: '10' }),
  CREATOR_CONTEST_START: s('Events', 'date', 'Creator contest start. Unset means no contest.'),
  CREATOR_CONTEST_END: s('Events', 'date', 'Creator contest end.'),
  TUG_EVENT_ID: s('Events', 'string', 'Tug of War event id.', { default: 'tug-1' }),
  TUG_STARTS_AT: s('Events', 'date', 'Tug of War start.', { default: '2026-09-23T17:00:00Z' }),
  TUG_ENDS_AT: s('Events', 'date', 'Tug of War end.', { default: '2026-09-30T17:00:00Z' }),
  TUG_PRIZE_G: s('Events', 'number', 'Tug of War prize in G$.', { default: '1000000' }),
  TUG_BOUNTY_G: s('Events', 'number', 'Tug of War bounty per slot in G$.', { default: '2500' }),
  TUG_BOUNTY_SLOTS: s('Events', 'int', 'Tug of War bounty slots.', { default: '160' }),
  TUG_REFERRAL_PRIZES_G: s('Events', 'list', 'Tug of War referral prizes in G$, best first.', { default: '500000,300000,200000' }),
  TUG_DAILY_PULL_CAP: s('Events', 'int', 'Full-value pulls per player per day.', { default: '10' }),
  TUG_OVER_CAP_RATE: s('Events', 'number', 'Value of a pull past the daily cap.', { default: '0.12' }),
  TUG_POINTS_PER_HUMAN: s('Events', 'int', 'Points a verified human adds.', { default: '20' }),
  TUG_QUALIFY_GAMES: s('Events', 'int', 'Games needed to qualify.', { default: '3' }),
  TUG_GAME_TYPES: s('Events', 'list', 'On-chain game types that count.', { default: '0,1,2' }),
  TUG_TTL_MS: s('Events', 'int', 'How long Tug standings are cached.', { default: '30000' }),

  // ── partners ──
  PARTNER_GAMES: s('Partners', 'list', 'Partners as slug or slug:gameType:label, comma-separated. Each needs a PARTNER_KEY_<SLUG>.'),
  VATAR_API: s('Partners', 'url', 'Vatar games API.', { default: 'https://lagoslife.app/api/games/v1' }),
  VATAR_SECRET: s('Partners', 'string', 'Vatar API secret.', { secret: true }),
  VATAR_WEBHOOK_SECRET: s('Partners', 'string', 'Checks the signature on Vatar webhooks.', { secret: true }),
};

/** Variables matched by pattern rather than by name. */
export const SETTING_PATTERNS: { test: RegExp; setting: Setting }[] = [
  { test: /^PARTNER_KEY_[A-Z0-9_]+$/, setting: s('Partners', 'string', 'Key for one partner in PARTNER_GAMES.', { secret: true }) },
];

type Env = Record<string, string | undefined>;

const CHECK: Record<Kind, (v: string) => string | null> = {
  string: () => null,
  int: (v) => (/^-?\d[\d_]*$/.test(v.trim()) ? null : 'is not a whole number'),
  number: (v) => (v.trim() !== '' && Number.isFinite(Number(v)) ? null : 'is not a number'),
  bool: (v) => (/^(true|false)$/i.test(v.trim()) ? null : 'should be "true" or "false"'),
  address: (v) => (/^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? null : 'is not a 0x address of 40 hex digits'),
  privateKey: (v) => (/^(0x)?[0-9a-fA-F]{64}$/.test(v.trim()) ? null : 'is not a 64-hex-digit private key'),
  url: (v) => { try { const u = new URL(v.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'is not an http(s) URL'; } catch { return 'is not a URL'; } },
  date: (v) => (Number.isFinite(Date.parse(v.trim())) ? null : 'is not a date this server can read (use 2026-01-31T16:00:00Z)'),
  list: (v) => (v.split(',').every((p) => p.trim() !== '') ? null : 'has an empty item in its comma-separated list'),
  origins: () => null, // checked, and tidied, by loadConfig
};

export interface EnvReport { problems: string[]; missing: string[]; set: number; secretsSet: number }

/** Compare the real environment with the catalogue. Never throws, never prints a secret. */
export function checkEnv(env: Env = process.env): EnvReport {
  const problems: string[] = [];
  const missing: string[] = [];
  let set = 0, secretsSet = 0;
  for (const [name, def] of Object.entries(SETTINGS)) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') { if (def.required) missing.push(name); continue; }
    set++;
    if (def.secret) secretsSet++;
    const bad = CHECK[def.kind](raw);
    // a secret's value is never echoed, even when it is wrong
    if (bad) problems.push(def.secret ? `${name} ${bad}` : `${name}="${raw.length > 60 ? raw.slice(0, 57) + '…' : raw}" ${bad}`);
  }
  // pairs that only make sense together
  const pair = (a: string, b: string, why: string) => { if (!!env[a]?.trim() !== !!env[b]?.trim()) problems.push(`${a} and ${b} must both be set or both be unset (${why})`); };
  pair('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'web push needs the pair');
  pair('CREATOR_CONTEST_START', 'CREATOR_CONTEST_END', 'a contest needs both ends');
  for (const [a, b] of [['CUP_STARTS_AT', 'CUP_ENDS_AT'], ['SPRINT_STARTS_AT', 'SPRINT_ENDS_AT'], ['TUG_STARTS_AT', 'TUG_ENDS_AT'], ['CREATOR_CONTEST_START', 'CREATOR_CONTEST_END']] as const) {
    const from = Date.parse(env[a] ?? SETTINGS[a]!.default ?? ''), to = Date.parse(env[b] ?? SETTINGS[b]!.default ?? '');
    if (Number.isFinite(from) && Number.isFinite(to) && to <= from) problems.push(`${b} is not after ${a}: the event would never run`);
  }
  // an entry is "slug" or "slug:…"; its key is PARTNER_KEY_<SLUG>, exactly as lib/partner.js reads it
  for (const pair of (env.PARTNER_GAMES ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const slug = pair.split(':')[0]!.trim();
    const key = `PARTNER_KEY_${slug.toUpperCase()}`;
    if (slug && !env[key]?.trim()) problems.push(`PARTNER_GAMES lists "${slug}" but ${key} is not set: that partner is silently skipped`);
  }
  return { problems, missing, set, secretsSet };
}

/** What is configured, safe to show: secrets appear only as "set" or "unset". */
export function describeEnv(env: Env = process.env): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, def] of Object.entries(SETTINGS)) {
    const raw = env[name]?.trim();
    const shown = def.secret ? (raw ? 'set' : 'unset') : raw ? raw : def.default !== undefined ? `(default) ${def.default}` : 'unset';
    (out[def.group] ??= {})[name] = shown;
  }
  return out;
}

/** The text of .env.example, generated so it can never drift from the catalogue. */
export function envExample(): string {
  const lines = ['# GameArena backend settings. Generated from src/platform/env.ts: edit that file, then run', '#   npm run env:example', '# A line that is commented out shows the default the server uses when it is not set.', ''];
  let group = '';
  for (const [name, def] of Object.entries(SETTINGS)) {
    if (def.group !== group) { group = def.group; lines.push(`# ── ${group} ${'─'.repeat(Math.max(3, 60 - group.length))}`); }
    lines.push(`# ${def.note}${def.required ? ' REQUIRED.' : ''}${def.secret ? ' SECRET: never commit a real value.' : ''}`);
    lines.push(def.default !== undefined ? `# ${name}=${def.default}` : `${name}=`);
  }
  lines.push('# ── Partners (one per id in PARTNER_GAMES) ──', '# PARTNER_KEY_<ID>=', '');
  return lines.join('\n');
}
