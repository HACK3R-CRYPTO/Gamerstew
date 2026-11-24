// ─── The inbox: a player's notifications ─────────────────────────────────────
// What the bell shows. Every notification GameArena sends is already written to
// notifications_feed (lib/push.js), whether or not a push reached the phone.
// This module is the part that was missing: a place where reading and deleting
// are REMEMBERED ON THE SERVER, per player, so they hold across devices.
//
// A broadcast (an announcement, "what's new") is one row for everyone. Read and
// deleted are kept per player beside it, so one player deleting an
// announcement removes it for them and nobody else.
//
// "Mark all read" and "Clear all" are a single timestamp each, not a write per
// notification: everything up to that moment is read, or gone.
//
// No I/O here. The store port does the reading and writing.

export type Kind = 'announcement' | 'whats_new' | 'reward' | 'rank' | 'reminder' | 'activity';
export const KINDS: Kind[] = ['announcement', 'whats_new', 'reward', 'rank', 'reminder', 'activity'];

export interface InboxItem { id: string; kind: Kind; category: string; title: string; body: string | null; url: string | null; sentAt: number; fromGameArena: boolean; read: boolean }
export interface FeedRow { id: number | string; kind?: string | null; category: string; title: string; body: string | null; url: string | null; sent_at: string; is_broadcast: boolean; read: boolean }

export interface InboxStore {
  /** newest first; excludes what this player deleted or cleared. `ok` false = could not read. */
  page(wallet: string, limit: number, beforeIso: string | null): Promise<{ ok: boolean; rows: FeedRow[] }>;
  unread(wallet: string): Promise<{ ok: boolean; count: number }>;
  markRead(wallet: string, ids: number[]): Promise<boolean>;
  markAllRead(wallet: string, atIso: string): Promise<boolean>;
  remove(wallet: string, ids: number[]): Promise<boolean>;
  clearAll(wallet: string, atIso: string): Promise<boolean>;
  /** One announcement for everyone. `dedupeKey` makes a repeat a no-op. */
  announce(row: { kind: Kind; category: string; title: string; body: string | null; url: string | null; dedupeKey: string | null }): Promise<{ ok: boolean; created: boolean; id?: number }>;
}

export const MAX_PAGE = 50;
export const MAX_IDS = 100;
export const TITLE_MAX = 80;
export const BODY_MAX = 400;

/** The broad group a notification belongs to, from the category it was sent with. */
export function kindOf(category: string, stored?: string | null): Kind {
  if (stored && (KINDS as string[]).includes(stored) && stored !== 'activity') return stored as Kind;
  if (category === 'whats_new') return 'whats_new';
  if (category === 'broadcast' || category === 'announcement' || category === 'welcome') return 'announcement';
  if (category.startsWith('achievement_') || category.startsWith('wager_') || category === 'daily_g_claim' || category.startsWith('prize')) return 'reward';
  if (category === 'rank_change' || category.startsWith('close_rank') || category.startsWith('season') || category.startsWith('cup_starting')) return 'rank';
  if (category === 'streak_warning' || category === 'mission_expire' || category === 'cup_deadline' || category.startsWith('reengagement_') || category.startsWith('identity')) return 'reminder';
  return 'activity';
}

