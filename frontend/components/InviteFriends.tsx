"use client";

// Inside an open friend room: the player's friends, each with an Invite
// button. The friend gets a notification that opens the game with the room
// code filled in. Shown only to a signed-in player; with no friends yet it
// points to the Friends page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { explainFriends, friendLabel, useFriends } from "@/hooks/useFriends";
import { track } from "@/lib/track";

export default function InviteFriends({ game, code }: { game: string; code: string }) {
  const f = useFriends(); const router = useRouter();
  const [open, setOpen] = useState(false); const [sent, setSent] = useState<Record<string, "sending" | "sent" | string>>({});
  if (!f.signedIn || f.state !== "ready") return null;
  const invite = (wallet: string) => { setSent((s) => ({ ...s, [wallet]: "sending" })); track("friend_invited", { game }); f.invite(wallet, game, code).then(() => setSent((s) => ({ ...s, [wallet]: "sent" }))).catch((e: Error) => setSent((s) => ({ ...s, [wallet]: explainFriends(e.message) }))); };
  return (
    <div className="if">
      <button className="if-top" onClick={() => (f.friends.length ? setOpen((o) => !o) : router.push("/friends"))} aria-expanded={open}>{f.friends.length ? `Invite a friend · ${f.friends.filter((p) => p.online).length} online` : "Add friends to invite them"}<span>{f.friends.length ? (open ? "▴" : "▾") : "›"}</span></button>
      {open && <ul>{f.friends.map((p) => { const st = sent[p.wallet]; return (
        <li key={p.wallet}><span><i className={p.online ? "on" : ""} aria-hidden />{friendLabel(p)}{p.online ? <small> online</small> : null}</span>{st && st !== "sending" && st !== "sent" ? <em>{st}</em> : <button disabled={st === "sending" || st === "sent"} onClick={() => invite(p.wallet)}>{st === "sent" ? "Invited ✓" : st === "sending" ? "Sending…" : "Invite"}</button>}</li>
      ); })}</ul>}
      <style>{`
        .if { display: grid; gap: 8px; }
        .if-top { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 46px; padding: 0 14px; border-radius: 13px; border: 2px solid rgba(109,40,217,0.28); background: #fff; color: #4c1d95; font-weight: 800; font-size: 14.5px; cursor: pointer; }
        .if ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 180px; overflow-y: auto; }
        .if li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 12px; background: #f4eeff; color: #22104f; font-weight: 700; font-size: 14.5px; }
        .if li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .if li span i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #c9c2dc; margin-right: 8px; } .if li span i.on { background: #22c55e; } .if li small { color: #15803d; font-weight: 700; }
        .if li button { flex: 0 0 auto; min-height: 38px; padding: 0 16px; border: none; border-radius: 10px; background: #6d28d9; color: #fff; font-weight: 800; font-size: 13.5px; cursor: pointer; } .if li button:disabled { background: #c4b5fd; cursor: default; }
        .if li em { font-style: normal; font-size: 12.5px; color: #b91c1c; text-align: right; }
      `}</style>
    </div>
  );
}
