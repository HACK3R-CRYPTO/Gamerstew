"use client";

// ─── Friends on the home screen ──────────────────────────────────────────────
// One row under the greeting that answers "is anyone on right now?" without a
// tap: friends' faces, a green dot on the ones with the app open, and a count.
// A player with no friends yet gets one line that says how to start. Guests
// see nothing. The whole row opens the Friends page.

import { useRouter } from "next/navigation";
import { friendLabel, useFriends } from "@/hooks/useFriends";

const tint = (w: string) => `hsl(${parseInt(w.slice(2, 8), 16) % 360} 62% 46%)`;

export default function FriendsStrip() {
  const f = useFriends(); const router = useRouter();
  if (f.state !== "ready") return null;
  const on = f.friends.filter((p) => p.online); const asks = f.incoming.length;
  const shown = f.friends.slice(0, 7); // already sorted: online first
  return (
    <button className="fst" onClick={() => router.push("/friends")} aria-label={`Friends. ${on.length} online${asks ? `. ${asks} request${asks === 1 ? "" : "s"} waiting` : ""}`}>
      {f.friends.length === 0 ? (
        <><span className="fst-plus">+</span><span className="fst-text"><b>Add friends</b><small>See who is online and play together</small></span></>
      ) : (
        <>
          <span className="fst-faces">{shown.map((p) => <span key={p.wallet} className="fst-face" style={{ background: tint(p.wallet) }} title={`${friendLabel(p)}${p.online ? " · online" : ""}`}>{(p.name ?? p.wallet.slice(2)).slice(0, 1).toUpperCase()}{p.online && <i />}</span>)}{f.friends.length > shown.length && <span className="fst-face more">+{f.friends.length - shown.length}</span>}</span>
          <span className="fst-text">{on.length > 0 ? <b className="on"><i /> {on.length} online now</b> : <b>No friends online</b>}<small>{on.length > 0 ? `${on.slice(0, 2).map(friendLabel).join(", ")}${on.length > 2 ? ` and ${on.length - 2} more` : ""}` : `${f.friends.length} friend${f.friends.length === 1 ? "" : "s"}`}</small></span>
        </>
      )}
      {asks > 0 && <span className="fst-ask">{asks} request{asks === 1 ? "" : "s"}</span>}
      <span className="fst-go">›</span>
      <style>{`
        .fst { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; border-radius: 18px; border: none; background: #fff; box-shadow: 0 0 0 1px rgba(76,29,149,0.12), 0 14px 26px -24px rgba(76,29,149,0.9); cursor: pointer; text-align: left; color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; min-height: 60px; }
        .fst-faces { display: flex; flex: 0 0 auto; } .fst-face { position: relative; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 15px; border: 2.5px solid #fff; margin-left: -10px; } .fst-face:first-child { margin-left: 0; }
        .fst-face i { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 50%; background: #22c55e; border: 2.5px solid #fff; } .fst-face.more { background: #ede4ff; color: #4c1d95; font-size: 12px; }
        .fst-plus { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #ede4ff; color: #6d28d9; font-size: 22px; font-weight: 800; flex: 0 0 auto; }
        .fst-text { display: grid; gap: 1px; min-width: 0; flex: 1; } .fst-text b { font-size: 15px; display: flex; align-items: center; gap: 6px; } .fst-text b.on { color: #15803d; } .fst-text b.on i { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.2); }
        .fst-text small { font-size: 13px; color: rgba(34,16,79,0.66); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fst-ask { flex: 0 0 auto; padding: 6px 11px; border-radius: 999px; background: #6d28d9; color: #fff; font-size: 12.5px; font-weight: 800; } .fst-go { flex: 0 0 auto; font-size: 22px; color: rgba(34,16,79,0.45); }
      `}</style>
    </button>
  );
}
