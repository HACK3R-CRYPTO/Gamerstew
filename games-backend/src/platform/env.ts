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
  SUPABASE_SERVICE_ROLE_KEY: s('Data', 'string', 'Supabase service-role key. Needed for the tables locked by row level security: the admin dashboard, payouts, purchases, daily metrics, friend rooms. Server only; never give it to a browser.', { secret: true }),
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
  CHAIN_INDEX: s('Chain', 'bool', 'Read every purchase from the PerkShop and HabitatRegistry events into the purchases table, for the admin dashboard. On unless set to "false".', { default: 'true' }),
  GAMEPASS_INDEX_START: s('Chain', 'int', 'The block the GamePass reader starts from the first time: the block the GamePass contract was deployed in.', { default: '63507400' }),
  CHAIN_INDEX_START: s('Chain', 'int', 'The block the purchase reader starts from the first time: the block the HabitatRegistry was deployed in.', { default: '65552895' }),
  G_TOKEN_ADDR: s('Chain', 'address', 'G$ token contract.', { default: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' }),
  SIGNER_MIN_CELO: s('Chain', 'number', 'Warn when the signer holds less CELO than this.', { default: '5' }),

  // ── gasless ──
  SCORE_OUTBOX: s('Chain', 'bool', 'Queue scores and send them on-chain from the outbox, instead of making the player wait. Needs the chain_outbox table.', { default: 'false' }),
  ROOM_STAKES: s('Chain', 'bool', 'Let friend rooms be played for G$. Losers pay the winner directly by permit; no money is held. Off unless set to "true".', { default: 'false' }),
  ROOM_ONCHAIN: s('Chain', 'bool', 'Record a signed-in player\'s friend-room round on the chain, gasless, like a solo run. Only for games the server scores itself. On unless set to "false".', { default: 'true' }),
  UNFINISHED_ONCHAIN: s('Chain', 'bool', 'Give a run that was started and never finished a transaction of its own: a note from the server wallet to itself, no score, nothing moved. The server pays the gas, with daily limits. On unless set to "false".', { default: 'true' }),
  POT_ENABLED: s('Pot', 'bool', 'The daily pot: one game a day, the top third of verified players split a share of that day\'s energy spend. Nothing is paid by the server: prizes are written as pending payouts. Off unless set to "true".', { default: 'false' }),
  POT_GAMES: s('Pot', 'list', 'The games that take turns carrying the pot, one a day. Only games the server scores itself.', { default: 'rhythm,simon,ladder,strike' }),
  POT_SHARE_BPS: s('Pot', 'int', 'The pot\'s share of every G$ spent on energy, in hundredths of a percent. 7000 is 70%.', { default: '7000' }),
  POT_SEED: s('Pot', 'int', 'G$ the treasury adds to every day\'s pot before anyone plays.', { default: '0' }),
  POT_HOLD_BPS: s('Pot', 'int', 'The share of each paid pot held back to open the next day\'s, in hundredths of a percent. 1000 is 10%. This is how the pot seeds itself without money from the owner.', { default: '1000' }),
  POT_MIN_PLAYERS: s('Pot', 'int', 'Fewer verified players than this and the day\'s pot rolls into the next day instead of being paid.', { default: '5' }),
  ENERGY_ENABLED: s('Pot', 'bool', 'Limit ranked runs to a number of free ones a day, with more for sale in the shop. Off unless set to "true".', { default: 'false' }),
  ENERGY_FREE_PER_DAY: s('Pot', 'int', 'Ranked runs a player may start each day for free.', { default: '5' }),
  ENERGY_PACK_PLAYS: s('Pot', 'int', 'Ranked runs one energy purchase adds.', { default: '5' }),
  ENERGY_PERK_ID: s('Pot', 'int', 'The shop item that is energy.', { default: '10' }),
  ROOM_STAKE_ENTRIES: s('Chain', 'list', 'The G$ entries a room host may pick.', { default: '50,100,250' }),
  ROOM_STAKE_FEE_BPS: s('Chain', 'int', 'The share of each entry kept as the fee, in hundredths of a percent.', { default: '1000' }),
  ROOM_FEE_WALLET: s('Chain', 'address', 'Where room fees go. Empty: the server wallet.', { default: '' }),
  SCORE_ENFORCE: s('Anti-cheat', 'list', 'Games whose score is cut to what the run log supports. "none" switches it off.', { default: 'stack,simon' }),
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
  VATAR_CUSTODY_SEED: s('Partners', 'string', 'Master seed every Vatar player\'s custodial wallet is derived from. Set once, back up, never change: changing it orphans every provisioned player.', { secret: true }),
  VATAR_GAS_DRIP_CELO: s('Partners', 'string', 'CELO sent to a new Vatar custodial wallet so it can mint its GamePass.', { default: '0.1' }),
  VATAR_WEBHOOK_SECRET: s('Partners', 'string', 'Checks the signature on Vatar webhooks.', { secret: true }),
  GOODCASH_WEBHOOK_SECRET: s('Partners', 'string', 'Checks the signature on GoodCash webhooks (cash outs to a bank). It is the whsec_ value GoodCash shows once when the webhook address is set; see docs/cash-out.md. Unset: the webhook answers 503 and no cash out is recorded.', { secret: true }),
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
