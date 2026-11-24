"use client";

import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const STORAGE_KEY = "gamearena:push:asked";

// PushOptInModal — appears once after a player has had a meaningful win,
// not on first page load. Acceptance rate triples when you ask AFTER
// value is delivered (Duolingo, Slack, every retention-focused app).
//
// Trigger: parent renders <PushOptInModal trigger={true} /> when the right
// moment fires (a win that beat threshold, a streak crossed 3 days, etc).
//
// We only ask once per device; the localStorage flag prevents nagging.

export function PushOptInModal({
  walletAddress,
  trigger,
}: {
  walletAddress?: string;
  trigger: boolean;          // parent flips this true to show
}) {
  const { state, subscribe } = usePushNotifications(walletAddress);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    // Already asked / decided / unsupported — never re-prompt.
    if (state === "unsupported" || state === "denied" || state === "subscribed") return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY)) return;
    setOpen(true);
  }, [trigger, state]);

  if (!open) return null;

  const close = () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  const accept = async () => {
    setBusy(true);
    await subscribe();
    setBusy(false);
    close();
  };

  return (
    <div onClick={close} style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(34,16,79,0.45)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: "380px",
        borderRadius: "20px",
        background: "#fbf8ff",
        border: "1px solid rgba(76,29,149,0.16)",
        boxShadow: "0 0 40px rgba(167,139,250,0.4), 0 24px 48px rgba(0,0,0,0.7)",
        padding: "24px 22px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "44px" }}>🔔</div>
        <div style={{
          color: "#22104f", fontSize: "16px", fontWeight: 900,
          marginTop: "10px", letterSpacing: "0.02em",
        }}>
          Don&apos;t lose your streak
        </div>
        <div style={{
          color: "rgba(34,16,79,0.72)", fontSize: "12px",
          lineHeight: 1.5, marginTop: "10px",
        }}>
          Get a heads-up before your streak ends. We&apos;ll only ping you for streaks, cup deadlines, and rank changes — never spam.
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "18px" }}>
          <button onClick={close} disabled={busy} style={{
            flex: 1, padding: "11px",
            borderRadius: "999px",
            background: "#fff",
            border: "1px solid rgba(76,29,149,0.18)",
            color: "#22104f",
            fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em",
            cursor: busy ? "not-allowed" : "pointer",
          }}>NOT NOW</button>
          <button onClick={accept} disabled={busy} style={{
            flex: 2, padding: "11px",
            borderRadius: "999px",
            background: "linear-gradient(180deg, #c084fc 0%, #7c3aed 100%)",
            border: "none",
            color: "white",
            fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em",
            cursor: busy ? "not-allowed" : "pointer",
            boxShadow: "0 0 16px rgba(124,58,237,0.5)",
            opacity: busy ? 0.7 : 1,
          }}>{busy ? "ENABLING…" : "TURN ON ALERTS"}</button>
        </div>
      </div>
    </div>
  );
}
