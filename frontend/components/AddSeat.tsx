"use client";

// A small "+ Add" beside another player in a friend room: after a round, or in
// the lobby once someone has joined by code. It shows only for a signed-in
// seat that is not you, and only to a signed-in player. One tap sends the
// request; the button changes at once.

import { useState } from "react";
import { explainFriends, type useFriends } from "@/hooks/useFriends";
import { track } from "@/lib/track";

export default function AddSeat({ f, wallet }: { f: ReturnType<typeof useFriends>; wallet?: string }) {
  const [mine, setMine] = useState<"asked" | "friends" | null>(null); const [err, setErr] = useState("");
  const w = wallet?.toLowerCase();
  if (!w || f.state !== "ready" || w === f.me) return null;
  const friend = f.friends.find((p) => p.wallet === w);
  const st = mine ?? (friend ? "friends" : f.outgoing.some((p) => p.wallet === w) ? "asked" : f.incoming.some((p) => p.wallet === w) ? "incoming" : "none");
  if (st === "friends") return <span className="as-pill ok" title="Friends">{friend?.online ? "● " : ""}Friend ✓</span>;
  const tap = (e: React.MouseEvent) => {
    e.stopPropagation(); if (st === "asked") return;
    setErr(""); setMine(st === "incoming" ? "friends" : "asked"); track("friend_request", { from: "room" });
    (st === "incoming" ? f.accept(w) : f.ask(w)).then((d) => { if (d.state === "friends") setMine("friends"); }).catch((x: Error) => { setMine(null); setErr(explainFriends(x.message)); });
  };
  return (
    <button className={`as-pill${st === "asked" ? " sent" : ""}`} onClick={tap} disabled={st === "asked"} title={err || undefined} aria-label={st === "asked" ? "Friend request sent" : "Add as a friend"}>
      {err ? "Try again" : st === "asked" ? "Requested ✓" : st === "incoming" ? "Accept friend" : "+ Add friend"}
      <style>{`
        .as-pill { margin-left: 8px; display: inline-flex; align-items: center; min-height: 30px; padding: 0 11px; border-radius: 999px; border: none; background: #6d28d9; color: #fff; font: 800 12px ui-sans-serif, system-ui, sans-serif; cursor: pointer; white-space: nowrap; font-style: normal; transition: background .18s ease, transform .12s ease; }
        .as-pill:active { transform: scale(0.95); } .as-pill.sent { background: #dcfce7; color: #166534; cursor: default; } .as-pill.ok { background: #dcfce7; color: #166534; cursor: default; }
      `}</style>
    </button>
  );
}
