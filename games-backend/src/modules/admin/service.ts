// ─── Admin dashboard: the rules ──────────────────────────────────────────────
// Who may sign in, what each role may do, and the reads the dashboard makes.
// The numbers themselves are worked out in the database (see
// supabase-migrations/2026-11-25_admin_dashboard.sql): this file asks for them
// by name and never pulls raw rows to count here.
//
// Roles
//   analyst      read everything, export
//   admin        the above, plus record payouts
//   super_admin  the above, plus manage admins and read the admin action log
//
// Every request after sign-in names the admin by email. The email comes from
// the site's own server (which checked a signed cookie) and is looked up again
// here, so a role is never taken from the request.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export type Role = 'analyst' | 'admin' | 'super_admin';
export interface Admin { email: string; name: string | null; role: Role; disabled: boolean; pass_hash?: string; created_at?: string; last_login_at?: string | null }
export interface Reply { status: number; body: Record<string, unknown> }
/** What the GoodDollar Identity contract says about one wallet. Times are unix seconds. */
export interface Identity { verified: boolean; state?: 'verified' | 'lapsed' | 'none' | 'blacklisted'; /** this wallet itself is whitelisted, not only linked to one that is */ self?: boolean; root?: string | null; at?: number | null; authAt?: number | null; expiresAt?: number | null; probation?: boolean | null }

export interface AdminStore {
  /** the last messages sent to everyone, newest first */
  announcements?(limit: number): Promise<{ id: number; title: string; body: string | null; url: string | null; category: string; sent_at: string }[]>;
  /** one database function, by name: the result, or null with a reason */
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }>;
  admin(email: string): Promise<Admin | null>;
  admins(): Promise<Admin[]>;
  saveAdmin(row: { email: string; name: string | null; role: Role; pass_hash: string; created_by: string }): Promise<string | null>;
  setDisabled(email: string, disabled: boolean): Promise<string | null>;
  touchLogin(email: string): Promise<void>;
  log(email: string, action: string, detail: Record<string, unknown>): Promise<void>;
  actions(limit: number): Promise<unknown[]>;
  payouts(limit: number, offset: number, wallet: string | null): Promise<{ rows: unknown[]; total: number }>;
  addPayout(row: Record<string, unknown>): Promise<string | null>;
  setPayoutStatus(id: number, status: string): Promise<string | null>;
  event(row: { kind: string; wallet?: string | null; game?: string | null; ref?: string | null; tx_hash?: string | null; data?: unknown }): Promise<void>;
}
/** How an announcement leaves the dashboard. Absent: this server cannot send one. */
export interface Announcer {
  bell(row: { title: string; body: string; url: string; kind: 'whats_new' | 'announcement'; dedupeKey: string }): Promise<{ ok: boolean; created: boolean; error?: unknown }>;
  push(p: { title: string; body: string; url: string; tag: string }): Promise<PushResult>;
  /** phones a push would reach right now; null when it cannot be read */
  devices?(): Promise<{ devices: number; players: number } | null>;
}
/** What happened to a push: how many phones there were, and what became of each. */
export interface PushResult { sent: number; skipped: number; devices?: number; expired?: number; failed?: number; why?: string | null; /** the sender itself broke: nothing was attempted */ crashed?: boolean }
export interface AdminDeps { announce?: Announcer; store: AdminStore; now?: () => number; logger?: { warn(m: string, ...x: unknown[]): void }; /** false when the server has no key for the locked admin tables: every read would come back empty */ canReadLocked?: () => boolean }

const RANK: Record<Role, number> = { analyst: 1, admin: 2, super_admin: 3 };
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const fail = (status: number, error: string): Reply => ({ status, body: { error } });
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isWallet = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
const isEmail = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v);

