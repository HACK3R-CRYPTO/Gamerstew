"use client";

import { useEffect, useState } from "react";

// Once a browser hits Notification.permission === "denied" we cannot
// programmatically re-prompt — every browser locks this down for years
// to prevent permission-spam abuse. The only way back is the user
// manually unblocking from browser site settings.
//
// Showing a flat "Blocked in browser" tells the player WHAT but not HOW.
// This modal walks them through the steps for their actual browser, so
// "Blocked" stops being a dead-end.

type Browser = "chrome" | "safari-ios" | "safari-macos" | "firefox" | "edge" | "samsung" | "other";

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  // iOS Safari (and any iOS browser, which all use WebKit) — distinct path
  if (/iphone|ipad|ipod/.test(ua)) return "safari-ios";
  // Order matters — Edge/Opera/Samsung embed Chrome's UA string
  if (/edg\//.test(ua))      return "edge";
  if (/samsungbrowser/.test(ua)) return "samsung";
  if (/firefox|fxios/.test(ua))  return "firefox";
  if (/chrome|crios/.test(ua))   return "chrome";
  if (/safari/.test(ua))         return "safari-macos";
  return "other";
}

function stepsFor(browser: Browser): { title: string; steps: string[] } {
  if (browser === "chrome" || browser === "edge") {
    return {
      title: browser === "edge" ? "Microsoft Edge" : "Google Chrome",
      steps: [
        "Click the 🔒 lock icon to the left of the website address at the top of the browser",
        "Find 'Notifications' in the menu that appears",
        "Change it from Block to Allow (or Ask)",
        "Reload this page — the toggle will be enabled again",
      ],
    };
  }
  if (browser === "firefox") {
    return {
      title: "Firefox",
      steps: [
        "Click the 🔒 lock icon to the left of the website address",
        "Click 'Connection secure' → 'More information'",
        "Open the Permissions tab → find 'Receive Notifications'",
        "Uncheck 'Use Default' and select Allow",
        "Reload this page",
      ],
    };
  }
  if (browser === "safari-macos") {
    return {
      title: "Safari (Mac)",
      steps: [
        "Open Safari → Settings (or Preferences) → Websites",
        "Click 'Notifications' in the left sidebar",
        "Find gamearenahq.xyz in the list",
        "Change the dropdown from Deny to Allow",
        "Reload this page",
      ],
    };
  }
  if (browser === "safari-ios") {
    return {
      title: "Safari on iPhone / iPad",
      steps: [
        "Push notifications on iOS only work after adding GameArena to your Home Screen",
        "Tap the Share button (square + arrow) at the bottom of Safari",
        "Scroll down → tap 'Add to Home Screen' → Add",
        "Open GameArena from the Home Screen icon",
        "When you tap a notification toggle, iOS will ask permission — tap Allow",
      ],
    };
  }
  if (browser === "samsung") {
    return {
      title: "Samsung Internet",
      steps: [
        "Tap the menu (three lines) in the bottom right",
        "Settings → Sites and downloads → Site permissions → Notifications",
        "Find gamearenahq.xyz → change to Allow",
        "Reload this page",
      ],
    };
  }
  return {
    title: "Your browser",
    steps: [
      "Open your browser's settings or click the lock/site-info icon next to the URL",
      "Find Site Permissions or Notifications",
      "Change gamearenahq.xyz from Block to Allow",
      "Reload this page",
    ],
  };
}

export function UnblockNotificationsModal({ onClose }: { onClose: () => void }) {
  const [browser, setBrowser] = useState<Browser>("other");
  // Detect on mount so SSR doesn't see a different value than the client.
  useEffect(() => { setBrowser(detectBrowser()); }, []);

  const { title, steps } = stepsFor(browser);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 250,
      background: "rgba(34,16,79,0.45)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: "420px",
        borderRadius: "20px",
        background: "#fbf8ff",
        border: "1px solid rgba(76,29,149,0.16)",
        boxShadow: "0 0 40px rgba(167,139,250,0.4), 0 24px 48px rgba(0,0,0,0.7)",
        padding: "24px 22px",
      }}>
        <div style={{ textAlign: "center", marginBottom: "16px" }}>
          <div style={{ fontSize: "40px" }}>🔕</div>
          <div style={{ color: "#22104f", fontSize: "16px", fontWeight: 900, marginTop: "6px" }}>
            Notifications are blocked
          </div>
          <div style={{ color: "rgba(34,16,79,0.72)", fontSize: "11px", marginTop: "8px", lineHeight: 1.5 }}>
            Your browser blocked notifications for this site. Browsers don&apos;t let us re-ask — you&apos;ll need to unblock from settings.
          </div>
        </div>

        <div style={{
          padding: "14px 16px",
          borderRadius: "14px",
          background: "#fff",
          border: "1px solid rgba(76,29,149,0.14)",
        }}>
          <div style={{
            color: "#6d28d9", fontSize: "10px", fontWeight: 900,
            letterSpacing: "0.14em", marginBottom: "10px",
          }}>{title.toUpperCase()}</div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {steps.map((step, i) => (
              <li key={i} style={{
                display: "flex", gap: "10px", marginBottom: i === steps.length - 1 ? 0 : "8px",
                color: "#22104f", fontSize: "12px", lineHeight: 1.45,
              }}>
                <span style={{
                  flexShrink: 0,
                  width: "20px", height: "20px", borderRadius: "999px",
                  background: "#ede9fe",
                  border: "1px solid rgba(109,40,217,0.4)",
                  color: "#4c1d95",
                  fontSize: "10px", fontWeight: 900,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <button onClick={onClose} style={{
          marginTop: "16px", width: "100%", padding: "11px",
          borderRadius: "999px",
          background: "linear-gradient(180deg, #c084fc 0%, #7c3aed 100%)",
          border: "none", color: "white",
          fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em",
          cursor: "pointer",
          boxShadow: "0 0 16px rgba(124,58,237,0.5)",
        }}>GOT IT</button>
      </div>
    </div>
  );
}
