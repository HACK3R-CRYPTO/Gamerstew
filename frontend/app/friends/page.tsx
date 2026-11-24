"use client";

// ─── Friends ─────────────────────────────────────────────────────────────────
// Add a friend by their GameArena name or by sharing your link, answer
// requests, and see your list. A link looks like /friends?add=0x…: opening it
// while signed in fills the box, and one tap sends the request.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppBottomNav from "@/components/AppBottomNav";
import AppHeader from "@/components/AppHeader";
import { explainFriends, friendLabel, seenLabel, useFriends, type Found, type Friend } from "@/hooks/useFriends";
import { track } from "@/lib/track";

const face = (f: Friend) => (f.name ?? f.wallet.slice(2)).slice(0, 1).toUpperCase();
const tint = (w: string) => `hsl(${parseInt(w.slice(2, 8), 16) % 360} 62% 46%)`;

export default function FriendsPage() {
  const router = useRouter(); const f = useFriends();
  // on a wide screen the four main places sit in the top bar, as on every other page
  const [wide, setWide] = useState(false);
  useEffect(() => { const q = window.matchMedia("(min-width: 900px)"); const on = () => setWide(q.matches); on(); q.addEventListener("change", on); return () => q.removeEventListener("change", on); }, []);
  const [to, setTo] = useState(""); const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null); const [busy, setBusy] = useState(""); const [copied, setCopied] = useState(false); const [sure, setSure] = useState("");
  // ── Finding someone ───────────────────────────────────────────────────────
  // Names are suggested while the player types (after a short pause, so a fast
  // typist does not send a request per letter). A friend link (?add=0x…) is
  // kept through sign-in and shown as one card with one button.
  const [found, setFound] = useState<Found[] | null>(null); const [looking, setLooking] = useState(false); const [linked, setLinked] = useState<Found | null>(null);
  const latest = useRef(0); const search = f.search;
  useEffect(() => {
    const q = to.trim();
    if (f.state !== "ready" || q.length < 2) { setFound(null); setLooking(false); return; }
    const id = ++latest.current; setLooking(true);
    const t = setTimeout(() => { search(q).then((r) => { if (latest.current === id) { setFound(r); setLooking(false); } }).catch(() => { if (latest.current === id) { setFound([]); setLooking(false); } }); }, 260);
    return () => clearTimeout(t);
  }, [to, f.state, search]);
  useEffect(() => {
    let a = new URLSearchParams(window.location.search).get("add") || "";
    try { if (/^0x[0-9a-fA-F]{40}$/.test(a)) window.localStorage.setItem("ga_add_friend", a); else a = window.localStorage.getItem("ga_add_friend") || ""; } catch { /* no storage: the link still works while signed in */ }
    if (f.state !== "ready" || !/^0x[0-9a-fA-F]{40}$/.test(a)) return;
    try { window.localStorage.removeItem("ga_add_friend"); } catch { /* fine */ }
    if (a.toLowerCase() === f.me) return;
    search(a).then((r) => { if (r[0]) setLinked(r[0]); }).catch(() => {});
  }, [f.state, f.me, search]);
  const [local, setLocal] = useState<Record<string, Found["state"]>>({});
  const stateOf0 = (p: Found) => local[p.wallet] ?? p.state;
  // ── Tabs, and the players who are online right now ─────────────────────────
  // "Online now" is everyone with the app open, friend or not, so a player with
  // no friends still has people to add without knowing a name.
  const [tab, setTab] = useState<"friends" | "online" | "requests">("friends"); const picked = useRef(false);
  const [people, setPeople] = useState<Found[] | null>(null); const getPeople = f.people;
  useEffect(() => {
    if (f.state !== "ready") return;
    let live = true; const look = () => getPeople().then((r) => { if (live) setPeople(r); }).catch(() => { if (live) setPeople((x) => x ?? []); });
    void look(); const t = setInterval(() => { if (document.visibilityState === "visible") void look(); }, 30000);
    return () => { live = false; clearInterval(t); };
  }, [f.state, getPeople]);
  const others = (people ?? []).filter((p) => stateOf0(p) !== "friends");
  // open on what needs the player: a waiting request first, people to meet when the list is empty
  useEffect(() => { if (f.state !== "ready" || picked.current) return; picked.current = true; if (f.incoming.length) setTab("requests"); else if (f.friends.length === 0) setTab("online"); }, [f.state, f.incoming.length, f.friends.length]);
  // the button a result shows, and what tapping it does; the result changes at once and is put right if the server refuses
  const stateOf = (p: Found) => local[p.wallet] ?? p.state;
  const tapFound = (p: Found) => {
    const was = stateOf(p); if (was === "asked" || was === "friends") return;
    const next: Found["state"] = was === "incoming" ? "friends" : "asked";
    setLocal((m) => ({ ...m, [p.wallet]: next })); setMsg(null); track("friend_request");
    (was === "incoming" ? f.accept(p.wallet) : f.ask(p.wallet)).then((d) => { if (d.state === "friends") setLocal((m) => ({ ...m, [p.wallet]: "friends" })); }).catch((e: Error) => { setLocal((m) => ({ ...m, [p.wallet]: was })); setMsg({ text: explainFriends(e.message), good: false }); });
  };
  const FoundRow = ({ p, online }: { p: Found; online?: boolean }) => { const st = stateOf(p); return (
    <li><span className="av" style={{ background: tint(p.wallet) }}>{(p.name ?? p.wallet.slice(2)).slice(0, 1).toUpperCase()}{online && <i className="dot" aria-hidden />}</span><span className="nm"><b>{friendLabel(p)}</b></span>
      <span className="acts"><button className={st === "none" || st === "incoming" ? "yes" : "done"} disabled={st === "asked" || st === "friends"} onClick={() => tapFound(p)}>{st === "friends" ? "Friends ✓" : st === "asked" ? "Requested ✓" : st === "incoming" ? "Accept" : "Add"}</button></span></li>
  ); };
  const link = f.me && typeof window !== "undefined" ? `${window.location.origin}/friends?add=${f.me}` : "";
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => { setBusy(key); setMsg(null); try { await fn(); setMsg({ text: done, good: true }); } catch (e) { setMsg({ text: explainFriends((e as Error).message), good: false }); } finally { setBusy(""); } };
  const share = () => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); };

  const Row = ({ p, children }: { p: Friend; children: React.ReactNode }) => (
    <li><span className="av" style={{ background: tint(p.wallet) }}>{face(p)}{p.online && <i className="dot" aria-hidden />}</span><button className="nm" onClick={() => router.push(`/pass/${p.name ?? p.wallet}`)}><b>{friendLabel(p)}</b><small className={p.online ? "on" : ""}>{seenLabel(p) || (p.since && f.friends.includes(p) ? "Offline" : "")}</small></button><span className="acts">{children}</span></li>
  );

  return (
    <div className="frp">
    <AppHeader tone="light" />
    <main className="fr">
      <header><button onClick={() => router.back()} aria-label="Back">←</button><h1>Friends{f.state === "ready" && f.friends.some((p) => p.online) ? <em><i /> {f.friends.filter((p) => p.online).length} online</em> : null}</h1><span /></header>

      {f.state === "guest" && <div className="empty"><b>Sign in to add friends</b><span>Your friends list is saved to your account, so it follows you to every device.</span><button className="go" onClick={() => router.push("/home?signin=1")}>Sign in</button></div>}
      {f.state === "loading" && <p className="note">Loading your friends…</p>}
      {f.state === "error" && <div className="empty"><b>Could not load your friends</b><span>Check your connection and try again.</span><button className="go" onClick={() => void f.refresh()}>Try again</button></div>}

      {f.state === "ready" && (
        <div className="cols">
          <div className="col">
          {linked && stateOf(linked) !== "friends" && (
            <section className="card hi">
              <label>{stateOf(linked) === "incoming" ? "They asked to be your friend" : "Add this player?"}</label>
              <ul><FoundRow p={linked} /></ul>
            </section>
          )}
          <section className="card">
            <label htmlFor="fr-to">Find a player</label>
            <div className="addrow"><input id="fr-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Type a GameArena name" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="search" />{to && <button className="clear" onClick={() => setTo("")} aria-label="Clear">✕</button>}</div>
            {to.trim().length === 1 && <p className="hint">Keep typing…</p>}
            {looking && !found && <p className="hint">Searching…</p>}
            {found && found.length > 0 && <ul className="found">{found.map((p) => <FoundRow key={p.wallet} p={p} />)}</ul>}
            {found && found.length === 0 && !looking && <p className="hint">No player starts with “{to.trim()}”. Ask them for their friend link instead.</p>}
            {msg && <p className={`msg ${msg.good ? "good" : "bad"}`} role="status">{msg.text}</p>}
            <div className="or"><span>or</span></div>
            <div className="sharerow"><a className="wa" href={`https://wa.me/?text=${encodeURIComponent(`Add me on GameArena and let's play: ${link}`)}`} target="_blank" rel="noreferrer">Send my link on WhatsApp</a><button className="share" onClick={share}>{copied ? "Copied ✓" : "Copy link"}</button></div>
          </section>

          </div>
          <div className="col">
          {/* one place for everyone you can play with: your friends, the players online right now, and requests */}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "on" : ""} onClick={() => setTab("friends")}>Friends <i>{f.friends.length}</i></button>
            <button role="tab" aria-selected={tab === "online"} className={tab === "online" ? "on" : ""} onClick={() => setTab("online")}><u /> Online now <i>{others.length}</i></button>
            <button role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "on" : ""} onClick={() => setTab("requests")}>Requests {f.incoming.length > 0 ? <i className="hot">{f.incoming.length}</i> : <i>{f.outgoing.length}</i>}</button>
          </div>
          {tab === "friends" && (<>
          <section><h2>Your friends · {f.friends.length}{f.friends.some((p) => p.online) ? <em> · {f.friends.filter((p) => p.online).length} online</em> : null}</h2>
            {f.friends.length === 0 ? <p className="note left">No friends yet. Find a player above, or send your link on WhatsApp.</p> : <ul>{f.friends.map((p) => <Row key={p.wallet} p={p}>{sure === p.wallet ? <><button className="no" onClick={() => { setSure(""); void run(p.wallet, () => f.remove(p.wallet), "Removed."); }}>Remove</button><button className="plain" onClick={() => setSure("")}>Keep</button></> : <button className="plain" onClick={() => setSure(p.wallet)} aria-label={`Remove ${friendLabel(p)}`}>✕</button>}</Row>)}</ul>}
            {f.friends.length > 0 && <p className="note left">To play together, open a room in any game and tap “Invite a friend”.</p>}
          </section>
          </>)}
          {tab === "online" && (
            <section><h2>Players online now · {others.length}</h2>
              {people === null ? <p className="note left">Looking for players…</p> : others.length === 0 ? <p className="note left">Nobody else has the app open right now. Share your link and bring someone in.</p> : <ul className="found open">{others.map((p) => <FoundRow key={p.wallet} p={p} online />)}</ul>}
              <p className="note left">These are players with GameArena open right now. Add one and invite them to a room.</p>
            </section>
          )}
          {tab === "requests" && (<>
          {f.incoming.length > 0 && <section><h2>Requests · {f.incoming.length}</h2><ul>{f.incoming.map((p) => <Row key={p.wallet} p={p}><button className="yes" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.accept(p.wallet), "You are now friends.")}>Accept</button><button className="no" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.remove(p.wallet), "Request declined.")}>Decline</button></Row>)}</ul></section>}
          {f.outgoing.length > 0 && <section><h2>Waiting for an answer · {f.outgoing.length}</h2><ul>{f.outgoing.map((p) => <Row key={p.wallet} p={p}><button className="plain" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.remove(p.wallet), "Request cancelled.")}>Cancel</button></Row>)}</ul></section>}
            {f.incoming.length === 0 && f.outgoing.length === 0 && <p className="note left">No requests waiting. When someone adds you, it shows here and in your notifications.</p>}
          </>)}
          </div>
        </div>
      )}
      </main>
      <AppBottomNav wide={wide} tone="light" />
      <style>{`
        .frp { min-height: 100dvh; width: 100%; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .fr { padding: 14px 16px calc(120px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 16px; max-width: 560px; margin: 0 auto; }
        .tabs { display: flex; gap: 6px; padding: 5px; border-radius: 16px; background: rgba(255,255,255,0.7); box-shadow: 0 0 0 1px rgba(76,29,149,0.1); }
        .tabs button { flex: 1; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 12px; background: transparent; color: rgba(34,16,79,0.7); font-weight: 800; font-size: 13.5px; cursor: pointer; white-space: nowrap; padding: 0 6px; }
        .tabs button.on { background: #22104f; color: #fff; } .tabs i { font-style: normal; font-size: 11.5px; padding: 2px 7px; border-radius: 999px; background: rgba(109,40,217,0.14); } .tabs button.on i { background: rgba(255,255,255,0.2); } .tabs i.hot { background: #dc2626 !important; color: #fff; }
        .tabs u { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; text-decoration: none; flex: 0 0 auto; }
        .found.open li { background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.1); }
        .cols, .col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .fr h1 em { font: 800 14px ui-sans-serif, system-ui, sans-serif; color: #15803d; margin-left: 12px; vertical-align: middle; display: inline-flex; align-items: center; gap: 6px; } .fr h1 em i { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.2); }
        @media (min-width: 900px) {
          .fr { max-width: 1180px; padding: 26px 32px 80px; }
          .fr header { grid-template-columns: 1fr !important; } .fr header button, .fr header > span { display: none; } .fr h1 { text-align: left !important; font-size: 34px !important; }
          .cols { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 28px; align-items: start; }
          .col:first-child { position: sticky; top: 96px; }
          .col:last-child ul { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
        }
        .fr header { display: grid; grid-template-columns: 48px 1fr 48px; align-items: center; } .fr header button { width: 44px; height: 44px; border-radius: 14px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); font-size: 19px; color: #22104f; cursor: pointer; }
        .fr h1 { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 30px; margin: 0; text-align: center; } .fr h2 { font-size: 12.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(34,16,79,0.72); margin: 0 2px 8px; }
        .card { background: #fff; border-radius: 20px; padding: 16px; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 18px 30px -26px rgba(76,29,149,0.8); display: grid; gap: 10px; } .card label { font-weight: 800; font-size: 15px; }
        .addrow { display: flex; gap: 8px; } .addrow input { flex: 1; min-width: 0; padding: 13px 14px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.25); font-size: 16px; color: #22104f; background: #faf7ff; } .addrow input:focus { outline: none; border-color: #6d28d9; }
        .addrow button, .go { padding: 0 20px; min-height: 48px; border: none; border-radius: 14px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 15.5px; cursor: pointer; } .addrow button:disabled { opacity: 0.5; cursor: default; }
        .share { min-height: 46px; padding: 0 16px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.3); background: #fff; color: #6d28d9; font-weight: 800; font-size: 14.5px; cursor: pointer; white-space: nowrap; }
        .sharerow { display: flex; gap: 8px; } .wa { flex: 1; min-height: 46px; display: grid; place-items: center; border-radius: 14px; background: #16a34a; color: #fff !important; font-weight: 800; font-size: 14.5px; text-decoration: none; text-align: center; padding: 0 10px; }
        .or { display: flex; align-items: center; gap: 10px; color: rgba(34,16,79,0.5); font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; } .or::before, .or::after { content: ""; flex: 1; height: 1px; background: rgba(76,29,149,0.14); }
        .addrow { position: relative; } .clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 38px; min-height: 38px !important; padding: 0 !important; background: transparent !important; box-shadow: none !important; color: rgba(34,16,79,0.55) !important; }
        .hint { margin: 0; font-size: 14px; color: rgba(34,16,79,0.66); } .found li, .card.hi li { box-shadow: none; background: #f6f1ff; animation: frIn .22s ease both; } @keyframes frIn { from { opacity: 0; transform: translateY(6px); } }
        .card.hi { box-shadow: 0 0 0 2px #7c3aed, 0 18px 30px -22px rgba(76,29,149,0.9); } .done { background: #dcfce7; color: #166534; } .acts button { transition: background .18s ease, color .18s ease, transform .12s ease; } .acts button:active { transform: scale(0.96); }
        span.nm { cursor: default; display: flex; align-items: center; }
        @media (prefers-reduced-motion: reduce) { .found li, .card.hi li { animation: none; } .acts button { transition: none; } }
        .msg { margin: 0; font-size: 14.5px; font-weight: 600; } .msg.good { color: #15803d; } .msg.bad { color: #b91c1c; }
        .fr ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; } .fr li { display: flex; align-items: center; gap: 12px; background: #fff; border-radius: 16px; padding: 10px 12px; box-shadow: 0 0 0 1px rgba(76,29,149,0.1); }
        .av { position: relative; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 17px; flex: 0 0 auto; }
        .dot { position: absolute; right: -1px; bottom: -1px; width: 13px; height: 13px; border-radius: 50%; background: #22c55e; border: 2.5px solid #fff; }
        .fr h2 em { font-style: normal; color: #15803d; }
        .nm b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .nm small { display: block; font-size: 12.5px; font-weight: 600; color: rgba(34,16,79,0.62); margin-top: 1px; } .nm small.on { color: #15803d; }
        .nm { flex: 1; min-width: 0; text-align: left; background: none; border: none; font-weight: 800; font-size: 16px; color: #22104f; cursor: pointer; padding: 6px 0; min-height: 44px; }
        .acts { display: flex; gap: 6px; flex: 0 0 auto; } .acts button { min-height: 40px; padding: 0 14px; border-radius: 12px; font-weight: 800; font-size: 14px; cursor: pointer; border: none; } .acts button:disabled { opacity: 1; cursor: default; }
        .yes { background: #6d28d9; color: #fff; } .no { background: #fee2e2; color: #991b1b; } .plain { background: #f1ecfb; color: #4c1d95; }
        .note { margin: 0; font-size: 14.5px; color: rgba(34,16,79,0.72); text-align: center; } .note.left { text-align: left; margin: 8px 2px 0; }
        .empty { margin-top: 10vh; display: grid; gap: 10px; text-align: center; justify-items: center; } .empty b { font-size: 21px; } .empty span { color: rgba(34,16,79,0.72); font-size: 15px; line-height: 1.45; max-width: 320px; } .empty .go { margin-top: 6px; }
      `}</style>
    </div>
  );
}
