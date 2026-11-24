"use client";

// ─── Friends ─────────────────────────────────────────────────────────────────
// Add a friend by their GameArena name or by sharing your link, answer
// requests, and see your list. A link looks like /friends?add=0x…: opening it
// while signed in fills the box, and one tap sends the request.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppBottomNav from "@/components/AppBottomNav";
import { explainFriends, friendLabel, useFriends, type Friend } from "@/hooks/useFriends";
import { track } from "@/lib/track";

const face = (f: Friend) => (f.name ?? f.wallet.slice(2)).slice(0, 1).toUpperCase();
const tint = (w: string) => `hsl(${parseInt(w.slice(2, 8), 16) % 360} 62% 46%)`;

export default function FriendsPage() {
  const router = useRouter(); const f = useFriends();
  const [to, setTo] = useState(""); const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null); const [busy, setBusy] = useState(""); const [copied, setCopied] = useState(false); const [sure, setSure] = useState("");
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("add") || ""; if (/^0x[0-9a-fA-F]{40}$/.test(a)) setTo(a); }, []);
  const link = f.me && typeof window !== "undefined" ? `${window.location.origin}/friends?add=${f.me}` : "";
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => { setBusy(key); setMsg(null); try { await fn(); setMsg({ text: done, good: true }); } catch (e) { setMsg({ text: explainFriends((e as Error).message), good: false }); } finally { setBusy(""); } };
  const add = () => { const v = to.trim(); if (!v) return; track("friend_request"); setBusy("add"); setMsg(null); f.ask(v).then((d) => { setTo(""); setMsg({ text: d.state === "friends" ? "You are now friends." : "Request sent. They will see it in their notifications.", good: true }); }).catch((e: Error) => setMsg({ text: explainFriends(e.message), good: false })).finally(() => setBusy("")); };
  const share = () => { const text = `Add me on GameArena and let's play: ${link}`; if (navigator.share) void navigator.share({ title: "Add me on GameArena", text, url: link }).catch(() => {}); else { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } };

  const Row = ({ p, children }: { p: Friend; children: React.ReactNode }) => (
    <li><span className="av" style={{ background: tint(p.wallet) }}>{face(p)}</span><button className="nm" onClick={() => router.push(`/pass/${p.name ?? p.wallet}`)}>{friendLabel(p)}</button><span className="acts">{children}</span></li>
  );

  return (
    <main className="fr">
      <header><button onClick={() => router.back()} aria-label="Back">←</button><h1>Friends</h1><span /></header>

      {f.state === "guest" && <div className="empty"><b>Sign in to add friends</b><span>Your friends list is saved to your account, so it follows you to every device.</span><button className="go" onClick={() => router.push("/home?signin=1")}>Sign in</button></div>}
      {f.state === "loading" && <p className="note">Loading your friends…</p>}
      {f.state === "error" && <div className="empty"><b>Could not load your friends</b><span>Check your connection and try again.</span><button className="go" onClick={() => void f.refresh()}>Try again</button></div>}

      {f.state === "ready" && (
        <>
          <section className="card">
            <label htmlFor="fr-to">Add a friend</label>
            <div className="addrow"><input id="fr-to" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Their GameArena name" autoCapitalize="none" autoCorrect="off" spellCheck={false} /><button onClick={add} disabled={!to.trim() || busy === "add"}>{busy === "add" ? "Sending…" : "Add"}</button></div>
            <button className="share" onClick={share}>{copied ? "Link copied" : "Share my friend link"}</button>
            {msg && <p className={`msg ${msg.good ? "good" : "bad"}`} role="status">{msg.text}</p>}
          </section>

          {f.incoming.length > 0 && <section><h2>Requests · {f.incoming.length}</h2><ul>{f.incoming.map((p) => <Row key={p.wallet} p={p}><button className="yes" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.accept(p.wallet), "You are now friends.")}>Accept</button><button className="no" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.remove(p.wallet), "Request declined.")}>Decline</button></Row>)}</ul></section>}

          <section><h2>Your friends · {f.friends.length}</h2>
            {f.friends.length === 0 ? <p className="note left">No friends yet. Add one by name, or share your link on WhatsApp.</p> : <ul>{f.friends.map((p) => <Row key={p.wallet} p={p}>{sure === p.wallet ? <><button className="no" onClick={() => { setSure(""); void run(p.wallet, () => f.remove(p.wallet), "Removed."); }}>Remove</button><button className="plain" onClick={() => setSure("")}>Keep</button></> : <button className="plain" onClick={() => setSure(p.wallet)} aria-label={`Remove ${friendLabel(p)}`}>✕</button>}</Row>)}</ul>}
            {f.friends.length > 0 && <p className="note left">To play together, open a room in any game and tap “Invite a friend”.</p>}
          </section>

          {f.outgoing.length > 0 && <section><h2>Waiting for an answer · {f.outgoing.length}</h2><ul>{f.outgoing.map((p) => <Row key={p.wallet} p={p}><button className="plain" disabled={busy === p.wallet} onClick={() => void run(p.wallet, () => f.remove(p.wallet), "Request cancelled.")}>Cancel</button></Row>)}</ul></section>}
        </>
      )}
      <AppBottomNav tone="light" />
      <style>{`
        .fr { min-height: 100dvh; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #efe6ff 55%, #e6dbff 100%); color: #22104f; padding: calc(10px + env(safe-area-inset-top)) 16px calc(120px + env(safe-area-inset-bottom)); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; gap: 16px; max-width: 560px; margin: 0 auto; }
        .fr header { display: grid; grid-template-columns: 48px 1fr 48px; align-items: center; } .fr header button { width: 44px; height: 44px; border-radius: 14px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.14); font-size: 19px; color: #22104f; cursor: pointer; }
        .fr h1 { font-family: "Melon Pop", sans-serif; font-weight: 400; font-size: 30px; margin: 0; text-align: center; } .fr h2 { font-size: 12.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(34,16,79,0.72); margin: 0 2px 8px; }
        .card { background: #fff; border-radius: 20px; padding: 16px; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 18px 30px -26px rgba(76,29,149,0.8); display: grid; gap: 10px; } .card label { font-weight: 800; font-size: 15px; }
        .addrow { display: flex; gap: 8px; } .addrow input { flex: 1; min-width: 0; padding: 13px 14px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.25); font-size: 16px; color: #22104f; background: #faf7ff; } .addrow input:focus { outline: none; border-color: #6d28d9; }
        .addrow button, .go { padding: 0 20px; min-height: 48px; border: none; border-radius: 14px; background: linear-gradient(180deg,#7c3aed,#6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 15.5px; cursor: pointer; } .addrow button:disabled { opacity: 0.5; cursor: default; }
        .share { min-height: 46px; border-radius: 14px; border: 2px solid rgba(109,40,217,0.3); background: #fff; color: #6d28d9; font-weight: 800; font-size: 15px; cursor: pointer; }
        .msg { margin: 0; font-size: 14.5px; font-weight: 600; } .msg.good { color: #15803d; } .msg.bad { color: #b91c1c; }
        .fr ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; } .fr li { display: flex; align-items: center; gap: 12px; background: #fff; border-radius: 16px; padding: 10px 12px; box-shadow: 0 0 0 1px rgba(76,29,149,0.1); }
        .av { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 17px; flex: 0 0 auto; }
        .nm { flex: 1; min-width: 0; text-align: left; background: none; border: none; font-weight: 800; font-size: 16px; color: #22104f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; padding: 10px 0; }
        .acts { display: flex; gap: 6px; flex: 0 0 auto; } .acts button { min-height: 40px; padding: 0 14px; border-radius: 12px; font-weight: 800; font-size: 14px; cursor: pointer; border: none; } .acts button:disabled { opacity: 0.5; }
        .yes { background: #6d28d9; color: #fff; } .no { background: #fee2e2; color: #991b1b; } .plain { background: #f1ecfb; color: #4c1d95; }
        .note { margin: 0; font-size: 14.5px; color: rgba(34,16,79,0.72); text-align: center; } .note.left { text-align: left; margin: 8px 2px 0; }
        .empty { margin-top: 10vh; display: grid; gap: 10px; text-align: center; justify-items: center; } .empty b { font-size: 21px; } .empty span { color: rgba(34,16,79,0.72); font-size: 15px; line-height: 1.45; max-width: 320px; } .empty .go { margin-top: 6px; }
      `}</style>
    </main>
  );
}