export interface Reply { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const bad = (error: string, status = 400): Reply => ({ status, body: { error } });
const WALLET = /^0x[a-f0-9]{40}$/;
const clean = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** Only http(s) links or in-app paths. Anything else is dropped, never shown. */
export function safeUrl(v: unknown): string | null {
  const s = clean(v, 300);
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return /^https:\/\/[^\s]+$/i.test(s) ? s : null;
}

export function createInbox(deps: { store: InboxStore; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const wallet = (v: unknown): string | null => { const w = String(v ?? '').toLowerCase(); return WALLET.test(w) ? w : null; };
  const idList = (v: unknown): number[] | null => {
    if (!Array.isArray(v) || v.length === 0 || v.length > MAX_IDS) return null;
    const out = v.map((x) => Number(x));
    return out.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(out)] : null;
  };

  /** GET the inbox: a page of notifications and how many are unread. */
  async function list(address: unknown, query: Record<string, unknown> = {}): Promise<Reply> {
    const w = wallet(address);
    if (!w) return bad('Bad address');
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(query.limit)) || 30));
    const beforeMs = Number(query.before);
    const before = Number.isFinite(beforeMs) && beforeMs > 0 ? new Date(beforeMs * 1000).toISOString() : null;
    const [page, unread] = await Promise.all([deps.store.page(w, limit, before), deps.store.unread(w)]);
    // a read that failed is said so: the bell must not show "all caught up" when it could not look
    if (!page.ok) return ok({ items: [], unread: 0, more: false, unavailable: true });
    const items: InboxItem[] = page.rows.map((r) => ({
      id: String(r.id), kind: kindOf(r.category, r.kind), category: r.category, title: r.title, body: r.body, url: safeUrl(r.url),
      sentAt: Math.floor(Date.parse(r.sent_at) / 1000), fromGameArena: r.is_broadcast, read: !!r.read,
    }));
    return ok({ items, unread: unread.ok ? unread.count : items.filter((i) => !i.read).length, more: page.rows.length === limit });
  }

  /** Just the number for the bell's dot. The dot is asked for far more often
   *  than the inbox is opened, so it must not cost a page of notifications. */
  async function unread(address: unknown): Promise<Reply> {
    const w = wallet(address);
    if (!w) return bad('Bad address');
    const res = await deps.store.unread(w);
    return res.ok ? ok({ unread: res.count }) : ok({ unread: 0, unavailable: true });
  }

  /** Mark some, or all, as read. */
  async function read(address: unknown, body: Record<string, unknown>): Promise<Reply> {
    const w = wallet(address);
    if (!w) return bad('Bad address');
    if (body.all === true) return (await deps.store.markAllRead(w, new Date(now()).toISOString())) ? ok({ ok: true }) : bad('Could not save', 503);
    const ids = idList(body.ids);
    if (!ids) return bad('Give ids, or all: true');
    return (await deps.store.markRead(w, ids)) ? ok({ ok: true }) : bad('Could not save', 503);
  }

  /** Delete some, or clear the whole inbox. Only ever for this player. */
  async function remove(address: unknown, body: Record<string, unknown>): Promise<Reply> {
    const w = wallet(address);
    if (!w) return bad('Bad address');
    if (body.all === true) return (await deps.store.clearAll(w, new Date(now()).toISOString())) ? ok({ ok: true }) : bad('Could not save', 503);
    const ids = idList(body.ids);
    if (!ids) return bad('Give ids, or all: true');
    return (await deps.store.remove(w, ids)) ? ok({ ok: true }) : bad('Could not save', 503);
  }

  /** GameArena posts an announcement or a "what's new" for everyone. */
  async function announce(body: Record<string, unknown>): Promise<Reply> {
    const title = clean(body.title, TITLE_MAX); const text = clean(body.body, BODY_MAX);
    if (!title) return bad('A title is required');
    const kind: Kind = body.kind === 'whats_new' ? 'whats_new' : 'announcement';
    const rawUrl = clean(body.url, 300);
    const url = safeUrl(rawUrl);
    if (rawUrl && !url) return bad('The link must start with https:// or /');
    const dedupeKey = clean(body.dedupeKey, 120) || null;
    const res = await deps.store.announce({ kind, category: kind === 'whats_new' ? 'whats_new' : 'announcement', title, body: text || null, url, dedupeKey });
    if (!res.ok) return bad('Could not save', 503);
    return ok({ ok: true, created: res.created, id: res.id ?? null, kind });
  }

  return { list, unread, read, remove, announce };
}
export type Inbox = ReturnType<typeof createInbox>;
