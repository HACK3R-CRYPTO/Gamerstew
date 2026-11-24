"use client";

// ─── The bell: a player's inbox ──────────────────────────────────────────────
// Everything GameArena has told this player, newest first. Read and deleted are
// kept on the server (games-backend/src/modules/inbox), so marking something
// read on a phone marks it read on a laptop, and a deleted notification stays
// deleted.
//
//   · two tabs: everything, and what came from GameArena itself (announcements
//     and "what's new")
//   · tap a notification to open where it points; that also marks it read
//   · ✕ deletes one; "Clear all" empties the inbox; "Mark all read" clears the dot
//
// Changes show at once and are then sent to the server. If the server refuses,
// the change is put back and the player is told.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { inboxList, inboxUnread, inboxMarkRead, inboxDelete, type InboxItem, type InboxKind } from "@/app/actions/game";

const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';
const LOOK: Record<InboxKind, { icon: string; tint: string; label: string }> = {
  announcement: { icon: "📣", tint: "#6d28d9", label: "GameArena" },
  whats_new: { icon: "✨", tint: "#6d28d9", label: "What's new" },
  reward: { icon: "🏆", tint: "#b45309", label: "Reward" },
  rank: { icon: "📈", tint: "#0369a1", label: "Ranking" },
  reminder: { icon: "⏰", tint: "#be123c", label: "Reminder" },
  activity: { icon: "🔔", tint: "#6d28d9", label: "Update" },
};