// ── passwords: scrypt, a salt per password, compared in constant time ─────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function checkPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(password, Buffer.from(saltHex, 'hex'), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** today and `days - 1` days before it, as UTC dates */
export function range(q: Record<string, unknown>, nowMs: number): { from: string; to: string } {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const to = isDay(str(q.to)) ? str(q.to) : today;
  if (isDay(str(q.from)) && str(q.from) <= to) return { from: str(q.from), to };
  const days = Math.max(1, Math.min(730, Number(q.days) || 30));
  return { from: new Date(Date.parse(to + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10), to };
}

export function createAdmin(deps: AdminDeps) {
  const now = deps.now ?? Date.now;
  const store = deps.store;
  // a few wrong passwords lock an email out for a while, whoever is trying
  const tries = new Map<string, { n: number; until: number; at: number }>();
  const seen = new Map<string, { n: number; at: number }>(); // tracking: events per browser per minute

  async function who(email: unknown, need: Role): Promise<Admin | Reply> {
    const e = str(email).toLowerCase();
    if (!e) return fail(401, 'not_signed_in');
    const a = await store.admin(e);
    if (!a || a.disabled) return fail(401, 'not_signed_in');
    if (RANK[a.role] < RANK[need]) return fail(403, 'not_allowed');
    return a;
  }
  const isReply = (v: Admin | Reply): v is Reply => 'status' in v;
  async function call(name: string, args: Record<string, unknown>): Promise<Reply> {
    const r = await store.rpc(name, args);
    if (r.error) { deps.logger?.warn(`admin ${name} failed:`, r.error); return fail(503, /does not exist|could not find/i.test(r.error) ? 'migration_needed' : 'unavailable'); }
    return ok({ data: r.data });
  }

  return {
    async login(body: Record<string, unknown>): Promise<Reply> {
      const email = str(body.email).toLowerCase(); const password = typeof body.password === 'string' ? body.password : '';
      if (!email || !password) return fail(400, 'missing');
      // Without the service key the admin table reads as empty, which would look
      // exactly like a wrong password. Say what is actually wrong.
      if (deps.canReadLocked && !deps.canReadLocked()) return fail(503, 'server_key_missing');
      const t = tries.get(email);
      if (t && t.until > now()) return fail(429, 'locked');
      const a = await store.admin(email);
      const good = !!a && !a.disabled && !!a.pass_hash && checkPassword(password, a.pass_hash);
      if (!good) {
        const n = (t && now() - t.at < 15 * 60_000 ? t.n : 0) + 1; // wrong tries within a quarter of an hour of each other add up
        tries.set(email, { n, until: n >= 5 ? now() + 15 * 60_000 : 0, at: now() });
        if (a) await store.log(email, 'login_failed', {});
        return fail(401, 'wrong');
      }
      tries.delete(email);
      await store.touchLogin(email); await store.log(email, 'login', {});
      return ok({ email: a!.email, name: a!.name, role: a!.role });
    },

    /** Every read the dashboard makes. `what` picks it; the query narrows it. */
    async read(email: unknown, what: string, q: Record<string, unknown>): Promise<Reply> {
      if (deps.canReadLocked && !deps.canReadLocked()) return fail(503, 'server_key_missing');
      const need: Role = what === 'admins' || what === 'actions' ? 'super_admin' : 'analyst';
      const me = await who(email, need); if (isReply(me)) return me;
      const r = range(q, now());
      const lim = Math.max(1, Math.min(300, Number(q.limit) || 50)); const off = Math.max(0, Number(q.offset) || 0);
      switch (what) {
        case 'me': return ok({ data: { email: me.email, name: me.name, role: me.role } });
        case 'overview': return call('admin_overview', {});
        case 'series': return call('admin_series', { from_day: r.from, to_day: r.to });
        case 'games': return call('admin_games', { from_day: r.from, to_day: r.to });
        case 'top': return call('admin_top_players', { from_day: r.from, to_day: r.to, lim });
        case 'players': return call('admin_players', { q: str(q.q, 60), who: ['verified', 'unverified', 'lapsed', 'new7', 'new30'].includes(str(q.who)) ? str(q.who) : 'all', sort: ['games', 'new'].includes(str(q.sort)) ? str(q.sort) : 'recent', lim, off });
        case 'new_players': return call('admin_new_players', { from_day: r.from, to_day: r.to, lim });
        case 'player': return isWallet(str(q.wallet)) ? call('admin_player', { w: str(q.wallet) }) : fail(400, 'bad_wallet');
        case 'feed': return call('admin_feed', { lim, before: str(q.before) || null, only_kind: str(q.kind, 40) || null });
        case 'retention': return call('admin_retention', { weeks: Math.max(1, Math.min(26, Number(q.weeks) || 8)) });
        case 'verification': return call('admin_verification', {});
        case 'traffic': return call('admin_traffic', { from_day: r.from, to_day: r.to });
        case 'devices': return call('admin_devices', { from_day: r.from, to_day: r.to });
        case 'runs': return call('admin_runs', { from_day: r.from, to_day: r.to });
        case 'pot': return call('admin_pot', { from_day: r.from, to_day: r.to });
        case 'freezes': return call('admin_freezes', { from_day: r.from, to_day: r.to });
        case 'push_devices': return ok({ data: deps.announce?.devices ? await deps.announce.devices().catch(() => null) : null });
        case 'announcements': return ok({ data: store.announcements ? await store.announcements(Math.min(lim, 30)) : [] });
        case 'money': return call('admin_money', { from_day: r.from, to_day: r.to });
        case 'cashouts': return call('admin_cashouts', { from_day: r.from, to_day: r.to });
        case 'payouts': { const p = await store.payouts(lim, off, isWallet(str(q.wallet)) ? str(q.wallet).toLowerCase() : null); return ok({ data: p.rows, total: p.total }); }
        case 'admins': return ok({ data: (await store.admins()).map(({ pass_hash: _p, ...a }) => a) });
        case 'actions': return ok({ data: await store.actions(lim) });
        default: return fail(404, 'unknown');
      }
    },

    /** Record a prize that was paid (or is owed). Paid by hand today, so this is the ledger. */
    /** Tell every player what is new: a message in the bell (and the pop-up on the home screen),
     *  and a push if one was written. Admins and above. Nothing goes out unless the admin has
     *  ticked that the release is live, the lengths fit, and the link stays on the site. */
    async announce(email: unknown, body: Record<string, unknown>): Promise<Reply> {
      const me = await who(email, 'admin'); if (isReply(me)) return me;
      if (!deps.announce) return fail(503, 'unavailable');
      const raw = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
      const title = raw(body.title), text = raw(body.body), pushTitle = raw(body.pushTitle), pushBody = raw(body.pushBody);
      const url = raw(body.url) || '/dashboard';
      // `pushOnly`: the news is already in the bell and only the push is wanted (or wanted again)
      const pushOnly = body.pushOnly === true;
      if (body.live !== true) return fail(400, 'confirm_live');
      if (pushOnly && !(pushTitle && pushBody)) return fail(400, 'push_needs_both');
      if (!pushOnly && (!title || !text)) return fail(400, 'title_and_text_needed');
      if (title.length > 80) return fail(400, 'title_too_long');
      if (text.length > 400) return fail(400, 'text_too_long');
      if (!!pushTitle !== !!pushBody) return fail(400, 'push_needs_both');
      if (pushTitle.length > 60 || pushBody.length > 160) return fail(400, 'push_too_long');
      if (!/^\/[a-z0-9/_?=&#.-]*$/i.test(url) || url.startsWith('//') || url.startsWith('/admin')) return fail(400, 'bad_link'); // a page of the app, never the dashboard, never another site
      const key = (raw(body.key) || `news-${new Date(now()).toISOString().slice(0, 10)}-${pushOnly ? 'push-' + pushTitle : title}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
      if (!pushOnly) {
        const posted = await deps.announce.bell({ title, body: text, url, kind: 'whats_new', dedupeKey: key });
        if (!posted.ok) return fail(503, 'could_not_post');
        if (!posted.created) return fail(409, 'already_sent');
      }
      let pushed: PushResult | null = null;
      if (pushTitle) pushed = await deps.announce.push({ title: pushTitle, body: pushBody, url, tag: key }).catch((e) => { deps.logger?.warn('announce: the push could not be sent:', String((e as Error)?.message ?? e)); return { sent: 0, skipped: 0, failed: 0, crashed: true, why: String((e as Error)?.message ?? e).slice(0, 140) }; });
      await store.log(me.email, pushOnly ? 'push_sent' : 'announcement_sent', { title: pushOnly ? null : title, url, key, push: pushTitle || null, pushed: pushed?.sent ?? null, devices: pushed?.devices ?? null, expired: pushed?.expired ?? null, failed: pushed?.failed ?? null, why: pushed?.why ?? null });
      // the whole story of the push, so "0" is never a mystery: how many phones, and what became of each
      return ok({ ok: true, pushed: pushed?.sent ?? null, push: pushed });
    },
    async recordPayout(email: unknown, body: Record<string, unknown>): Promise<Reply> {
      const me = await who(email, 'admin'); if (isReply(me)) return me;
      const wallet = str(body.wallet); const amount = Number(body.amount);
      const status = ['pending', 'sent', 'confirmed', 'failed'].includes(str(body.status)) ? str(body.status) : 'sent';
      const tx = str(body.txHash, 80);
      if (!isWallet(wallet)) return fail(400, 'bad_wallet');
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return fail(400, 'bad_amount');
      if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) return fail(400, 'bad_tx');
      if ((status === 'sent' || status === 'confirmed') && !tx) return fail(400, 'tx_needed');
      const paidAt = str(body.paidAt) && !Number.isNaN(Date.parse(str(body.paidAt))) ? new Date(str(body.paidAt)).toISOString() : status === 'pending' ? null : new Date(now()).toISOString();
      const row = { wallet: wallet.toLowerCase(), amount, token: str(body.token, 12) || 'G$', reason: str(body.reason, 160) || null, status, tx_hash: tx ? tx.toLowerCase() : null, paid_at: paidAt, note: str(body.note, 300) || null, recorded_by: me.email };
      const err = await store.addPayout(row);
      if (err) return fail(/duplicate|unique/i.test(err) ? 409 : 503, /duplicate|unique/i.test(err) ? 'already_recorded' : 'unavailable');
      await store.log(me.email, 'payout_recorded', { wallet: row.wallet, amount, token: row.token, status, tx: row.tx_hash });
      await store.event({ kind: 'payout_recorded', wallet: row.wallet, ref: `${amount} ${row.token}`, tx_hash: row.tx_hash });
      return ok({ ok: true });
    },
    async setPayoutStatus(email: unknown, body: Record<string, unknown>): Promise<Reply> {
      const me = await who(email, 'admin'); if (isReply(me)) return me;
      const id = Number(body.id); const status = str(body.status);
      if (!Number.isInteger(id) || !['pending', 'sent', 'confirmed', 'failed'].includes(status)) return fail(400, 'bad_request');
      const err = await store.setPayoutStatus(id, status); if (err) return fail(503, 'unavailable');
      await store.log(me.email, 'payout_status', { id, status });
      return ok({ ok: true });
    },

    async saveAdmin(email: unknown, body: Record<string, unknown>): Promise<Reply> {
      const me = await who(email, 'super_admin'); if (isReply(me)) return me;
      const target = str(body.email).toLowerCase(); const role = str(body.role) as Role; const password = typeof body.password === 'string' ? body.password : '';
      if (!isEmail(target)) return fail(400, 'bad_email');
      if (!(role in RANK)) return fail(400, 'bad_role');
      if (password.length < 12) return fail(400, 'weak_password'); // twelve characters or more
      const err = await store.saveAdmin({ email: target, name: str(body.name, 80) || null, role, pass_hash: hashPassword(password), created_by: me.email });
      if (err) return fail(503, 'unavailable');
      await store.log(me.email, 'admin_saved', { email: target, role });
      return ok({ ok: true });
    },
    async disableAdmin(email: unknown, body: Record<string, unknown>): Promise<Reply> {
      const me = await who(email, 'super_admin'); if (isReply(me)) return me;
      const target = str(body.email).toLowerCase(); const disabled = body.disabled !== false;
      if (target === me.email && disabled) return fail(400, 'not_yourself'); // nobody locks themselves out
      const err = await store.setDisabled(target, disabled); if (err) return fail(503, 'unavailable');
      await store.log(me.email, disabled ? 'admin_disabled' : 'admin_enabled', { email: target });
      return ok({ ok: true });
    },

    /** Page views and named events from the site, for everyone, signed in or not. */
    async track(body: Record<string, unknown>): Promise<Reply> {
      const list = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
      const minute = Math.floor(now() / 60_000);
      const batch: Record<string, unknown>[] = [];
      for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const x = e as Record<string, unknown>; const anon = str(x.anon_id, 40);
        if (!/^[a-zA-Z0-9_-]{8,40}$/.test(anon)) continue;
        const s = seen.get(anon);
        if (s && s.at === minute) { if (s.n >= 60) continue; s.n++; } else seen.set(anon, { n: 1, at: minute });
        const kind = str(x.kind, 40) || 'pageview';
        if (!/^[a-z0-9_]{2,40}$/.test(kind)) continue;
        batch.push({ anon_id: anon, wallet: isWallet(str(x.wallet)) ? str(x.wallet) : null, kind, path: str(x.path, 200).split('?')[0] || null, ref: str(x.ref, 120) || null,
          device: ['phone', 'tablet', 'desktop'].includes(str(x.device)) ? str(x.device) : null, embed: ['minipay', 'vatar'].includes(str(x.embed)) ? str(x.embed) : null,
          props: x.props && typeof x.props === 'object' && JSON.stringify(x.props).length <= 400 ? x.props : null });
      }
      if (seen.size > 20_000) seen.clear();
      if (!batch.length) return ok({ stored: 0 });
      const r = await store.rpc('admin_track', { batch });
      return ok({ stored: r.error ? 0 : Number(r.data) || 0 });
    },

    /** Something happened that has no table of its own (a failed transaction). Never throws. */
    async note(kind: string, f: { wallet?: string | null; game?: string | null; ref?: string | null; tx_hash?: string | null; data?: unknown } = {}): Promise<void> {
      try { await store.event({ kind, ...f, wallet: f.wallet ? String(f.wallet).toLowerCase() : null }); } catch { /* an event that cannot be written is not worth failing for */ }
    },

    /** Hourly: yesterday's and today's numbers. */
    async rollup(): Promise<boolean> { return !(await store.rpc('admin_rollup_recent', {})).error; },
    /** Every day, from the start. Needed while the chain history is still being read in: old days keep changing. */
    async rebuildAll(): Promise<boolean> { return !(await store.rpc('admin_backfill', {})).error; },

    /** Check the verification of the wallets whose answer is the most out of date. Returns how many changed to verified. */
    async sweepVerification(isVerified: (wallet: string) => Promise<boolean | Identity>, batch = 25): Promise<{ checked: number; newly: number; failed: number; error?: string }> {
      const q = await store.rpc('admin_verify_queue', { lim: batch });
      const wallets = Array.isArray(q.data) ? (q.data as { wallet: string }[]).map((r) => r.wallet).filter((w) => isWallet(String(w))) : [];
      let checked = 0; let newly = 0; let failed = 0; let error: string | undefined = q.error ?? undefined;
      for (const w of wallets) {
        let id: Identity;
        try { const a = await isVerified(w); id = typeof a === 'boolean' ? { verified: a, state: a ? 'verified' : 'none' } : a; }
        catch (e) { failed++; error ??= String((e as Error)?.message || e).slice(0, 140); continue; } // a chain error is "unknown", never "not verified"
        // the full picture: verified, lapsed, never or blacklisted; by itself or through a linked wallet; since when, until when
        const state = id.state ?? (id.verified ? 'verified' : 'none');
        const r = await store.rpc('admin_set_identity', { w, st: state, is_self: id.self ?? id.verified, via: id.root ?? null, added: id.at ?? null, authed: id.authAt ?? null, expires: id.expiresAt ?? null, on_probation: id.probation ?? null });
        if (!r.error) { checked++; if (r.data === true) newly++; } else { failed++; error ??= r.error; }
      }
      return { checked, newly, failed, ...(error ? { error } : {}) };
    },
  };
}
export type AdminService = ReturnType<typeof createAdmin>;
