"use client";

// ─── ChallengeBanner ──────────────────────────────────────────────────────────
// Hero card for the hosted 72-hour Arena Challenge. Shows the live countdown,
// prize pool, qualification floor, the player's own progress toward
// qualifying, and the current top 3 so the leaderboard feels live. Styled
// bolder than the generic event rows around it because this is the single
// most urgent CTA on the page while the event runs.
//
// Shared between /games (right sidebar + mobile below cards) and /leaderboard
// (top of the page) so every route that players land on advertises the
// challenge consistently.

import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

export type ChallengeInfo = {
  active: boolean;
  startsAt: number;
  endsAt: number;
  secondsLeft: number;
  minPlays: number;
  topN: number;
  prizeUsdc: number;
  totalPrizePool: number;
  myPlays: number;
  myQualified: boolean;
  rankings: { wallet: string; username: string | null; plays: number; qualified: boolean }[];
};

// Poll intervals (ms). Starts at ACTIVE, slows toward IDLE when the response
// hasn't changed for several ticks in a row, springs back to ACTIVE when any
// change is detected. Keeps the banner feeling live during action and quiet
// during the middle of the night when nobody is playing.
const POLL_ACTIVE_MS = 30_000;
const POLL_IDLE_MS   = 120_000;
const IDLE_AFTER_STABLE_TICKS = 3;

// One-line signature used to detect "did anything change since last poll?"
// Captures what matters for the UI: my progress, who is leading, how many
// qualified players there are. We deliberately DO NOT include the countdown
// (which changes every second) or the top rankers' raw plays beyond a
// rounded bucket, since tiny mid-tick movements shouldn't keep the timer hot.
function signatureFor(c: ChallengeInfo): string {
  const topSummary = c.rankings.slice(0, 5).map(r => `${r.wallet}:${r.plays}`).join(',');
  return `${c.myPlays}|${c.myQualified ? 1 : 0}|${topSummary}`;
}

// Minimal runtime guard — if the backend returns a malformed payload the
// UI should render nothing, not crash React. We only check the shape we
// actually rely on; a looser unknown field is fine.
function isChallengePayload(d: unknown): d is ChallengeInfo & { active: boolean } {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.active === 'boolean' &&
    typeof o.endsAt === 'number' &&
    typeof o.minPlays === 'number' &&
    typeof o.topN === 'number' &&
    typeof o.prizeUsdc === 'number' &&
    typeof o.totalPrizePool === 'number' &&
    Array.isArray(o.rankings)
  );
}

// Poll hook with smart backoff. Fetches /api/challenge at 30s intervals
// while things are moving and 120s once the response has been identical for
// 3 polls in a row. Pauses on tab hide, resumes on tab show (no wasted
// requests while the user is away). Returns null when the event is not
// active so callers render nothing cleanly.
export function useChallenge(address?: string | null): ChallengeInfo | null {
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null);
  const lastSigRef = useRef<string>('');
  const stableTicksRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = address
      ? `${BACKEND_URL}/api/challenge?player=${address}`
      : `${BACKEND_URL}/api/challenge`;

    let cancelled = false;
    const clearScheduled = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };

    const tick = async () => {
      if (cancelled) return;
      // Skip polling while the tab is hidden. We'll resume on visibilitychange.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleNext(POLL_ACTIVE_MS);
        return;
      }
      try {
        const r = await fetch(url);
        const d: unknown = await r.json();
        if (cancelled) return;
        // Validate the shape before trusting it — a malformed backend
        // response should render nothing, not crash the banner.
        if (!isChallengePayload(d)) {
          setChallenge(null);
          stableTicksRef.current += 1;
        } else {
          const next = d.active ? d : null;
          setChallenge(next);
          // Change detection — signature collapses everything we care about
          // into a string. Equal strings for N polls = nothing is happening.
          const sig = next ? signatureFor(next) : 'inactive';
          if (sig === lastSigRef.current) stableTicksRef.current += 1;
          else { stableTicksRef.current = 0; lastSigRef.current = sig; }
        }
      } catch {
        // Network error — count as "stable" so we back off gracefully.
        stableTicksRef.current += 1;
      }
      const interval = stableTicksRef.current >= IDLE_AFTER_STABLE_TICKS
        ? POLL_IDLE_MS : POLL_ACTIVE_MS;
      scheduleNext(interval);
    };

    const scheduleNext = (ms: number) => {
      clearScheduled();
      timeoutRef.current = setTimeout(tick, ms);
    };

    // Visibility handler — reset the backoff and fire an immediate poll when
    // the player returns. Feels fresh without waiting out a 2-minute idle.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        stableTicksRef.current = 0;
        clearScheduled();
        tick();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    // Kick off immediately.
    tick();

    return () => {
      cancelled = true;
      clearScheduled();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [address]);

  return challenge;
}

function fmtShortCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "ended";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((secondsLeft % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function ChallengeBanner({
  challenge,
  compact = false,
}: {
  challenge: ChallengeInfo;
  // `compact` renders the card smaller and drops the top-3 list. Used when
  // the card slots into a tight sidebar column. Default is the full layout.
  compact?: boolean;
}) {
  // Tick every second so the countdown actually moves. Cheap: the banner
  // only mounts while the challenge is active.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = Math.max(0, challenge.endsAt - nowSec);
  const pct = Math.min(100, Math.round((challenge.myPlays / challenge.minPlays) * 100));
  const top3 = challenge.rankings.slice(0, 3);
  const shortName = (wallet: string, name: string | null) =>
    name || `${wallet.slice(0, 4)}…${wallet.slice(-3)}`;

  return (
    <div
      // Semantic role so screen readers announce the live updates without
      // interrupting whatever the user is reading. `polite` is correct for
      // passive info (progress, countdown). We keep the label short because
      // assistive tech reads the card top-to-bottom anyway.
      role="status"
      aria-live="polite"
      aria-label={`72-hour Arena Cup. ${challenge.myPlays} of ${challenge.minPlays} plays. ${challenge.myQualified ? "Qualified" : "Not yet qualified"}.`}
      style={{
        borderRadius: "clamp(10px, 2.4vw, 14px)",
        padding: "2px",
        background: "linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #c026d3 100%)",
        boxShadow: "0 0 24px rgba(251,191,36,0.4), 0 12px 30px rgba(0,0,0,0.5)",
      }}>
      <div style={{
        borderRadius: "clamp(8px, 2.2vw, 12px)",
        background: "linear-gradient(180deg, rgba(40,10,80,0.95) 0%, rgba(10,2,40,0.98) 100%)",
        // Padding and gap scale with viewport so the banner reads at the same
        // visual weight as the mission / event rows next to it on mobile,
        // and expands for desktop where it has more room.
        padding: compact
          ? "clamp(8px, 2.2vw, 11px) clamp(10px, 2.6vw, 13px)"
          : "clamp(10px, 2.6vw, 14px) clamp(12px, 3vw, 16px)",
        display: "flex", flexDirection: "column",
        gap: compact ? "clamp(6px, 1.5vw, 8px)" : "clamp(7px, 1.8vw, 10px)",
      }}>
        {/* Header row — title + countdown */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            <span style={{ fontSize: compact ? "clamp(12px, 3vw, 14px)" : "clamp(13px, 3.2vw, 16px)" }}>🏆</span>
            <span style={{
              color: "#fbbf24",
              fontSize: compact
                ? "clamp(10px, 2.6vw, 11px)"
                : "clamp(10.5px, 2.8vw, 12px)",
              fontWeight: 900, letterSpacing: "0.14em",
              textShadow: "0 0 10px rgba(251,191,36,0.7)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>72-HR ARENA CUP</span>
          </div>
          <div style={{
            padding: "3px clamp(8px, 2.2vw, 10px)",
            borderRadius: "999px",
            background: "rgba(251,191,36,0.18)",
            border: "1px solid rgba(251,191,36,0.55)",
            color: "#fde68a",
            fontSize: compact ? "clamp(9px, 2.4vw, 10.5px)" : "clamp(10px, 2.6vw, 11.5px)",
            fontWeight: 900,
            fontFamily: "monospace", whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            ⏳ {fmtShortCountdown(secondsLeft)}
          </div>
        </div>

        {/* Prize line */}
        <div style={{
          color: "rgba(230,220,255,0.9)",
          fontSize: compact
            ? "clamp(10.5px, 2.8vw, 11.5px)"
            : "clamp(11px, 3vw, 12.5px)",
          lineHeight: 1.4,
        }}>
          Top <strong style={{ color: "#fde68a" }}>{challenge.topN}</strong> by total plays win{" "}
          <strong style={{ color: "#fde68a" }}>${challenge.prizeUsdc} USDC</strong> each. Pool:{" "}
          <strong style={{ color: "#fde68a" }}>${challenge.totalPrizePool}</strong>.
        </div>

        {/* Your progress */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{
              color: "rgba(200,180,255,0.8)",
              fontSize: compact
                ? "clamp(9px, 2.4vw, 10px)"
                : "clamp(9.5px, 2.6vw, 11px)",
              fontWeight: 800, letterSpacing: "0.08em",
            }}>
              YOUR PROGRESS
            </span>
            <span style={{
              color: challenge.myQualified ? "#86efac" : "#fde68a",
              fontSize: compact
                ? "clamp(9px, 2.4vw, 10.5px)"
                : "clamp(10px, 2.6vw, 11.5px)",
              fontWeight: 900,
            }}>
              {challenge.myPlays} / {challenge.minPlays} {challenge.myQualified ? "✓" : ""}
            </span>
          </div>
          <div style={{
            height: compact ? "clamp(5px, 1.3vw, 6px)" : "clamp(6px, 1.5vw, 8px)",
            borderRadius: "999px",
            background: "rgba(0,0,0,0.5)",
            overflow: "hidden", border: "1px solid rgba(251,191,36,0.18)",
          }}>
            <div style={{
              width: `${pct}%`, height: "100%", borderRadius: "999px",
              background: challenge.myQualified
                ? "linear-gradient(90deg, #22c55e, #86efac)"
                : "linear-gradient(90deg, #fbbf24, #f97316)",
              boxShadow: challenge.myQualified
                ? "0 0 8px rgba(34,197,94,0.6)"
                : "0 0 8px rgba(251,191,36,0.6)",
              transition: "width 0.3s",
            }} />
          </div>
        </div>

        {/* Live top 3 — hidden in compact mode to save vertical space */}
        {!compact && top3.length > 0 && (
          <div style={{
            display: "flex", flexDirection: "column",
            gap: "clamp(4px, 1.2vw, 6px)",
            borderTop: "1px solid rgba(251,191,36,0.2)",
            paddingTop: "clamp(7px, 1.8vw, 10px)",
          }}>
            {top3.map((p, i) => {
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
              return (
                <div key={p.wallet} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: "8px",
                  fontSize: "clamp(10.5px, 2.8vw, 12px)",
                  fontWeight: 700,
                  color: p.qualified ? "rgba(230,220,255,0.95)" : "rgba(200,180,255,0.65)",
                }}>
                  <span style={{
                    display: "flex", alignItems: "center",
                    gap: "clamp(5px, 1.4vw, 8px)", minWidth: 0, flex: 1,
                  }}>
                    <span style={{ flexShrink: 0 }}>{medal}</span>
                    <span style={{
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{shortName(p.wallet, p.username)}</span>
                  </span>
                  <span style={{
                    color: p.qualified ? "#86efac" : "#fde68a",
                    fontWeight: 900, flexShrink: 0,
                  }}>{p.plays}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
