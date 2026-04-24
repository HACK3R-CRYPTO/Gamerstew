"use client";

// ─── /mint ────────────────────────────────────────────────────────────────────
// Step 2 of onboarding: after /connect, before /verify. The Game Pass is a
// soulbound NFT that carries the player's username — the old UI had this in
// GamePassGate.jsx, but the new UI shipped without it, so first-time users
// reached /games with no on-chain identity and their scores couldn't post
// correctly.
//
// Flow:
//   /connect → /mint → /verify → /games
//
// If the user already has a pass, we short-circuit straight to /verify.
// If they don't, we show a single-input form (3-16 chars, alphanumeric +
// underscore) and call passContract.mint(username). On success we forward
// to /verify preserving the original ?next= target.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, celoFeeSpread } from "@/lib/contracts";

// Minimum CELO we ask non-MiniPay wallets to hold before we let them tap
// MINT. 0.002 CELO is a comfortable margin over the ~0.0005 CELO a Game
// Pass mint actually costs, leaves headroom for one retry, and is dust-level
// on Celo (~$0.002). MiniPay users skip this check entirely because their
// gas is paid in USDC via the fee-currency adapter.
const GAS_MIN_CELO_WEI = 2_000_000_000_000_000n; // 0.002 * 1e18

const TELEGRAM_URL = "https://t.me/+oY4inbBoglViNmE0";

function MintInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/games";
  // After mint we send the user through verify next, so they claim G$ and
  // unlock leaderboard + wager eligibility. Preserves the originally
  // requested destination through the chain of redirects.
  const afterMint = `/verify?next=${encodeURIComponent(next)}`;

  const { authenticated, ready } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();

  const [username, setUsername] = useState("");
  const [minting, setMinting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Structured error kind lets us render a specific remediation card per
  // failure class instead of dumping raw RPC text on non-technical users.
  //   "gas"     → wallet has no CELO; show faucet/Telegram CTA.
  //   "taken"   → username already minted by someone else.
  //   "other"   → generic; fall back to the raw message preview.
  const [errKind, setErrKind] = useState<"gas" | "taken" | "other" | null>(null);
  // Flips on after 20s of waiting so we can tell the user the tx is unusually
  // slow without making them watch a silent spinner. Most Celo txs land in
  // 5-10s; anything past 20s is almost always a gas issue.
  const [slowMint, setSlowMint] = useState(false);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connected = ready && (authenticated || (isMiniPay && !!address));

  // CELO balance — only meaningful for non-MiniPay users because MiniPay
  // pays fees in USDC via celoFeeSpread. For MiniPay we skip the check
  // entirely and the MINT button is always enabled.
  const { data: celoBalance } = useBalance({
    address,
    query: { enabled: !!address && !isMiniPay, refetchInterval: 15_000 },
  });
  const hasGas = isMiniPay || (celoBalance ? celoBalance.value >= GAS_MIN_CELO_WEI : false);

  // Check if they already have a pass — if so, skip this page entirely.
  const { data: hasMinted, isLoading: checkingPass, refetch: refetchPass } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
    abi: GAME_PASS_ABI,
    functionName: "hasMinted",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Guard: not connected → bounce to /connect. Retains the ?next= chain so
  // the user ends up where they originally wanted after the full onboarding.
  useEffect(() => {
    if (!ready) return;
    if (!connected) {
      router.replace(`/connect?next=${encodeURIComponent(next)}`);
    }
  }, [ready, connected, next, router]);

  // Already minted → advance. No point showing the form.
  useEffect(() => {
    if (hasMinted === true) {
      router.replace(afterMint);
    }
  }, [hasMinted, afterMint, router]);

  async function handleMint() {
    setErr(null);
    setErrKind(null);
    if (username.length < 3) {
      setErr("Username must be at least 3 characters");
      setErrKind("other");
      return;
    }
    setMinting(true);
    setSlowMint(false);
    // If the tx has not resolved in 20s, flip the "taking longer than
    // usual" hint on. Most Celo mints land in 5-10s; 20s+ means gas,
    // RPC hiccup, or a wallet prompt the user didn't notice.
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = setTimeout(() => setSlowMint(true), 20_000);
    try {
      // MiniPay users have no CELO, so every writeContract must pay the
      // network fee in a Celo fee-currency adapter (USDC by default).
      // celoFeeSpread returns an empty spread for non-MiniPay callers so
      // wagmi falls back to the native gas token (CELO) on mainnet.
      await writeContractAsync({
        address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`,
        abi: GAME_PASS_ABI,
        functionName: "mint",
        args: [username],
        ...celoFeeSpread(isMiniPay),
      });
      // Contract state takes a beat to reflect — refetch once so the
      // redirect effect above fires cleanly after the tx lands.
      await refetchPass();
      router.replace(afterMint);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      // Race: same wallet already minted in another tab. Silent success.
      if (lower.includes("already minted")) {
        await refetchPass();
        router.replace(afterMint);
        return;
      }
      // Username collision — specific recoverable error.
      if (lower.includes("username taken")) {
        setErr("Username taken. Try another.");
        setErrKind("taken");
        return;
      }
      // Gas / insufficient funds classification. Cover the wording used
      // by viem, MetaMask, Privy embedded wallets, and the Celo RPC.
      const isGas =
        lower.includes("insufficient funds") ||
        lower.includes("insufficient balance") ||
        lower.includes("out of gas") ||
        lower.includes("gas required exceeds") ||
        lower.includes("cannot estimate gas") ||
        lower.includes("exceeds allowance");
      if (isGas) {
        setErr("Your wallet needs a bit of CELO to pay the network fee.");
        setErrKind("gas");
        return;
      }
      setErr(raw.slice(0, 140));
      setErrKind("other");
    } finally {
      setMinting(false);
      setSlowMint(false);
      if (slowTimerRef.current) { clearTimeout(slowTimerRef.current); slowTimerRef.current = null; }
    }
  }

  const valid = username.length >= 3 && username.length <= 16;

  return (
    <div style={{
      position: "fixed", inset: 0, overflow: "hidden",
      background: "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
    }}>
      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(5,1,20,0.55) 100%)",
      }} />

      <main style={{
        position: "absolute", inset: 0, overflowY: "auto",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-start",
        padding: "clamp(14px, 3.5vw, 28px) clamp(14px, 4vw, 24px) clamp(24px, 5vw, 40px)",
        paddingTop: "max(clamp(14px, 3.5vw, 28px), env(safe-area-inset-top, 0px))",
        paddingBottom: "max(clamp(24px, 5vw, 40px), env(safe-area-inset-bottom, 0px))",
        gap: "clamp(12px, 3vw, 24px)",
      }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{
            width: "clamp(140px, 28vw, 380px)",
            height: "auto",
            animation: "bounce-scale-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both",
            flexShrink: 0,
          }}
        />

        {/* Panel */}
        <div style={{
          width: "100%", maxWidth: "420px",
          borderRadius: "28px",
          background: "#1a0550",
          paddingBottom: "8px",
          boxShadow: "0 0 0 3px #5b21b6, 0 0 60px rgba(109,40,217,0.6), 0 40px 80px rgba(0,0,0,0.95)",
          animation: "scaleIn 0.25s cubic-bezier(0.16,1,0.3,1) both",
        }}>
          <div style={{
            borderRadius: "26px 26px 20px 20px",
            background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 45%, #07021a 100%)",
            border: "2px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 8px 24px rgba(160,100,255,0.15)",
            overflow: "hidden", position: "relative",
          }}>
            {/* Header */}
            <div style={{
              background: "linear-gradient(90deg, #4c1d95 0%, #7c3aed 40%, #9333ea 60%, #7c3aed 80%, #4c1d95 100%)",
              padding: "clamp(14px, 3.5vw, 20px) clamp(16px, 4vw, 24px)",
              borderBottom: "2px solid rgba(255,255,255,0.18)",
              boxShadow: "inset 0 6px 16px rgba(255,255,255,0.2)",
              position: "relative", overflow: "hidden",
              textAlign: "center",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: "55%",
                background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)",
                borderRadius: "26px 26px 60px 60px", pointerEvents: "none",
              }} />
              <h2 style={{
                margin: 0, fontSize: "clamp(14px, 3.8vw, 16px)", fontWeight: 900,
                letterSpacing: "0.12em", color: "white",
                textShadow: "0px 2px 4px rgba(0,0,0,0.5), 0 0 20px rgba(200,150,255,0.6)",
                position: "relative", zIndex: 1,
              }}>CHOOSE YOUR NAME</h2>
              <p style={{
                margin: "4px 0 0", fontSize: "clamp(10.5px, 2.9vw, 12px)",
                color: "rgba(255,255,255,0.75)",
                position: "relative", zIndex: 1,
              }}>
                This is how you&apos;ll show up on the leaderboard.
              </p>
            </div>

            {/* Content */}
            <div style={{
              padding: "clamp(14px, 3.5vw, 20px)",
              display: "flex", flexDirection: "column",
              gap: "clamp(10px, 2.5vw, 14px)",
            }}>
              {checkingPass && (
                <div style={{
                  textAlign: "center", padding: "18px",
                  color: "rgba(200,180,255,0.6)", fontSize: "12px",
                  fontWeight: 700, letterSpacing: "0.1em",
                }}>
                  CHECKING...
                </div>
              )}

              {!checkingPass && (
                <>
                  {/* Username input */}
                  <div>
                    <div style={{
                      color: "rgba(200,180,255,0.7)", fontSize: "10px", fontWeight: 900,
                      letterSpacing: "0.18em", marginBottom: "6px",
                    }}>USERNAME</div>
                    <input
                      type="text"
                      inputMode="text"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="pick_a_name"
                      value={username}
                      onChange={e => setUsername(
                        // Keep only alphanumeric + underscore; cap at 16.
                        // Matches the contract's validation so the user
                        // can't type something that'll revert on-chain.
                        e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16)
                      )}
                      onKeyDown={e => { if (e.key === "Enter" && valid && !minting) handleMint(); }}
                      disabled={minting}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "clamp(11px, 3vw, 14px) clamp(14px, 3.5vw, 16px)",
                        background: "rgba(0,0,0,0.4)",
                        border: `1.5px solid ${valid ? "rgba(134,239,172,0.55)" : "rgba(110,60,220,0.4)"}`,
                        borderRadius: "12px",
                        color: "white",
                        fontSize: "clamp(14px, 3.8vw, 16px)",
                        fontFamily: "inherit",
                        outline: "none",
                        textAlign: "center",
                        letterSpacing: "0.06em",
                        transition: "border-color 0.15s, box-shadow 0.15s",
                        boxShadow: valid
                          ? "0 0 0 3px rgba(34,197,94,0.15), inset 0 2px 8px rgba(0,0,0,0.5)"
                          : "inset 0 2px 8px rgba(0,0,0,0.5)",
                      }}
                    />
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      marginTop: "6px", padding: "0 4px",
                    }}>
                      <span style={{
                        color: "rgba(160,130,200,0.55)", fontSize: "10px", fontWeight: 700,
                      }}>3-16 chars · letters, numbers, _</span>
                      <span style={{
                        color: username.length > 0 ? (valid ? "#86efac" : "#f87171") : "rgba(160,130,200,0.5)",
                        fontSize: "10px", fontWeight: 800, fontFamily: "monospace",
                      }}>{username.length}/16</span>
                    </div>
                  </div>

                  {/* Inline error — only for non-gas cases, since gas gets
                      its own tiny chip under the button. One line, no card. */}
                  {err && errKind !== "gas" && (
                    <div style={{
                      padding: "8px 12px", borderRadius: "10px",
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.4)",
                      color: "#fca5a5", fontSize: "11.5px", lineHeight: 1.4,
                    }}>
                      {err}
                    </div>
                  )}

                  {/* Mint CTA — juicy green pill matching /verify's button.
                      Disabled when either the username is invalid or the
                      wallet has no gas (non-MiniPay path). Preventing the
                      tap is the fix for "loading forever" — nothing queues
                      if we never call writeContractAsync. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-disabled={!valid || minting || !hasGas}
                    onClick={() => { if (valid && !minting && hasGas) handleMint(); }}
                    style={{
                      cursor: valid && !minting && hasGas ? "pointer" : "default",
                      userSelect: "none",
                      transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                      opacity: valid && hasGas ? 1 : 0.55,
                      marginTop: "4px",
                    }}
                    onMouseDown={e => { if (valid && !minting && hasGas) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(5px)"; }}
                    onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
                  >
                    <div style={{
                      borderRadius: "20px",
                      background: "#003a00",
                      paddingBottom: "7px",
                      boxShadow: "0 12px 28px -6px rgba(34,197,94,0.6), inset 0 -3px 8px rgba(0,0,0,0.4)",
                    }}>
                      <div style={{
                        borderRadius: "18px 18px 14px 14px",
                        background: "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)",
                        padding: "clamp(12px, 3.5vw, 16px) clamp(16px, 4vw, 24px)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                        position: "relative", overflow: "hidden",
                        border: "2.5px solid rgba(255,255,255,0.45)",
                        boxShadow: "inset 0 10px 22px rgba(255,255,255,0.8), inset 0 -5px 12px rgba(0,0,0,0.25)",
                      }}>
                        <div style={{
                          position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
                          background: "linear-gradient(180deg, rgba(255,255,255,0.75) 0%, transparent 100%)",
                          borderRadius: "16px 16px 80px 80px", pointerEvents: "none",
                        }} />
                        {minting ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" style={{ zIndex: 1, animation: "icon-float 1s ease-in-out infinite" }}>
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                          </svg>
                        ) : (
                          <span style={{ zIndex: 1, fontSize: "clamp(18px, 5vw, 22px)" }}>🎟️</span>
                        )}
                        <span style={{
                          zIndex: 1, color: "white",
                          fontSize: "clamp(12px, 3.4vw, 15px)",
                          fontWeight: 900, letterSpacing: "0.08em",
                          textShadow: "0px 2px 4px rgba(0,0,0,0.35)",
                          whiteSpace: "nowrap",
                        }}>
                          {minting ? "MINTING..." : "MINT GAME PASS (FREE)"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Tiny status line below the button. Three possible states,
                      one line each, no card — keeps the visual weight on the
                      MINT action itself. */}
                  {minting ? (
                    slowMint ? (
                      <div style={{
                        fontSize: "10.5px", textAlign: "center",
                        color: "#fde68a", lineHeight: 1.4,
                      }}>
                        Taking longer than usual. <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#67e8f9", fontWeight: 800, textDecoration: "none", borderBottom: "1px dashed rgba(103,232,249,0.5)" }}>Get help →</a>
                      </div>
                    ) : (
                      <div style={{ fontSize: "10.5px", textAlign: "center", color: "rgba(160,130,200,0.55)" }}>
                        Waiting for wallet confirmation...
                      </div>
                    )
                  ) : isMiniPay ? (
                    <div style={{ fontSize: "10.5px", textAlign: "center", color: "rgba(160,130,200,0.5)" }}>
                      Soulbound NFT · fees paid in USDC
                    </div>
                  ) : !hasGas && celoBalance ? (
                    // Minimal alert pattern: title + one primary CTA + tiny
                    // inline link. Same visual grammar as the finish-screen
                    // gas card in rhythm/simon so the recovery flow looks
                    // like one consistent product feature.
                    <div style={{
                      padding: "12px 14px", borderRadius: "12px",
                      background: "linear-gradient(180deg, rgba(249,115,22,0.12) 0%, rgba(120,50,0,0.18) 100%)",
                      border: "1px solid rgba(249,115,22,0.45)",
                      boxShadow: "0 0 14px rgba(249,115,22,0.12)",
                      display: "flex", flexDirection: "column",
                      gap: "8px", textAlign: "center",
                    }}>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        gap: "8px",
                        color: "#fed7aa",
                        fontSize: "clamp(11px, 3vw, 12.5px)",
                        fontWeight: 900, letterSpacing: "0.18em",
                        textShadow: "0 0 10px rgba(249,115,22,0.5)",
                      }}>
                        <span style={{ fontSize: "14px" }}>⛽</span>
                        NEEDS A TOP UP TO MINT
                      </div>
                      <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer"
                        style={{
                          display: "block",
                          padding: "10px 14px", borderRadius: "10px",
                          background: "linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)",
                          color: "white",
                          fontSize: "clamp(11px, 2.9vw, 12px)",
                          fontWeight: 900, letterSpacing: "0.1em",
                          textDecoration: "none",
                          border: "1.5px solid rgba(255,255,255,0.4)",
                          boxShadow: "0 6px 14px rgba(6,182,212,0.4), inset 0 2px 6px rgba(255,255,255,0.25)",
                        }}>
                        💬 GET HELP IN TELEGRAM
                      </a>
                      <button
                        onClick={() => { if (address) navigator.clipboard?.writeText(address).catch(() => {}); }}
                        style={{
                          background: "none", border: "none", padding: 0,
                          color: "rgba(200,170,255,0.7)",
                          fontSize: "clamp(10px, 2.5vw, 10.5px)",
                          fontWeight: 700, letterSpacing: "0.04em",
                          cursor: "pointer", fontFamily: "inherit",
                          textDecoration: "underline",
                          textDecorationStyle: "dashed",
                          textDecorationColor: "rgba(200,170,255,0.35)",
                          textUnderlineOffset: "3px",
                        }}>
                        Copy wallet ID
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: "10.5px", textAlign: "center", color: "rgba(160,130,200,0.5)" }}>
                      Soulbound NFT · one per wallet
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function MintPage() {
  return (
    <Suspense>
      <MintInner />
    </Suspense>
  );
}
