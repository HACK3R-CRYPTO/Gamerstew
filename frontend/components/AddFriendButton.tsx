"use client";

// "Add friend" on another player's passport. It knows where the two of you
// stand and shows the one thing you can do next: Add, Accept, or nothing more
// (Requested, Friends). A guest is sent to sign in. Hidden on your own passport.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { explainFriends, useFriends, type Found } from "@/hooks/useFriends";
import { track } from "@/lib/track";

export default function AddFriendButton({ wallet }: { wallet: string }) {
  const f = useFriends(); const router = useRouter(); const w = wallet.toLowerCase();
  const [st, setSt] = useState<Found["state"] | null>(null); const [err, setErr] = useState("");
  const search = f.search;
  useEffect(() => { if (f.state === "ready" && f.me !== w) search(w).then((r) => setSt(r[0]?.state ?? "none")).catch(() => setSt("none")); }, [f.state, f.me, w, search]);
  if (f.me === w || f.state === "loading") return null;
  if (f.state === "guest") return <button onClick={() => { try { window.localStorage.setItem("ga_add_friend", w); } catch { /* fine */ } router.push("/home?signin=1"); }} style={base}>Sign in to add as a friend</button>;
  if (f.state !== "ready" || st === null) return null;
  const tap = () => {
    if (st === "asked" || st === "friends") return;
    const was = st; setErr(""); setSt(was === "incoming" ? "friends" : "asked"); track("friend_request", { from: "passport" });
    (was === "incoming" ? f.accept(w) : f.ask(w)).then((d) => { if (d.state === "friends") setSt("friends"); }).catch((e: Error) => { setSt(was); setErr(explainFriends(e.message)); });
  };
  const done = st === "asked" || st === "friends";
  return (<>
    <button onClick={tap} disabled={done} style={{ ...base, ...(done ? { background: "#dcfce7", color: "#166534", boxShadow: "none", cursor: "default" } : {}) }}>{st === "friends" ? "Friends ✓" : st === "asked" ? "Friend request sent ✓" : st === "incoming" ? "Accept friend request" : "👥 Add friend"}</button>
    {err && <div role="status" style={{ textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#b91c1c" }}>{err}</div>}
  </>);
}
const base: React.CSSProperties = { borderRadius: 16, border: "none", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", color: "#fff", padding: "14px", fontWeight: 800, fontSize: 16, cursor: "pointer", boxShadow: "0 5px 0 #4c1d95", transition: "background .18s ease" };
