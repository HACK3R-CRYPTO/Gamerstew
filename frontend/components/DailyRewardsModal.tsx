"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useSelfVerification } from "@/contexts/SelfVerificationContext";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { claimMission, claimMissionMiniPay } from "@/app/actions/missions";
import { playClick } from "@/hooks/useAppAudio";

export type DailyModalTab = "claim" | "missions";

export interface ApiMission {
  id: number;
  missionId: string;
  game?: string | null;
  label: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  rewardXp: number;
}

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const MISSIONS_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

const MISSION_GAME_HREF: Record<string, string> = {
  stack: "/games/stack",
  simon: "/games/simon",
  rhythm: "/games/rhythm",
  ladder: "/games/ladder",
  strike: "/bowling",
  nepa3d: "/world",
};

function fmtMissionCountdown(s: number) {
  if (s <= 0) return "soon";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DailyRewardsModal({
  open,
  onClose,
  initialTab = "claim",
  connected,
  onConnect,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: DailyModalTab;
  connected: boolean;
  onConnect: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<DailyModalTab>(initialTab);
  const { isVerified, isVerificationResolved, hasLapsed, entitlement, claimG$ } = useSelfVerification();
  const [claimingG, setClaimingG] = useState(false);
  const [claimedJustNow, setClaimedJustNow] = useState(false);

  const { address: realAddress } = useAccount();
  const devWallet =
    process.env.NODE_ENV !== "production" && typeof window !== "undefined"
      ? (window as unknown as { __inboxWallet?: string }).__inboxWallet
      : undefined;
  const address = realAddress ?? devWallet;

  const isMiniPay = useIsMiniPay();
  const { getAccessToken } = usePrivy();
  const { signMessageAsync } = useSignMessage();

  const [missions, setMissions] = useState<ApiMission[] | null>(null);
  const [resetSec, setResetSec] = useState(0);
  const [claimingMissionId, setClaimingMissionId] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Fetch missions when opened or address changes
  const fetchMissions = () => {
    if (!address) {
      setMissions(null);
      return;
    }
    fetch(`${MISSIONS_BACKEND_URL}/api/missions/today/${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setMissions([]);
          return;
        }
        setMissions(d.missions || []);
        setResetSec(Number(d.secondsUntilReset ?? 0));
      })
      .catch(() => setMissions([]));
  };

  useEffect(() => {
    if (connected && open) fetchMissions();
  }, [connected, address, open]);

  // Live countdown
  useEffect(() => {
    if (!open || resetSec <= 0) return;
    const t = setInterval(() => setResetSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [open, resetSec]);

  // ESC key and body lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const handleClaimG = async () => {
    if (claimingG) return;
    setClaimingG(true);
    playClick();
    try {
      await claimG$();
      setClaimedJustNow(true);
    } catch (err) {
      console.error("G$ claim error:", err);
    } finally {
      setClaimingG(false);
    }
  };

  const handleClaimMission = async (id: number) => {
    if (!address || claimingMissionId !== null) return;
    setClaimingMissionId(id);
    playClick();
    try {
      if (isMiniPay) {
        const message = `GameArena|mission|${id}|${Date.now()}`;
        const sig = await signMessageAsync({ message });
        await claimMissionMiniPay(sig, message, address, id);
      } else {
        const token = await getAccessToken();
        if (token) await claimMission(token, address, id);
      }
    } catch (err) {
      console.error("Mission claim error:", err);
    }
    setClaimingMissionId(null);
    fetchMissions();
  };

  if (!open) return null;

  const gAmountStr =
    entitlement !== null && entitlement !== undefined && entitlement > 0n
      ? (Number(entitlement) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : "0";

  const gReady = connected && isVerificationResolved && isVerified && entitlement !== null && entitlement > 0n;
  const gDone = isVerificationResolved && isVerified && entitlement === 0n;

  const missionsReadyCount =
    missions?.filter((m) => m.completed && !m.claimed).length ?? 0;
  const missionsCompletedCount = missions?.filter((m) => m.claimed).length ?? 0;
  const totalMissions = missions?.length ?? 3;

  return (
    <div
      className="drm-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playClick();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Daily Rewards and Missions"
    >
      <div className="drm-sheet" ref={modalRef}>
        {/* Drag handle on mobile */}
        <div className="drm-handle" />

        {/* Header */}
        <header className="drm-header">
          <div className="drm-header-info">
            <span className="drm-badge">DAILY REWARDS</span>
            <h2 style={{ fontFamily: DISPLAY }}>Claim & Missions</h2>
          </div>
          <button
            className="drm-close"
            onClick={() => {
              playClick();
              onClose();
            }}
            aria-label="Close modal"
          >
            ✕
          </button>
        </header>

        {/* Tab switch */}
        <div className="drm-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "claim"}
            className={`drm-tab ${tab === "claim" ? "active" : ""}`}
            onClick={() => {
              playClick();
              setTab("claim");
            }}
          >
            <span className="drm-tab-icon">🎁</span>
            <span>Daily G$</span>
            {gReady ? (
              <span className="drm-pill green">READY</span>
            ) : gDone ? (
              <span className="drm-pill muted">CLAIMED</span>
            ) : null}
          </button>

          <button
            role="tab"
            aria-selected={tab === "missions"}
            className={`drm-tab ${tab === "missions" ? "active" : ""}`}
            onClick={() => {
              playClick();
              setTab("missions");
            }}
          >
            <span className="drm-tab-icon">🎯</span>
            <span>Daily Missions</span>
            {missionsReadyCount > 0 ? (
              <span className="drm-pill gold">{missionsReadyCount} READY</span>
            ) : missionsCompletedCount > 0 ? (
              <span className="drm-pill muted">{missionsCompletedCount}/{totalMissions}</span>
            ) : null}
          </button>
        </div>

        {/* Body content */}
        <div className="drm-body">
          {/* TAB 1: DAILY G$ CLAIM */}
          {tab === "claim" && (
            <div className="drm-claim-pane">
              {!connected ? (
                <div className="drm-hero-box guest">
                  <div className="drm-coin-graphic">🎁</div>
                  <h3 style={{ fontFamily: DISPLAY }}>Claim Free G$ Every Day</h3>
                  <p>
                    GoodDollar gives every real human free daily digital income. Connect
                    your wallet to unlock your daily claim.
                  </p>
                  <button className="drm-action-btn primary" onClick={onConnect}>
                    Connect Wallet to Claim
                  </button>
                </div>
              ) : !isVerificationResolved ? (
                <div className="drm-hero-box neutral">
                  <div className="drm-spinner" />
                  <p>Checking your daily GoodDollar entitlement…</p>
                </div>
              ) : !isVerified ? (
                <div className="drm-hero-box verify">
                  <div className="drm-coin-graphic">🛡️</div>
                  <h3 style={{ fontFamily: DISPLAY }}>
                    {hasLapsed ? "Verification Expired" : "Unlock Free Daily G$"}
                  </h3>
                  <p>
                    {hasLapsed
                      ? "Your Face Verification check has lapsed. Re-verify your human identity to keep claiming daily income."
                      : "GoodDollar requires a quick 1-minute face check to prove you are a real human and prevent bots."}
                  </p>
                  <button
                    className="drm-action-btn green"
                    onClick={() => {
                      onClose();
                      router.push(`/verify?next=${encodeURIComponent("/dashboard")}`);
                    }}
                  >
                    {hasLapsed ? "Re-verify Now" : "Verify Face to Unlock"}
                  </button>
                </div>
              ) : gReady || claimedJustNow ? (
                <div className="drm-hero-box ready">
                  <div className="drm-coin-sparkle">
                    <span className="drm-big-coin">💰</span>
                  </div>
                  <span className="drm-claim-tag">AVAILABLE RIGHT NOW</span>
                  <div className="drm-g-amount" style={{ fontFamily: DISPLAY }}>
                    {gAmountStr} <span>G$</span>
                  </div>
                  <p>Your daily income is ready for today! Tap below to add it directly to your wallet.</p>
                  <button
                    className="drm-action-btn claim"
                    onClick={handleClaimG}
                    disabled={claimingG || claimedJustNow}
                  >
                    {claimingG ? "Claiming G$…" : claimedJustNow ? "✓ Claimed Successfully!" : `Claim ${gAmountStr} G$ Now`}
                  </button>
                </div>
              ) : (
                <div className="drm-hero-box done">
                  <div className="drm-check-circle">✓</div>
                  <h3 style={{ fontFamily: DISPLAY }}>Claimed Today</h3>
                  <p>
                    You have claimed your daily GoodDollar allocation for today. The next
                    claim distribution will be available in 24 hours.
                  </p>
                  <div className="drm-ways-to-use">
                    <div className="drm-ways-title">WAYS TO USE YOUR G$:</div>
                    <ul>
                      <li>⚡ <b>Enter matches & tournaments</b> to win the community pot</li>
                      <li>💎 <b>Buy in-game perks</b> in the Perk Shop</li>
                      <li>🏦 <b>Cash out to Naira bank accounts</b> with GoodCash</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MISSIONS */}
          {tab === "missions" && (
            <div className="drm-missions-pane">
              <div className="drm-missions-head">
                <div className="drm-missions-meta">
                  <span className="drm-count">
                    {missionsCompletedCount} of {totalMissions} completed
                  </span>
                  {resetSec > 0 && (
                    <span className="drm-timer">
                      ⏱️ Resets in {fmtMissionCountdown(resetSec)}
                    </span>
                  )}
                </div>
              </div>

              {!connected ? (
                <div className="drm-hero-box guest">
                  <div className="drm-coin-graphic">🎯</div>
                  <h3 style={{ fontFamily: DISPLAY }}>Daily Game Missions</h3>
                  <p>Play games, complete daily objectives, and earn XP to level up your pet avatar.</p>
                  <button className="drm-action-btn primary" onClick={onConnect}>
                    Connect to Track Missions
                  </button>
                </div>
              ) : missions === null ? (
                <div className="drm-hero-box neutral">
                  <div className="drm-spinner" />
                  <p>Loading your missions…</p>
                </div>
              ) : missions.length === 0 ? (
                <div className="drm-hero-box neutral">
                  <p>No active missions for today. Check back tomorrow!</p>
                </div>
              ) : (
                <div className="drm-mission-list">
                  {missions.map((m) => {
                    const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
                    const ready = m.completed && !m.claimed;
                    const done = m.claimed;
                    const href = m.game ? MISSION_GAME_HREF[m.game] : "/dashboard";

                    return (
                      <div key={m.id} className={`drm-mission-item ${done ? "done" : ready ? "ready" : ""}`}>
                        <div className="drm-mi-top">
                          <div className="drm-mi-info">
                            <span className="drm-mi-label">{m.label}</span>
                            <span className="drm-mi-sub">
                              {done
                                ? `Completed · +${m.rewardXp} XP claimed`
                                : ready
                                ? `Objective reached! Claim +${m.rewardXp} XP`
                                : `${m.progress} / ${m.target} · Reward: +${m.rewardXp} XP`}
                            </span>
                          </div>

                          <div className="drm-mi-action">
                            {done ? (
                              <span className="drm-done-badge">✓ Done</span>
                            ) : ready ? (
                              <button
                                className="drm-claim-xp-btn"
                                onClick={() => handleClaimMission(m.id)}
                                disabled={claimingMissionId === m.id}
                              >
                                {claimingMissionId === m.id ? "Claiming…" : `Claim +${m.rewardXp} XP`}
                              </button>
                            ) : (
                              <Link
                                href={href}
                                onClick={onClose}
                                className="drm-play-btn"
                              >
                                Play ›
                              </Link>
                            )}
                          </div>
                        </div>

                        {!done && (
                          <div className="drm-progress-bg">
                            <div className="drm-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .drm-backdrop {
          position: fixed; inset: 0; z-index: 9998;
          display: flex; align-items: flex-end; justify-content: center;
          background: rgba(14, 5, 33, 0.76);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          animation: drmFadeIn 0.22s ease-out;
        }
        @keyframes drmFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .drm-sheet {
          width: 100%; max-width: 500px;
          background: #ffffff;
          border-top-left-radius: 28px; border-top-right-radius: 28px;
          border: 1px solid rgba(109, 40, 217, 0.15);
          box-shadow: 0 -12px 40px rgba(10, 2, 28, 0.45);
          display: flex; flex-direction: column;
          max-height: 88vh;
          overflow: hidden;
          animation: drmSlideUp 0.26s cubic-bezier(0.18, 0.9, 0.2, 1);
        }
        @keyframes drmSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        @media (min-width: 640px) {
          .drm-backdrop { align-items: center; padding: 20px; }
          .drm-sheet {
            border-radius: 28px;
            max-height: 85vh;
            animation: drmPopIn 0.25s cubic-bezier(0.18, 1.2, 0.2, 1);
          }
          @keyframes drmPopIn {
            from { transform: scale(0.92); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
        }

        .drm-handle {
          width: 44px; height: 5px; border-radius: 99px;
          background: rgba(76, 29, 149, 0.2);
          margin: 10px auto 4px;
        }
        @media (min-width: 640px) {
          .drm-handle { display: none; }
        }

        .drm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 20px 8px;
        }
        .drm-badge {
          font-size: 10px; font-weight: 800; letter-spacing: 0.16em;
          color: #7c3aed; text-transform: uppercase;
        }
        .drm-header h2 {
          margin: 2px 0 0; font-size: 24px; color: #1e103f;
        }
        .drm-close {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1px solid rgba(76, 29, 149, 0.12);
          background: #f5f3ff; color: #4c1d95;
          font-size: 14px; font-weight: 800;
          cursor: pointer; display: grid; place-items: center;
          transition: transform 0.15s ease, background 0.15s ease;
        }
        .drm-close:hover { background: #ede9fe; transform: scale(1.05); }

        .drm-tabs {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 8px; padding: 6px 18px 12px;
          border-bottom: 1px solid rgba(76, 29, 149, 0.08);
        }
        .drm-tab {
          display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 10px 12px; border-radius: 14px;
          border: 1px solid rgba(76, 29, 149, 0.12);
          background: #f8f7ff; color: #4c1d95;
          font-size: 13px; font-weight: 800;
          cursor: pointer; transition: all 0.18s ease;
        }
        .drm-tab.active {
          background: #6d28d9; color: #ffffff;
          border-color: #6d28d9;
          box-shadow: 0 4px 14px -4px rgba(109, 40, 217, 0.5);
        }
        .drm-tab-icon { font-size: 15px; }
        .drm-pill {
          font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
          padding: 2px 7px; border-radius: 99px;
        }
        .drm-pill.green { background: #dcfce7; color: #15803d; }
        .drm-pill.gold { background: #fef3c7; color: #b45309; }
        .drm-pill.muted { background: rgba(0,0,0,0.06); color: currentColor; opacity: 0.8; }
        .drm-tab.active .drm-pill.muted { background: rgba(255,255,255,0.22); color: #fff; }

        .drm-body {
          padding: 18px;
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        .drm-hero-box {
          border-radius: 20px; padding: 22px 18px;
          text-align: center; display: flex; flex-direction: column;
          align-items: center; gap: 10px;
        }
        .drm-hero-box.guest {
          background: linear-gradient(145deg, #faf5ff 0%, #f3e8ff 100%);
          border: 1px solid rgba(147, 51, 234, 0.2);
        }
        .drm-hero-box.neutral {
          background: #f8f7ff; border: 1px solid rgba(76, 29, 149, 0.1);
        }
        .drm-hero-box.verify {
          background: linear-gradient(145deg, #f0fdf4 0%, #dcfce7 100%);
          border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .drm-hero-box.ready {
          background: linear-gradient(145deg, #f0fdf4 0%, #ecfdf5 60%, #fef3c7 100%);
          border: 2px solid #22c55e;
          box-shadow: 0 8px 24px -8px rgba(34, 197, 94, 0.35);
        }
        .drm-hero-box.done {
          background: #f0fdf4; border: 1px solid rgba(34, 197, 94, 0.25);
        }

        .drm-coin-graphic { font-size: 42px; margin-bottom: 2px; }
        .drm-hero-box h3 {
          margin: 0; font-size: 21px; color: #1e103f;
        }
        .drm-hero-box p {
          margin: 0; font-size: 13.5px; line-height: 1.45;
          color: rgba(30, 16, 63, 0.72); font-weight: 500;
          max-width: 380px;
        }

        .drm-spinner {
          width: 32px; height: 32px; border-radius: 50%;
          border: 3px solid rgba(109, 40, 217, 0.15);
          border-top-color: #6d28d9;
          animation: drmSpin 0.7s linear infinite;
        }
        @keyframes drmSpin { to { transform: rotate(360deg); } }

        .drm-claim-tag {
          font-size: 10px; font-weight: 800; letter-spacing: 0.14em;
          color: #15803d; background: #dcfce7;
          padding: 3px 10px; border-radius: 999px;
        }
        .drm-g-amount {
          font-size: 42px; font-weight: 900; color: #15803d;
          line-height: 1; margin: 4px 0;
        }
        .drm-g-amount span { font-size: 24px; color: #166534; }

        .drm-action-btn {
          width: 100%; max-width: 360px;
          padding: 13px 20px; border-radius: 15px; border: none;
          font-family: inherit; font-size: 15px; font-weight: 800;
          cursor: pointer; transition: transform 0.14s ease, filter 0.14s ease;
          margin-top: 6px;
        }
        .drm-action-btn:active { transform: scale(0.98); }
        .drm-action-btn.primary {
          background: #6d28d9; color: #fff;
          box-shadow: 0 4px 0 #4c1d95;
        }
        .drm-action-btn.green {
          background: #16a34a; color: #fff;
          box-shadow: 0 4px 0 #15803d;
        }
        .drm-action-btn.claim {
          background: linear-gradient(180deg, #22c55e 0%, #16a34a 100%);
          color: #fff; font-size: 16px;
          box-shadow: 0 4px 0 #15803d;
        }
        .drm-action-btn:disabled {
          opacity: 0.65; cursor: not-allowed; transform: none;
        }

        .drm-check-circle {
          width: 48px; height: 48px; border-radius: 50%;
          background: #dcfce7; color: #15803d;
          font-size: 24px; font-weight: 900;
          display: grid; place-items: center;
        }

        .drm-ways-to-use {
          width: 100%; margin-top: 10px; padding-top: 12px;
          border-top: 1px solid rgba(22, 163, 74, 0.2);
          text-align: left;
        }
        .drm-ways-title {
          font-size: 10px; font-weight: 800; letter-spacing: 0.14em;
          color: #15803d; margin-bottom: 6px;
        }
        .drm-ways-to-use ul {
          margin: 0; padding-left: 18px;
          display: flex; flex-direction: column; gap: 5px;
          font-size: 12.5px; color: rgba(30, 16, 63, 0.78);
        }

        /* Missions list */
        .drm-missions-pane { display: flex; flex-direction: column; gap: 12px; }
        .drm-missions-head {
          display: flex; justify-content: space-between; align-items: center;
          padding: 0 4px;
        }
        .drm-missions-meta {
          width: 100%; display: flex; justify-content: space-between;
          font-size: 12px; font-weight: 800; color: #6d28d9;
        }
        .drm-count { background: #f3e8ff; padding: 3px 9px; border-radius: 8px; }
        .drm-timer { color: #64748b; }

        .drm-mission-list {
          display: flex; flex-direction: column; gap: 10px;
        }
        .drm-mission-item {
          padding: 14px; border-radius: 18px;
          background: #ffffff;
          border: 1px solid rgba(76, 29, 149, 0.12);
          display: flex; flex-direction: column; gap: 10px;
          transition: border-color 0.18s ease;
        }
        .drm-mission-item.ready {
          border-color: #7c3aed;
          box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.18);
          background: #faf5ff;
        }
        .drm-mission-item.done {
          border-color: rgba(34, 197, 94, 0.3);
          background: #f0fdf4;
        }

        .drm-mi-top {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .drm-mi-info { display: flex; flex-direction: column; gap: 3px; }
        .drm-mi-label {
          font-size: 14px; font-weight: 800; color: #1e103f;
        }
        .drm-mi-sub {
          font-size: 12px; font-weight: 600; color: rgba(30, 16, 63, 0.64);
        }
        .drm-mission-item.done .drm-mi-sub { color: #166534; }

        .drm-done-badge {
          font-size: 11px; font-weight: 800; color: #15803d;
          background: #dcfce7; padding: 6px 12px; border-radius: 99px;
          white-space: nowrap;
        }
        .drm-claim-xp-btn {
          border: none; border-radius: 12px; padding: 8px 14px;
          background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%);
          box-shadow: 0 3px 0 #4c1d95; color: #fff;
          font-family: inherit; font-size: 12px; font-weight: 800;
          cursor: pointer; white-space: nowrap;
        }
        .drm-claim-xp-btn:disabled { opacity: 0.6; cursor: wait; }
        .drm-play-btn {
          border-radius: 12px; padding: 7px 14px;
          background: #ede9fe; color: #5b21b6;
          font-size: 12px; font-weight: 800;
          text-decoration: none; white-space: nowrap;
        }
        .drm-play-btn:hover { background: #ddd6fe; }

        .drm-progress-bg {
          height: 6px; border-radius: 99px;
          background: rgba(76, 29, 149, 0.1);
          overflow: hidden;
        }
        .drm-progress-fill {
          height: 100%; border-radius: 99px;
          background: linear-gradient(90deg, #a78bfa, #6d28d9);
          transition: width 0.35s ease;
        }
      `}</style>
    </div>
  );
}