function ago(sec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// one place that knows how to ask for this player's token
function useInboxAuth() {
  const { getAccessToken } = usePrivy();
  const isMiniPay = useIsMiniPay();
  return useCallback(async () => (isMiniPay ? null : await getAccessToken().catch(() => null)), [isMiniPay, getAccessToken]);
}

// the bell's badge and the open sheet share one event, so deleting in the sheet updates the dot
const CHANGED = "gamearena:inbox-changed";
const announceChange = (unread: number) => { try { window.dispatchEvent(new CustomEvent(CHANGED, { detail: unread })); } catch { /* ignore */ } };

export default function NotificationsSheet({ address: realAddress, open, onClose }: { address?: string; open: boolean; onClose: () => void }) {
  // dev only: lets an automated test open the inbox for a test wallet without signing in
  const address = realAddress ?? (process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? (window as unknown as { __inboxWallet?: string }).__inboxWallet : undefined);
  const router = useRouter();
  const token = useInboxAuth();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [tab, setTab] = useState<"all" | "ours">("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loadingMore = useRef(false);

  const load = useCallback(async () => {
    if (!address) return;
    setState("loading");
    const page = await inboxList(await token(), address);
    if (!page.ok || page.unavailable) { setState("unavailable"); return; }
    setItems(page.items); setUnread(page.unread); setMore(page.more); setState("ready"); announceChange(page.unread);
  }, [address, token]);

  useEffect(() => { if (open) { setConfirmClear(false); setNote(null); void load(); } }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shown = useMemo(() => (tab === "ours" ? items.filter((i) => i.kind === "announcement" || i.kind === "whats_new") : items), [items, tab]);
  const oursUnread = items.filter((i) => !i.read && (i.kind === "announcement" || i.kind === "whats_new")).length;

  // show the change now; if the server says no, put it back
  const attempt = async (apply: () => void, undo: () => void, send: (t: string | null) => Promise<boolean>) => {
    if (!address) return;
    apply(); setNote(null);
    const ok = await send(await token());
    if (!ok) { undo(); setNote("That did not save. Check your connection and try again."); }
  };
  const setCount = (n: number) => { setUnread(n); announceChange(n); };

  const markRead = (it: InboxItem) => {
    if (it.read || !address) return;
    const before = items, was = unread;
    void attempt(() => { setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, read: true } : x))); setCount(Math.max(0, was - 1)); }, () => { setItems(before); setCount(was); }, (t) => inboxMarkRead(t, address, { ids: [it.id] }));
  };
  const remove = (it: InboxItem) => {
    if (!address) return;
    const before = items, was = unread;
    void attempt(() => { setItems((xs) => xs.filter((x) => x.id !== it.id)); if (!it.read) setCount(Math.max(0, was - 1)); }, () => { setItems(before); setCount(was); }, (t) => inboxDelete(t, address, { ids: [it.id] }));
  };
  const markAll = () => {
    if (!address) return;
    const before = items, was = unread;
    void attempt(() => { setItems((xs) => xs.map((x) => ({ ...x, read: true }))); setCount(0); }, () => { setItems(before); setCount(was); }, (t) => inboxMarkRead(t, address, { all: true }));
  };
  const clearAll = () => {
    if (!address) return;
    const before = items, was = unread, hadMore = more;
    setConfirmClear(false);
    void attempt(() => { setItems([]); setMore(false); setCount(0); }, () => { setItems(before); setMore(hadMore); setCount(was); }, (t) => inboxDelete(t, address, { all: true }));
  };
  // A long message opens up in place on the first tap, so it can be read in
  // full. Only the second tap (or a short message) follows its link. A link to
  // the page the player is already on is not offered: it would do nothing.
  const [wide, setWide] = useState<string | number | null>(null);
  const here = typeof window !== "undefined" ? window.location.pathname : "";
  const goes = (it: InboxItem) => !!it.url && it.url.split("?")[0] !== here;
  const openItem = (it: InboxItem) => {
    markRead(it);
    if ((it.body?.length ?? 0) > 90 && wide !== it.id) { setWide(it.id); return; }
    if (!it.url || !goes(it)) return;
    onClose();
    if (it.url.startsWith("/")) router.push(it.url); else window.open(it.url, "_blank", "noopener,noreferrer");
  };
  const loadMore = async () => {
    if (!address || loadingMore.current || !items.length) return;
    loadingMore.current = true;
    const page = await inboxList(await token(), address, items[items.length - 1].sentAt);
    loadingMore.current = false;
    if (page.ok) { setItems((xs) => [...xs, ...page.items.filter((p) => !xs.some((x) => x.id === p.id))]); setMore(page.more); }
  };

  if (!open || typeof document === "undefined") return null;
  // Drawn on the page itself, not inside the header that opens it: the header's
  // blur makes it the frame for anything fixed inside it, which trapped this
  // sheet in a 68-pixel strip on phones.
  return createPortal(
    <div className="nb-wrap" onClick={onClose}>
      <aside className="nb" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 style={{ fontFamily: DISPLAY }}>Notifications</h2>
          <button className="nb-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {!address ? (
          <div className="nb-empty"><b>Sign in to see your notifications</b><span>Rewards, rank changes and news from GameArena land here.</span><button className="nb-cta" onClick={() => { onClose(); router.push("/home?signin=1"); }}>Sign in</button></div>
        ) : (
          <>
            <div className="nb-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All{unread > 0 && <i>{unread > 99 ? "99+" : unread}</i>}</button>
              <button role="tab" aria-selected={tab === "ours"} className={tab === "ours" ? "on" : ""} onClick={() => setTab("ours")}>From GameArena{oursUnread > 0 && <i>{oursUnread}</i>}</button>
            </div>

            {state === "ready" && items.length > 0 && (
              <div className="nb-acts">
                {confirmClear ? (
                  <><span>Delete every notification?</span><button className="danger" onClick={clearAll}>Yes, clear all</button><button onClick={() => setConfirmClear(false)}>Keep them</button></>
                ) : (
                  <><button onClick={markAll} disabled={unread === 0}>Mark all read</button><button onClick={() => setConfirmClear(true)}>Clear all</button></>
                )}
              </div>
            )}
            {note && <div className="nb-note" role="alert">{note}</div>}

            <div className="nb-list">
              {state === "loading" && [0, 1, 2, 3].map((i) => <div key={i} className="nb-skel" style={{ animationDelay: `${i * 90}ms` }} />)}
              {state === "unavailable" && <div className="nb-empty"><b>Could not load your notifications</b><span>The game server did not answer.</span><button className="nb-cta" onClick={() => void load()}>Try again</button></div>}
              {state === "ready" && shown.length === 0 && (
                <div className="nb-empty"><b>{tab === "ours" ? "Nothing from GameArena yet" : "You're all caught up"}</b><span>{tab === "ours" ? "New games, events and news will show here." : "Rewards, rank changes and news will show here."}</span></div>
              )}
              {state === "ready" && shown.map((it, i) => {
                const look = LOOK[it.kind] ?? LOOK.activity;
                return (
                  <div key={it.id} className={`nb-row${it.read ? "" : " unread"}`} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <button className="nb-main" onClick={() => openItem(it)} aria-label={`${it.read ? "" : "Unread. "}${it.title}`}>
                      <span className="nb-ico" style={{ background: `${look.tint}18`, color: look.tint }}>{look.icon}</span>
                      <span className="nb-text">
                        <span className="nb-meta"><em style={{ color: look.tint }}>{look.label}</em><time>{ago(it.sentAt)}</time></span>
                        <b>{it.title}</b>
                        {it.body && <span className={`nb-body${wide === it.id ? " all" : ""}`}>{it.body}</span>}
                        {(it.body?.length ?? 0) > 90 && wide !== it.id ? <span className="nb-go">Read more ›</span> : goes(it) ? <span className="nb-go">Open ›</span> : null}
                      </span>
                    </button>
                    <button className="nb-del" onClick={() => remove(it)} aria-label={`Delete: ${it.title}`}>✕</button>
                  </div>
                );
              })}
              {state === "ready" && more && tab === "all" && <button className="nb-more" onClick={() => void loadMore()}>Show older</button>}
            </div>
          </>
        )}
      </aside>
      <style>{`
        .nb-wrap { position: fixed; inset: 0; z-index: 90; display: flex; justify-content: flex-end; align-items: flex-end; background: rgba(34,16,79,0.42); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: nbFade .2s ease both; }
        .nb { width: 100%; max-height: 88dvh; display: flex; flex-direction: column; background: #fbf8ff; color: #22104f; border-radius: 26px 26px 0 0; box-shadow: 0 -20px 50px -20px rgba(34,16,79,0.6); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; animation: nbUp .28s cubic-bezier(.2,.9,.3,1.1) both; padding-bottom: env(safe-area-inset-bottom, 0px); }
        @media (min-width: 900px) { .nb-wrap { align-items: stretch; } .nb { width: 420px; max-height: none; height: 100dvh; border-radius: 0; animation-name: nbIn; } }
        @keyframes nbFade { from { opacity: 0; } } @keyframes nbUp { from { transform: translateY(40px); opacity: 0; } } @keyframes nbIn { from { transform: translateX(40px); opacity: 0; } }
        .nb button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .nb header { display: flex; align-items: center; justify-content: space-between; padding: 18px 18px 8px; }
        .nb h2 { margin: 0; font-size: 26px; font-weight: 400; }
        .nb-x { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(76,29,149,0.16); background: #fff; }
        .nb-tabs { display: flex; gap: 6px; padding: 0 18px 10px; }
        .nb-tabs button { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(76,29,149,0.16); background: transparent; font-size: 13px; font-weight: 800; color: rgba(34,16,79,0.62); }
        .nb-tabs button.on { background: #22104f; border-color: #22104f; color: #fff; }
        .nb-tabs i { font-style: normal; min-width: 18px; padding: 1px 5px; border-radius: 999px; background: #6d28d9; color: #fff; font-size: 10.5px; text-align: center; }
        .nb-tabs button.on i { background: #fff; color: #22104f; }
        .nb-acts { display: flex; align-items: center; gap: 8px; padding: 0 18px 8px; font-size: 12.5px; font-weight: 700; flex-wrap: wrap; }
        .nb-acts span { color: rgba(34,16,79,0.7); margin-right: auto; }
        .nb-acts button { padding: 6px 12px; border-radius: 10px; border: 1px solid rgba(76,29,149,0.16); background: #fff; color: #6d28d9; font-weight: 800; }
        .nb-acts button:disabled { opacity: 0.4; cursor: default; } .nb-acts button.danger { background: #be123c; border-color: #be123c; color: #fff; }
        .nb-note { margin: 0 18px 8px; padding: 9px 12px; border-radius: 12px; background: #fff1f2; color: #be123c; font-size: 12.5px; font-weight: 700; }
        .nb-list { flex: 1; overflow-y: auto; padding: 2px 12px 16px; display: flex; flex-direction: column; gap: 7px; }
        .nb-row { display: flex; align-items: stretch; border-radius: 18px; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.1); animation: nbRow .3s ease both; }
        .nb-row.unread { box-shadow: 0 0 0 1.5px rgba(109,40,217,0.45); background: linear-gradient(90deg, #f3ecff, #fff 40%); }
        @keyframes nbRow { from { opacity: 0; transform: translateY(8px); } }
        .nb-main { flex: 1; min-width: 0; display: flex; gap: 11px; padding: 12px 4px 12px 12px; border: none; background: none; text-align: left; }
        .nb-ico { flex: none; width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 18px; }
        .nb-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .nb-meta { display: flex; align-items: center; gap: 8px; font-size: 10.5px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
        .nb-meta em { font-style: normal; } .nb-meta time { color: rgba(34,16,79,0.5); letter-spacing: 0; text-transform: none; font-weight: 700; }
        .nb-text b { font-size: 14.5px; line-height: 1.3; font-weight: 800; }
        .nb-row:not(.unread) .nb-text b { font-weight: 700; color: rgba(34,16,79,0.82); }
        .nb-body { font-size: 13px; line-height: 1.4; color: rgba(34,16,79,0.68); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
        .nb-body.all { display: block; -webkit-line-clamp: unset; overflow: visible; }
        .nb-go { font-size: 12px; font-weight: 800; color: #6d28d9; margin-top: 2px; }
        .nb-del { flex: none; width: 40px; border: none; background: none; color: rgba(34,16,79,0.38); font-size: 13px; border-radius: 0 18px 18px 0; }
        .nb-del:hover { color: #be123c; background: #fff1f2; }
        .nb-more { align-self: center; margin-top: 4px; padding: 9px 18px; border-radius: 999px; border: 1px solid rgba(76,29,149,0.18); background: #fff; font-size: 13px; font-weight: 800; color: #6d28d9; }
        .nb-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 44px 24px; }
        .nb-empty b { font-size: 16px; } .nb-empty span { font-size: 13.5px; line-height: 1.45; color: rgba(34,16,79,0.62); }
        .nb-cta { margin-top: 10px; padding: 11px 24px; border-radius: 14px; border: none; background: #6d28d9; color: #fff !important; font-weight: 900; }
        .nb-skel { height: 74px; border-radius: 18px; background: linear-gradient(90deg, #f1e9ff, #fff, #f1e9ff); background-size: 200% 100%; animation: nbShim 1.2s linear infinite; }
        @keyframes nbShim { to { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { .nb-wrap, .nb, .nb-row, .nb-skel { animation: none; } }
      `}</style>
    </div>,
    document.body,
  );
}

// The dot on the bell. Asks when the page gains focus, and listens for the
// sheet's own changes so reading or deleting there updates it at once.
export function useUnreadNotificationsCount(address?: string): number {
  const [count, setCount] = useState(0);
  const token = useInboxAuth();
  useEffect(() => {
    if (!address) { setCount(0); return; }
    let live = true;
    // the dot asks for the number only; the list is fetched when the bell is opened
    const refresh = async () => { const n = await inboxUnread(await token(), address).catch(() => null); if (live && n != null) setCount(n); };
    void refresh();
    const onChanged = (e: Event) => setCount(Number((e as CustomEvent).detail) || 0);
    window.addEventListener("focus", refresh);
    window.addEventListener(CHANGED, onChanged);
    return () => { live = false; window.removeEventListener("focus", refresh); window.removeEventListener(CHANGED, onChanged); };
  }, [address, token]);
  return count;
}
