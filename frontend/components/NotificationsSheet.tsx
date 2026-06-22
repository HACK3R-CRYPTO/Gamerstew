"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// Tokens shared with the rest of the redesigned app · settings, shop,
// game-over sheets. Same dark gradient + magenta accent so the bell
// surface reads as part of the same family.
const T = {
  bg: "linear-gradient(180deg, rgba(20,8,52,0.98) 0%, rgba(8,2,28,0.99) 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// localStorage cutoff: items posted at or before this timestamp count as
// "already seen" and are HIDDEN from the feed entirely. Mark-all-read
// advances the cutoff to the newest item's ts so the list empties out.
function lastReadKey(addr?: string) {
  return addr ? `gamearena:notif:lastRead:${addr.toLowerCase()}` : null;
}
function readLastRead(addr?: string): number {
  const key = lastReadKey(addr);
  if (!key) return 0;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? Number(raw) : 0;
  } catch { return 0; }
}
function writeLastRead(addr: string, ts: number) {
  const key = lastReadKey(addr);
  if (!key) return;
  try { window.localStorage.setItem(key, String(ts)); } catch { /* private mode */ }
}

function fmtAgo(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "Yesterday";
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isToday(ts: number): boolean {
  const d = new Date(ts * 1000);
  const today = new Date();
  return d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
}

// Only "important" event types make the feed — the same events that
// trigger backend push notifications. Three sources:
//   1. /api/notifications  — server-logged sends (broadcasts + per-wallet
//      pushes that lib/push.js already records). Catches anything we
//      "would have texted you about": new seasons, rank changes, mission
//      expirations, wager results, re-engagement nudges.
//   2. /api/achievements    — unlock events with timestamps.
//   3. /api/badges          — weekly podium finishes (top-3 leaderboard).
// Score events are NOT notifications — players just played them, they're
// not news. The old activity-feed approach swamped the bell with noise.
type ApiAchievement = { id: string; icon: string; name: string; desc: string; unlocked: boolean; unlockedAt: number | null };
type ApiBadge = { season: number; game: string; rank: number; type: "gold" | "silver" | "bronze"; awardedAt: number };
type ApiNotification = { id: string; isBroadcast: boolean; category: string; title: string; body: string | null; url: string | null; tag: string | null; sentAt: number };

type NotificationItem = {
  id: string;
  icon: string;
  color: string;
  title: string;
  sub: string;
  ts: number;
  url?: string | null;
};

// Map a server-side push `category` to a visual identity. New categories
// fall through to the default purple icon — they still surface, just
// without a tailored color.
function iconColorForCategory(category: string, isBroadcast: boolean): { icon: string; color: string } {
  if (isBroadcast || category === "broadcast") return { icon: "📣", color: "#a78bfa" };
  if (category.startsWith("achievement_")) return { icon: "🏆", color: "#fbbf24" };
  if (category.startsWith("wager_")) return { icon: "🤖", color: "#f97316" };
  if (category === "rank_change") return { icon: "📈", color: "#06b6d4" };
  if (category.startsWith("close_rank_chase")) return { icon: "🎯", color: "#fbbf24" };
  if (category.startsWith("close_rank_climb")) return { icon: "📈", color: "#22c55e" };
  if (category === "cup_deadline") return { icon: "⏰", color: "#fbbf24" };
  if (category === "streak_warning") return { icon: "🔥", color: "#f97316" };
  if (category === "daily_g_claim") return { icon: "🪙", color: "#fde68a" };
  if (category === "mission_expire") return { icon: "⏳", color: "#a78bfa" };
  if (category.startsWith("reengagement_")) return { icon: "👋", color: "#a78bfa" };
  if (category === "welcome") return { icon: "✨", color: "#a78bfa" };
  return { icon: "🔔", color: "#a78bfa" };
}

function buildFeed(achievements: ApiAchievement[], badges: ApiBadge[], pushFeed: ApiNotification[]): NotificationItem[] {
  const fromAch: NotificationItem[] = achievements
    .filter(a => a.unlocked && a.unlockedAt)
    .map(a => ({
      id: `ach-${a.id}`,
      icon: a.icon || "🏆",
      color: "#fbbf24",
      title: `Achievement unlocked · ${a.name}`,
      sub: a.desc,
      ts: a.unlockedAt as number,
    }));
  const fromBadges: NotificationItem[] = badges.map(b => {
    const medal = b.type === "gold" ? "🥇" : b.type === "silver" ? "🥈" : "🥉";
    const gameName = b.game === "rhythm" ? "Rhythm Rush" : b.game === "simon" ? "Simon Memory" : b.game.toUpperCase();
    const color = b.type === "gold" ? "#fbbf24" : b.type === "silver" ? "#e2e8f0" : "#f97316";
    const rankLabel = b.rank === 1 ? "#1 finish" : `#${b.rank} finish`;
    return {
      id: `badge-${b.season}-${b.game}-${b.type}`,
      icon: medal,
      color,
      title: `${rankLabel} · ${gameName}`,
      sub: `Week ${b.season} podium`,
      ts: b.awardedAt,
    };
  });
  // Push-feed rows already arrive in the right shape (title, body,
  // sentAt); we only need to pick an icon + color from the category.
  // Achievement-category pushes are skipped here because the
  // /api/achievements source already produces a richer row for the
  // same event (unlock dedup via the `ach-{id}` key would also work,
  // but filtering keeps the merge cheap and predictable).
  const fromPush: NotificationItem[] = pushFeed
    .filter(p => !p.category.startsWith("achievement_"))
    .map(p => {
      const ic = iconColorForCategory(p.category, p.isBroadcast);
      return {
        id: `push-${p.id}`,
        icon: ic.icon,
        color: ic.color,
        title: p.title,
        sub: p.body || "",
        ts: p.sentAt,
        url: p.url,
      };
    });
  return [...fromAch, ...fromBadges, ...fromPush].sort((a, b) => b.ts - a.ts);
}

async function fetchFeedData(address: string): Promise<{ achievements: ApiAchievement[]; badges: ApiBadge[]; pushFeed: ApiNotification[] }> {
  const [achRes, badgeRes, notifRes] = await Promise.all([
    fetch(`${BACKEND_URL}/api/achievements/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${BACKEND_URL}/api/badges/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${BACKEND_URL}/api/notifications/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return {
    achievements: Array.isArray(achRes?.achievements) ? achRes.achievements : [],
    badges: Array.isArray(badgeRes?.badges) ? badgeRes.badges : [],
    pushFeed: Array.isArray(notifRes?.notifications) ? notifRes.notifications : [],
  };
}

export default function NotificationsSheet({
  address,
  open,
  onClose,
}: {
  address?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [achievements, setAchievements] = useState<ApiAchievement[]>([]);
  const [badges, setBadges] = useState<ApiBadge[]>([]);
  const [pushFeed, setPushFeed] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRead, setLastRead] = useState<number>(0);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Hydrate lastRead per address so a wallet swap doesn't bleed read
  // state between two players sharing a browser.
  useEffect(() => {
    if (!address) { setLastRead(0); return; }
    setLastRead(readLastRead(address));
  }, [address]);

  // Fetch both feeds whenever the panel opens. Refetch-on-open means a
  // notification that arrived in another tab is reflected when this one
  // is opened, without polling in the background.
  useEffect(() => {
    if (!open || !address) return;
    let cancelled = false;
    setLoading(true);
    fetchFeedData(address).then(({ achievements: ach, badges: bgs, pushFeed: pf }) => {
      if (cancelled) return;
      setAchievements(ach);
      setBadges(bgs);
      setPushFeed(pf);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, address]);

  // ESC closes on every viewport.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const allItems = useMemo(() => buildFeed(achievements, badges, pushFeed), [achievements, badges, pushFeed]);
  // Hide anything older than the lastRead cutoff. The feed is a queue of
  // unread notifications, not an archive — "all caught up" is the
  // intended terminal state.
  const items = allItems.filter(i => i.ts > lastRead);
  const today = items.filter(i => isToday(i.ts));
  const earlier = items.filter(i => !isToday(i.ts));

  const markAllRead = () => {
    if (!address || allItems.length === 0) return;
    const cutoff = Math.max(...allItems.map(i => i.ts));
    setLastRead(cutoff);
    writeLastRead(address, cutoff);
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // ── Desktop popover · anchored top-right under the bell ──────────────
  // Bottom sheets read as a mobile gesture; on desktop the same content
  // wants to feel like a dropdown menu. Click-outside dismisses (the
  // outer overlay div catches the event), ESC dismisses too.
  if (isDesktop) {
    return createPortal(
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "transparent",
          animation: "notif-fade-in 0.18s ease both",
        }}
      >
        <style>{`
          @keyframes notif-fade-in { from { opacity: 0 } to { opacity: 1 } }
          @keyframes notif-pop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
          @keyframes notif-row-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(10px); } }
        `}</style>
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "fixed",
            // Anchored under the header band (68px) on the right edge,
            // matching the header's inner padding (32px on desktop).
            top: 76, right: 32,
            width: 380, maxHeight: "calc(100vh - 110px)",
            display: "flex", flexDirection: "column",
            borderRadius: 18,
            background: T.bg,
            border: `1px solid ${T.hairlineHi}`,
            boxShadow: "0 24px 60px -10px rgba(0,0,0,0.7), 0 0 0 1px rgba(167,139,250,0.08)",
            animation: "notif-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          <Header onClose={onClose} canMarkRead={items.length > 0} onMarkRead={markAllRead} />
          <div style={{ overflowY: "auto", padding: "8px 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Body address={address} loading={loading} items={items} today={today} earlier={earlier} />
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile bottom sheet ─────────────────────────────────────────────
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(2,0,12,0.78)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "notif-fade 0.24s ease both",
      }}
    >
      <style>{`
        @keyframes notif-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes notif-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes notif-row-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(10px); } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520,
          maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          borderRadius: "26px 26px 0 0",
          background: T.bg,
          border: `1px solid ${T.hairlineHi}`,
          borderBottom: "none",
          boxShadow: `0 -24px 60px -10px ${T.accent}33`,
          paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
          animation: "notif-up 0.42s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 44, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
        </div>
        <Header onClose={onClose} canMarkRead={items.length > 0} onMarkRead={markAllRead} />
        <div style={{ overflowY: "auto", padding: "4px 16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Body address={address} loading={loading} items={items} today={today} earlier={earlier} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Header({ onClose, canMarkRead, onMarkRead }: { onClose: () => void; canMarkRead: boolean; onMarkRead: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 10px", borderBottom: `1px solid ${T.hairline}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>Activity</div>
        <h1 style={{ fontFamily: T.display, fontSize: 20, color: T.ink, margin: "1px 0 0", lineHeight: 1.1, letterSpacing: "-0.005em" }}>Notifications</h1>
      </div>
      {canMarkRead && (
        <button onClick={onMarkRead} style={{
          background: "transparent", border: "none", cursor: "pointer",
          fontFamily: T.body, fontSize: 10.5, color: T.accent, fontWeight: 800, letterSpacing: "0.06em",
          padding: "4px 6px",
        }}>MARK ALL READ</button>
      )}
      <button onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, cursor: "pointer", color: T.inkDim }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

function Body({ address, loading, items, today, earlier }: {
  address?: string;
  loading: boolean;
  items: NotificationItem[];
  today: NotificationItem[];
  earlier: NotificationItem[];
}) {
  if (!address) {
    return <EmptyState lead="🔔" lines={["Sign in to see your activity.", "Achievement unlocks and weekly badges will land here."]} />;
  }
  if (loading && items.length === 0) {
    return <EmptyState lead="" lines={["Loading…"]} />;
  }
  if (items.length === 0) {
    return <EmptyState lead="🔔" lines={["You're all caught up.", "Win a badge or unlock an achievement and it'll show up here."]} />;
  }
  return (
    <>
      {today.length > 0 && <Group label="Today" items={today} />}
      {earlier.length > 0 && <Group label="Earlier" items={earlier} />}
    </>
  );
}

function Group({ label, items }: { label: string; items: NotificationItem[] }) {
  return (
    <div>
      <div style={{ padding: "0 4px 6px", fontFamily: T.body, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(n => (
          <div key={n.id} style={{
            display: "flex", alignItems: "flex-start", gap: 11,
            padding: "10px 12px", borderRadius: 14,
            background: `${T.accent}14`,
            border: `1px solid ${T.accent}3d`,
            transition: "opacity 0.2s ease, transform 0.2s ease",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: `radial-gradient(circle at 35% 30%, ${n.color}cc, ${n.color}33)`,
              border: `1px solid ${n.color}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>{n.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 700, lineHeight: 1.3 }}>{n.title}</div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, marginTop: 2, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.sub}</div>
              <div style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, marginTop: 4, fontWeight: 700, letterSpacing: "0.04em" }}>{fmtAgo(n.ts)}</div>
            </div>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: T.accent, boxShadow: `0 0 8px ${T.accent}`, flexShrink: 0, marginTop: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ lead, lines }: { lead: string; lines: string[] }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 18px", color: T.inkSoft, fontFamily: T.body, fontSize: 12.5, lineHeight: 1.55, display: "flex", flexDirection: "column", gap: 6 }}>
      {lead && <div style={{ fontSize: 28, lineHeight: 1 }}>{lead}</div>}
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

// Tiny hook so consumers (the header bell) can show an unread badge
// without mounting the full sheet. Reads the same data + cutoff the
// sheet uses; refreshes on tab focus so a fresh notification posted
// elsewhere lights the dot when the user comes back.
export function useUnreadNotificationsCount(address?: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!address) { setCount(0); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const { achievements, badges, pushFeed } = await fetchFeedData(address);
        if (cancelled) return;
        const items = buildFeed(achievements, badges, pushFeed);
        const lr = readLastRead(address);
        setCount(items.filter(i => i.ts > lr).length);
      } catch { /* network error · keep stale count */ }
    };

    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Listen for `storage` so a Mark-all-read in another tab updates
    // this tab's badge immediately too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === lastReadKey(address)) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [address]);

  return count;
}
