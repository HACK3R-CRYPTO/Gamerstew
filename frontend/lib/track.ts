// First-party visit and event tracking. No third-party script, no cookies, no
// network address stored: a random id kept in this browser says "the same
// visitor", and that is all. Events are batched and sent with sendBeacon so
// they never hold a page up.
//
//   track("game_start", { game: "stack" })
//
// Page views are sent by <Track /> in the root layout.

type Ev = { anon_id: string; wallet?: string | null; kind: string; path: string; ref?: string; device: string; embed?: string | null; props?: Record<string, unknown> };
let queue: Ev[] = []; let timer: number | null = null; let wallet: string | null = null; let embed: string | null = null;

function anonId(): string {
  try {
    let id = window.localStorage.getItem("ga_aid");
    if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20); window.localStorage.setItem("ga_aid", id); }
    return id;
  } catch { return "nostore_" + Math.random().toString(36).slice(2, 12); } // private mode: still counted, as a new visitor
}
const device = () => (window.innerWidth < 640 ? "phone" : window.innerWidth < 1024 ? "tablet" : "desktop");

function flush() {
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue.splice(0, 20) });
  try { if (!navigator.sendBeacon?.("/api/t", new Blob([body], { type: "application/json" }))) void fetch("/api/t", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {}); } catch { /* never throws into the app */ }
  if (queue.length) timer = window.setTimeout(flush, 1500);
}

export function setTrackIdentity(w: string | null | undefined, where: string | null) { wallet = w ? w.toLowerCase() : null; embed = where; }

export function track(kind: string, props?: Record<string, unknown>, extra?: { ref?: string }) {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/admin")) return; // the dashboard does not count itself
  queue.push({ anon_id: anonId(), wallet, kind, path: window.location.pathname, ref: extra?.ref, device: device(), embed, props });
  if (timer === null) timer = window.setTimeout(flush, 1200);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
