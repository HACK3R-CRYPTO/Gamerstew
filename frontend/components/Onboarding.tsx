"use client";

import { useEffect, useRef, useState } from "react";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { celo } from "viem/chains";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, detectFeeSpread } from "@/lib/contracts";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { claimGas } from "@/app/actions/gas";

// ─── design tokens ──────────────────────────────────────────────────────
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.55)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

const TELEGRAM_URL = "https://t.me/+oY4inbBoglViNmE0";
// Matches /mint page — comfortable margin over the ~0.0005 CELO mint cost, leaves room for one retry.
const GAS_MIN_CELO_WEI = 2_000_000_000_000_000n; // 0.002 CELO
const SETUP_LINES = ["Hatching your slime…", "Saving your name…", "Setting up your arena…", "Almost there…"];

const KEYFRAMES = `
  @keyframes ob-fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes ob-float-gentle { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
  @keyframes ob-popIn { 0% { transform: scale(0.3); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
  @keyframes ob-sheetUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  @keyframes ob-bubble-pop {
    0% { transform: translateY(6px) scale(0.85); opacity: 0 }
    60% { transform: translateY(-2px) scale(1.04); opacity: 1 }
    100% { transform: translateY(0) scale(1); opacity: 1 }
  }
`;

// ─── primitives ─────────────────────────────────────────────────────────
function PetHero({ size = 150, celebrate = false }: { size?: number; celebrate?: boolean }) {
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <div style={{ position: "absolute", width: size * 0.95, height: size * 0.95, borderRadius: "50%", background: `radial-gradient(circle, ${T.accent}44, transparent 70%)`, filter: "blur(10px)" }} />
      <span style={{ position: "absolute", top: "8%", right: "14%", fontSize: size * 0.13, animation: "ob-float-gentle 2.6s ease-in-out infinite" }}>✨</span>
      <span style={{ position: "absolute", bottom: "14%", left: "10%", fontSize: size * 0.1, animation: "ob-float-gentle 3.1s ease-in-out infinite 0.4s" }}>⭐</span>
      <img src="/pets/stage-2-baby.png" alt="" style={{ width: size * 0.82, height: size * 0.82, objectFit: "contain", position: "relative", zIndex: 1, filter: "drop-shadow(0 12px 22px rgba(0,0,0,0.5))", animation: celebrate ? "ob-popIn 0.6s cubic-bezier(0.34,1.56,0.64,1)" : "ob-float-gentle 3.2s ease-in-out infinite" }} />
    </div>
  );
}

const CheckIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M9 17 4 12l1.4-1.4L9 14.2l9.6-9.6L20 6z" /></svg>;
const PlayIcon = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={T.inkDim}><path d="M8 5v14l11-7z" /></svg>;
const ChevIcon = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={T.inkDim}><path d="M9 6l6 6-6 6" /></svg>;
const CloseIcon = ({ size = 15 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={T.inkDim}><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></svg>;
const TelegramIcon = ({ size = 15 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff"><path d="M21.94 4.36 18.9 19.2c-.23 1.01-.83 1.26-1.68.78l-4.64-3.42-2.24 2.16c-.25.25-.46.46-.93.46l.33-4.73L18.7 6.1c.37-.33-.08-.51-.58-.18L6.85 13.07l-4.66-1.46c-1.01-.32-1.03-1.01.21-1.5L20.6 2.86c.84-.31 1.58.2 1.34 1.5z" /></svg>;

// ─── main component ─────────────────────────────────────────────────────
export type OnboardingResult = { username: string; verified: boolean; alreadyMinted?: boolean };

type Phase = "create" | "setup" | "verify";
type MintError =
  | { kind: "gas"; message: string }
  | { kind: "taken"; message: string }
  | { kind: "other"; message: string };

export default function Onboarding({
  onComplete,
  onClose,
  onPlayFree,
}: {
  onComplete: (r: OnboardingResult) => void;
  onClose: () => void;
  onPlayFree: () => void;
}) {
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();
  const { getAccessToken, logout } = usePrivy();

  // Balance · refetches every 6s while the user is on the switch-on panel, every 15s otherwise.
  const { data: balance, refetch: refetchBalance } = useBalance({
    address,
    chainId: celo.id,
    query: { enabled: !!address && !isMiniPay, refetchInterval: 6000 },
  });
  // MiniPay pays fees in USDC via the fee-currency adapter · no native gas needed.
  const hasGas = isMiniPay || (balance ? balance.value >= GAS_MIN_CELO_WEI : false);

  // Already has a GamePass? Short-circuit straight to verify.
  const { data: hasMinted, refetch: refetchPass } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Already GoodDollar-verified? Then the verify pitch is an insult —
  // it reads as "we forgot you're verified". Direct on-chain whitelist
  // read (same Identity contract the verification context uses).
  const { data: whitelistRoot } = useReadContract({
    address: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    abi: [{
      inputs: [{ name: "account", type: "address" }],
      name: "getWhitelistedRoot",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    }] as const,
    functionName: "getWhitelistedRoot",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const alreadyVerified = !!whitelistRoot && whitelistRoot !== "0x0000000000000000000000000000000000000000";

  const [phase, setPhase] = useState<Phase>("create");
  const [username, setUsername] = useState("");
  const [showSwitch, setShowSwitch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setupLine, setSetupLine] = useState(0);
  const [mintError, setMintError] = useState<MintError | null>(null);
  const [slowMint, setSlowMint] = useState(false);
  const triedOnceRef = useRef(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const valid = username.length >= 3 && username.length <= 16;
  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  // Returning user with a pass · skip the whole flow.
  useEffect(() => {
    if (hasMinted === true) onComplete({ username: "", verified: false, alreadyMinted: true });
  }, [hasMinted, onComplete]);

  // Already-verified wallets skip the verify pitch entirely — showing
  // "Verify & claim G$" to a verified human reads as "we don't know
  // you're verified" and erodes trust. They complete straight through.
  useEffect(() => {
    if (phase === "verify" && alreadyVerified) {
      onComplete({ username, verified: false });
    }
  }, [phase, alreadyVerified, username, onComplete]);

  // What gets copied to the clipboard isn't the bare wallet address —
  // it's a short friendly request the player can paste straight into
  // our chat. Reads like a normal player asking for help instead of a
  // crypto string dump. The address is still in there (we need it to
  // process the switch-on), just framed as a code so the player never
  // has to think about wallets.
  const copyCode = async () => {
    if (!address) return;
    const message = `Hi! Please mint my pass and switch me on so I can start playing 🎮\n\nMy code: ${address}`;
    try { await navigator.clipboard?.writeText(message); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Rotate the playful setup lines while the mint tx is in flight.
  useEffect(() => {
    if (phase !== "setup") return;
    setSetupLine(0);
    const rot = window.setInterval(() => setSetupLine(l => Math.min(l + 1, SETUP_LINES.length - 1)), 900);
    return () => window.clearInterval(rot);
  }, [phase]);

  // Actually call mint. Replaces the old fake timer.
  // Slow-tx hint after 20s · most Celo mints land in 5–10s, beyond that
  // it's almost always gas, RPC lag, or a wallet prompt the user missed.
  async function runMint() {
    setMintError(null);
    setSlowMint(false);
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = setTimeout(() => setSlowMint(true), 20_000);
    try {
      // Top up fresh Privy-embedded wallets BEFORE the mint tx fires.
      // Server-side gating: only sends if wallet has < 0.001 CELO AND
      // hasn't been topped up before. MiniPay path skips this (pays gas
      // in USDC via the fee-currency adapter, no native CELO needed).
      // Await is intentional · the mint depends on the drip landing first.
      if (!isMiniPay && address) {
        try {
          const token = await getAccessToken();
          if (token) await claimGas(token, address);
        } catch { /* drip failed · let mint proceed and surface the error */ }
      }

      await writeContractAsync({
        dataSuffix: ATTRIBUTION_SUFFIX,
        address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
        abi: GAME_PASS_ABI,
        functionName: "mint",
        args: [username],
        ...(await detectFeeSpread(isMiniPay, address as `0x${string}` | undefined)),
      });
      await refetchPass();
      setPhase("verify");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      // Race: same wallet minted in another tab · silent success.
      if (lower.includes("already minted")) {
        await refetchPass();
        setPhase("verify");
        return;
      }
      if (lower.includes("username taken")) {
        setMintError({ kind: "taken", message: "That name's taken — pick another." });
        setPhase("create");
        return;
      }
      const isGas =
        lower.includes("insufficient funds") ||
        lower.includes("insufficient balance") ||
        lower.includes("out of gas") ||
        lower.includes("gas required exceeds") ||
        lower.includes("cannot estimate gas") ||
        lower.includes("exceeds allowance");
      if (isGas) {
        // Punt back to the switch-on panel — the user needs a top-up before we retry.
        setMintError({ kind: "gas", message: "Your account needs a quick top-up — let's get you switched on." });
        setShowSwitch(true);
        setPhase("create");
        await refetchBalance();
        return;
      }
      setMintError({ kind: "other", message: raw.slice(0, 140) });
      setPhase("create");
    } finally {
      if (slowTimerRef.current) { clearTimeout(slowTimerRef.current); slowTimerRef.current = null; }
    }
  }

  // "Let's play" → straight into setup. runMint handles its own faucet+
  // mint flow; the old behavior gated entry on hasGas which blocked
  // fresh wallets from ever reaching the faucet call inside runMint
  // (they got the "needs top-up" panel before mint had a chance to run).
  //
  // Now: setup phase fires runMint → claimGas drips 0.7 CELO if eligible
  // → mint tx fires. The "needs top-up" panel (showSwitch) becomes a
  // FALLBACK · only shown if runMint actually fails with a gas error
  // (validator empty, daily cap hit, wallet not eligible, etc.).
  const start = async () => {
    if (!valid) return;
    setMintError(null);
    if (showSwitch) {
      // Returning from the manual top-up panel · player may have
      // funded the wallet themselves while it was visible. Refetch
      // before letting runMint try again so a real balance is seen.
      triedOnceRef.current = true;
      await refetchBalance();
    }
    setPhase("setup");
  };

  // Fire the actual mint when we enter setup.
  useEffect(() => {
    if (phase !== "setup") return;
    runMint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── SETUP (real mint in flight) ─────────────────────────────────────────
  // The mint read hasn't answered yet — returning players were seeing
  // "Name your slime" flash (or sit, on slow RPC) before the short-circuit
  // kicked in, and thought the app forgot their pet. Unknown = loading.
  if (address && hasMinted === undefined && phase === "create") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, animation: "ob-fadeIn 0.25s ease both" }}>
        <style>{KEYFRAMES}</style>
        <PetHero size={110} />
        <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 800, letterSpacing: "0.14em", color: T.inkSoft }}>
          LOADING YOUR ARENA…
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: `radial-gradient(ellipse 90% 50% at 50% 30%, ${T.accent}22 0%, transparent 60%), ${T.bg}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, animation: "ob-fadeIn 0.2s ease both", padding: 24 }}>
        <style>{KEYFRAMES}</style>
        <PetHero size={150} />
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div key={setupLine} style={{ fontFamily: T.display, fontSize: 20, color: T.ink, animation: "ob-bubble-pop 0.4s ease both" }}>{SETUP_LINES[setupLine]}</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 14 }}>
            {SETUP_LINES.map((_, i) => (
              <span key={i} style={{ width: 7, height: 7, borderRadius: 999, background: i <= setupLine ? T.accent : "rgba(255,255,255,0.14)", boxShadow: i === setupLine ? `0 0 8px ${T.accent}` : "none", transition: "all 0.3s" }} />
            ))}
          </div>
          {slowMint && (
            <div style={{ marginTop: 18, padding: "10px 14px", borderRadius: 12, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)" }}>
              <div style={{ fontFamily: T.display, fontSize: 13, color: "#fde68a" }}>Taking a little longer than usual…</div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, marginTop: 4, lineHeight: 1.5 }}>Still working on it. If it gets stuck, we&apos;ll let you know what to do.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── VERIFY (you're in + GoodDollar claim or skip) ──────────────────────
  if (phase === "verify") {
    if (alreadyVerified) return null; // completing via the effect above
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: `radial-gradient(ellipse 95% 55% at 50% 16%, rgba(34,197,94,0.18) 0%, transparent 60%), ${T.bg}`, display: "flex", flexDirection: "column", animation: "ob-fadeIn 0.25s ease both", overflow: "hidden" }}>
        <style>{KEYFRAMES}</style>
        <div style={{ flex: 1, overflowY: "auto", padding: "30px 22px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: T.body, fontSize: 11, color: "#86efac", fontWeight: 800, letterSpacing: "0.18em" }}>YOU&apos;RE IN 🎉</div>
            <h2 style={{ fontFamily: T.display, fontSize: 25, color: T.ink, margin: "5px 0 0", letterSpacing: "-0.01em" }}>Welcome, @{username}!</h2>
          </div>

          <div style={{ position: "relative", width: 120, height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.4), transparent 70%)", filter: "blur(10px)" }} />
            <span style={{ position: "absolute", top: "6%", left: "12%", fontSize: 18, animation: "ob-float-gentle 2.8s ease-in-out infinite" }}>✨</span>
            <div style={{ width: 104, height: 104, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #86efac, #16a34a 55%, #14532d)", border: "3px solid rgba(255,255,255,0.45)", boxShadow: "0 0 36px rgba(34,197,94,0.5), inset 0 -6px 14px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, animation: "ob-float-gentle 3.4s ease-in-out infinite" }}>
              <span style={{ fontFamily: T.display, fontSize: 40, color: "#fff", textShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>G$</span>
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: T.body, fontSize: 11, color: "#86efac", fontWeight: 800, letterSpacing: "0.16em" }}>FREE DAILY REWARD</div>
            <h2 style={{ fontFamily: T.display, fontSize: 27, color: T.ink, margin: "6px 0 0", letterSpacing: "-0.01em" }}>Claim free G$ every day</h2>
          </div>

          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "🪙", txt: "Claim free G$ every 24 hours" },
              { icon: "🏆", txt: "Enter prize pools & seasonal cups" },
              { icon: "🤖", txt: "Play head-to-head matches for G$" },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 13, background: T.surface, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{r.icon}</span>
                <span style={{ flex: 1, fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{r.txt}</span>
                <span style={{ color: "#22c55e" }}><CheckIcon /></span>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, textAlign: "center", marginTop: -6 }}>One quick face check proves you&apos;re human. Takes ~30s.</div>

          <button onClick={() => onComplete({ username, verified: true })} style={{
            width: "100%", maxWidth: 340, fontFamily: T.display, fontSize: 18, color: "#fff", padding: "16px", borderRadius: 16,
            background: "linear-gradient(180deg, #22c55e, #15803d)", border: "1.5px solid #22c55e",
            boxShadow: "0 14px 30px -8px rgba(34,197,94,0.6), inset 0 1px 0 rgba(255,255,255,0.4)", cursor: "pointer", letterSpacing: "0.01em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          }}>
            <span style={{ fontSize: 17 }}>🌍</span> Verify &amp; claim G$
          </button>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", marginTop: -8, lineHeight: 1.4 }}>You can verify anytime from your profile.</div>

          <button onClick={() => onComplete({ username, verified: false })} style={{
            width: "100%", maxWidth: 340, fontFamily: T.display, fontSize: 16, color: T.ink, padding: "14px", borderRadius: 16,
            background: "rgba(255,255,255,0.05)", border: `1.5px solid ${T.hairlineHi}`, cursor: "pointer", letterSpacing: "0.01em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            Skip — just start playing <PlayIcon size={14} />
          </button>
          <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", marginTop: -8, lineHeight: 1.4 }}>No rush — this stays here for whenever.</div>
        </div>
      </div>
    );
  }

  // ── CREATE (name your pet + optional switch-on help) ────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: `radial-gradient(ellipse 95% 50% at 50% 8%, ${T.accent}1f 0%, transparent 55%), ${T.bg}`, display: "flex", flexDirection: "column", animation: "ob-fadeIn 0.25s ease both", overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>
      <img src="/splash_screen_icons/dice.png" alt="" style={{ position: "absolute", top: "5%", left: -26, width: 80, opacity: 0.08, transform: "rotate(-18deg)", filter: "drop-shadow(0 0 16px #c026d3)", pointerEvents: "none" }} />
      <img src="/splash_screen_icons/joystick.png" alt="" style={{ position: "absolute", bottom: "6%", right: -20, width: 72, opacity: 0.08, transform: "rotate(14deg)", filter: "drop-shadow(0 0 16px #06b6d4)", pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "flex-end", padding: "14px 16px 0" }}>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 999, background: "rgba(255,255,255,0.06)", border: `1px solid ${T.hairline}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <CloseIcon />
        </button>
      </div>

      <div style={{ position: "relative", zIndex: 2, flex: 1, overflowY: "auto", padding: "4px 24px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: showSwitch ? 12 : 16 }}>
        <PetHero size={showSwitch ? 84 : 150} />

        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontFamily: T.display, fontSize: showSwitch ? 22 : 28, color: T.ink, margin: 0, letterSpacing: "-0.01em" }}>{showSwitch ? (username ? `Hey @${username}!` : "Hey!") : "Name your slime"}</h2>
          {!showSwitch && (
            <p style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, margin: "8px auto 0", maxWidth: 290, lineHeight: 1.5 }}>
              This is you in the arena — it&apos;s how you show up on the leaderboard, and it&apos;s yours to keep.
            </p>
          )}
        </div>

        {!showSwitch && (
          <div style={{ width: "100%", maxWidth: 340 }}>
            <input
              type="text" autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="type a name"
              value={username}
              onChange={e => { setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16)); if (mintError?.kind === "taken") setMintError(null); }}
              onKeyDown={e => { if (e.key === "Enter") start(); }}
              style={{
                width: "100%", boxSizing: "border-box", padding: "15px 16px", textAlign: "center",
                background: "rgba(0,0,0,0.4)", borderRadius: 14, color: "#fff",
                border: `1.5px solid ${mintError?.kind === "taken" ? "#f87171" : valid ? "rgba(134,239,172,0.6)" : T.hairlineHi}`,
                fontFamily: T.display, fontSize: 20, letterSpacing: "0.04em", outline: "none",
                boxShadow: valid ? "0 0 0 3px rgba(34,197,94,0.15), inset 0 2px 8px rgba(0,0,0,0.5)" : "inset 0 2px 8px rgba(0,0,0,0.5)",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, padding: "0 4px" }}>
              <span style={{ fontFamily: T.body, fontSize: 10, color: mintError?.kind === "taken" ? "#f87171" : T.inkSoft, fontWeight: 700 }}>
                {mintError?.kind === "taken" ? mintError.message : "3–16 characters"}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 800, color: username.length > 0 ? (valid ? "#86efac" : "#f87171") : T.inkSoft }}>{username.length}/16</span>
            </div>
          </div>
        )}

        {mintError?.kind === "other" && (
          <div style={{ width: "100%", maxWidth: 340, padding: "10px 13px", borderRadius: 12, background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.4)" }}>
            <div style={{ fontFamily: T.display, fontSize: 13, color: "#fda4af" }}>Something went sideways</div>
            <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim, marginTop: 4, lineHeight: 1.5 }}>{mintError.message} Tap Let&apos;s play to try again.</div>
          </div>
        )}

        <button onClick={start} disabled={!valid} style={{
          width: "100%", maxWidth: 340, fontFamily: T.display, fontSize: 19, color: "#fff", padding: "17px", borderRadius: 16,
          background: !valid ? "rgba(255,255,255,0.06)" : `linear-gradient(180deg, ${T.accent}, ${T.accent}cc)`,
          border: `1.5px solid ${!valid ? T.hairline : T.accent}`,
          boxShadow: !valid ? "none" : `0 14px 30px -8px ${T.accent}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
          cursor: valid ? "pointer" : "default", opacity: valid ? 1 : 0.6, letterSpacing: "0.02em", transition: "all 0.15s",
        }}>
          Let&apos;s play! 🎮
        </button>

        {showSwitch && !hasGas ? (
          <div style={{ width: "100%", maxWidth: 340, borderRadius: 16, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.42)", padding: 14, display: "flex", flexDirection: "column", gap: 12, animation: "ob-sheetUp 0.3s cubic-bezier(0.16,1,0.3,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 17 }}>✨</span>
              <span style={{ fontFamily: T.display, fontSize: 15, color: "#fde68a" }}>
                {mintError?.kind === "gas" ? "Quick top-up needed" : "Almost in! Let's switch on your account"}
              </span>
            </div>
            <p style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, margin: 0, lineHeight: 1.5 }}>
              {mintError?.kind === "gas"
                ? <>Your account ran low mid-flight. One <strong style={{ color: "#fff" }}>free</strong> top-up and we&apos;ll finish setting up your slime.</>
                : <>New accounts get switched on once — it&apos;s <strong style={{ color: "#fff" }}>free</strong> and takes a few seconds. Just say hi in our chat:</>}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.5)", color: "#fde68a", fontFamily: T.display, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>
              <button onClick={copyCode} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px", borderRadius: 11, cursor: "pointer", background: "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "rgba(34,197,94,0.55)" : T.hairlineHi}`, color: copied ? "#86efac" : T.ink, fontFamily: T.body, fontSize: 12.5, fontWeight: 800 }}>
                {copied ? "✓ Copied · paste it next" : "Copy my message"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.5)", color: "#fde68a", fontFamily: T.display, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</span>
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px", borderRadius: 11, textDecoration: "none", background: "linear-gradient(180deg, #38bdf8, #0ea5e9)", border: "1px solid #7dd3fc", boxShadow: "0 8px 16px -5px rgba(56,189,248,0.5)", color: "#fff", fontFamily: T.body, fontSize: 12.5, fontWeight: 800 }}>
                <TelegramIcon /> Paste it in our chat
              </a>
            </div>
            <p style={{ fontFamily: T.body, fontSize: 10.5, color: "rgba(253,230,138,0.85)", margin: 0, lineHeight: 1.5 }}>
              {triedOnceRef.current ? "Still warming up — give it a moment and tap " : "Once we reply that you're switched on, just tap "}
              <strong style={{ color: "#fde68a" }}>Let&apos;s play</strong> up there again — and you&apos;re in. 👆
            </p>
          </div>
        ) : showSwitch && hasGas ? (
          <div style={{ width: "100%", maxWidth: 340, borderRadius: 16, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.45)", padding: 14, display: "flex", alignItems: "center", gap: 10, animation: "ob-sheetUp 0.3s cubic-bezier(0.16,1,0.3,1) both" }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: T.display, fontSize: 14, color: "#86efac" }}>You&apos;re switched on!</div>
              <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkDim }}>Tap <strong style={{ color: "#fde68a" }}>Let&apos;s play</strong> above to jump in.</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: T.body, fontSize: 11, color: T.inkSoft }}>
              <span style={{ fontSize: 13 }}>🔒</span>
              <span>Free to play — no card, nothing to pay.</span>
            </div>
            <button onClick={onPlayFree} style={{
              width: "100%", maxWidth: 340, fontFamily: T.display, fontSize: 16, color: T.ink, padding: "14px", borderRadius: 16,
              background: "rgba(255,255,255,0.05)", border: `1.5px solid ${T.hairlineHi}`, cursor: "pointer", letterSpacing: "0.01em",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              Just look around first <ChevIcon />
            </button>
            <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center", marginTop: -8, lineHeight: 1.4 }}>You can pick your name anytime — nothing&apos;s lost.</div>
          </>
        )}

        {/* Wrong-account escape hatch — always visible on the create step.
            "I signed in with the wrong Gmail" was a dead end: the player
            didn't want to name a slime on the wrong account and had no
            way out. One tap signs them out and returns to the sign-in. */}
        <button
          onClick={async () => { try { await logout(); } catch { /* already out */ } onClose(); }}
          style={{
            marginTop: 4, background: "transparent", border: "none", cursor: "pointer",
            fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 700,
            textDecoration: "underline", textUnderlineOffset: 3,
          }}>
          Wrong account? Switch account
        </button>
      </div>
    </div>
  );
}
