"use client";

// A friend is calling this player into a room, right now. It drops in at the
// top of whatever screen they are on, says who and which game, and offers one
// thing: Join. It never covers the screen, never takes the keyboard and never
// stops a run in progress: a player in the middle of a game can finish it and
// the invite is still in the bell.
//
// It stays for as long as the invite is worth answering (the server counts the
// time; the bar drains), not for a few seconds: something a person has to
// decide on should not vanish while they are reading it.

import { useEffect, useState } from "react";
import type { OwnInvite } from "@/lib/ownLine";

const DISPLAY = '"Melon Pop", "Fredoka", ui-sans-serif, system-ui, sans-serif';

export default function InvitePopup({ invite, onJoin, onClose }: { invite: OwnInvite; onJoin: () => void; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  const who = invite.name ? `@${invite.name}` : "A friend";
  const letter = (invite.name || "F").slice(0, 1).toUpperCase();
  return (
    <div className={`inv${shown ? " in" : ""}`} role="status" aria-live="polite">
      <div className="inv-card">
        <span className="inv-face" aria-hidden="true">{letter}<i /></span>
        <span className="inv-text"><b>{who}</b><span>Invited you to {invite.gameName}</span></span>
        <button className="inv-join" onClick={onJoin}>Join</button>
        <button className="inv-x" onClick={onClose} aria-label="Not now">✕</button>
        <span className="inv-time" aria-hidden="true"><i style={{ animationDuration: `${Math.max(1000, invite.left)}ms` }} /></span>
      </div>
      <style>{`
        .inv { position: fixed; z-index: 240; top: calc(env(safe-area-inset-top, 0px) + 10px); left: 0; right: 0; display: flex; justify-content: center; padding: 0 12px; pointer-events: none; transform: translateY(-140%); opacity: 0; transition: transform 320ms cubic-bezier(0.2, 0.9, 0.25, 1.15), opacity 200ms ease; }
        .inv.in { transform: translateY(0); opacity: 1; }
        .inv-card { pointer-events: auto; position: relative; overflow: hidden; display: flex; align-items: center; gap: 12px; width: 100%; max-width: 440px; padding: 12px 12px 15px 14px; border-radius: 22px; background: #fbf8ff; border: 1.5px solid rgba(124,58,237,0.22); box-shadow: 0 18px 44px rgba(34,16,79,0.28), 0 2px 0 rgba(34,16,79,0.06); }
        .inv-face { position: relative; flex: none; width: 44px; height: 44px; border-radius: 15px; display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, #a78bfa, #6d28d9); color: #fff; font: 400 22px ${DISPLAY}; }
        .inv-face i { position: absolute; right: -3px; bottom: -3px; width: 13px; height: 13px; border-radius: 50%; background: #22c55e; border: 2.5px solid #fbf8ff; }
        .inv-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
        .inv-text b { font: 700 15.5px "Fredoka", system-ui, sans-serif; color: #22104f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .inv-text span { font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif; font-size: 13.5px; font-weight: 500; color: rgba(34,16,79,0.7); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .inv-join { flex: none; min-height: 44px; padding: 0 18px; border: none; border-radius: 14px; background: linear-gradient(180deg, #7c3aed, #6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font: 400 17px ${DISPLAY}; letter-spacing: 0.3px; cursor: pointer; }
        .inv-join:active { transform: translateY(2px); box-shadow: 0 2px 0 #4c1d95; }
        .inv-x { flex: none; width: 34px; height: 44px; margin-left: -6px; border: none; background: none; color: rgba(34,16,79,0.5); font-size: 16px; cursor: pointer; border-radius: 12px; }
        .inv-x:hover { background: rgba(124,58,237,0.08); }
        .inv-join:focus-visible, .inv-x:focus-visible { outline: 3px solid #c4b5fd; outline-offset: 2px; }
        .inv-time { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(124,58,237,0.12); }
        .inv-time i { display: block; height: 100%; background: #7c3aed; transform-origin: left; animation: inv-drain linear forwards; }
        @keyframes inv-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
        @media (prefers-reduced-motion: reduce) { .inv { transition: opacity 200ms ease; transform: none; } }
      `}</style>
    </div>
  );
}
