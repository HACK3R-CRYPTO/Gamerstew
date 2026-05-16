"use client";

// ─── WalletSheet ──────────────────────────────────────────────────────────────
// Tap your G$ balance chip → this slides up. Three views inside:
//   1. overview  — balance + address + Send / Receive buttons
//   2. send      — recipient + amount form, calls G$ ERC20.transfer
//   3. receive   — QR code + copy-address button
//
// Closes the "you can earn G$ from GameArena but had no way to spend it" loop.
// Uses the same visual idiom as the profile daily-claim card (dark green wall,
// brighter green face, top gloss overlay, JuicyBtn-style action buttons) so
// it reads as a natural extension of profile, not a bolted-on wallet UI.

import { useEffect, useState } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import { formatUnits, isAddress, parseUnits } from "viem";
import QRCode from "qrcode";
import { CONTRACT_ADDRESSES, ERC20_ABI } from "@/lib/contracts";

type View = "overview" | "send" | "receive";

export function WalletSheet({
  open, onClose, address,
}: {
  open: boolean;
  onClose: () => void;
  address: `0x${string}` | undefined;
}) {
  const [view, setView] = useState<View>("overview");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  // Same pattern profile/page.tsx uses for the G$ chip — useReadContract on
  // balanceOf, then formatUnits. Keeps both surfaces in sync (when one
  // refetches after a tx, the other does too).
  const { data: gBalanceRaw, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { writeContractAsync } = useWriteContract();

  // Reset to overview every time the sheet opens. Wipe stale form state.
  useEffect(() => {
    if (open) {
      setView("overview");
      setRecipient(""); setAmount("");
      setError(null); setTxHash(null);
    }
  }, [open]);

  // Generate the QR data URL when receive view opens. qrcode lib's
  // toDataURL gives us a base64 png we can drop straight into an <img>.
  useEffect(() => {
    if (view !== "receive" || !address) { setQrSrc(null); return; }
    QRCode.toDataURL(address, {
      width: 240, margin: 1,
      color: { dark: "#064e20", light: "#86efac" },
    }).then(setQrSrc).catch(() => setQrSrc(null));
  }, [view, address]);

  // ESC closes the sheet from any view.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !address) return null;

  const balanceNum = gBalanceRaw != null
    ? Number(formatUnits(gBalanceRaw as bigint, 18))
    : 0;
  const balanceDisplay = balanceNum.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const recipientValid = isAddress(recipient);
  const amountNum = Number(amount);
  const amountValid = amountNum > 0 && amountNum <= balanceNum;
  const canSend = recipientValid && amountValid && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true); setError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipient as `0x${string}`, parseUnits(amount, 18)],
      });
      setTxHash(hash);
      // Pull the new on-chain balance so the chip + sheet show the post-send
      // number the next time the player opens the sheet (and immediately,
      // if they navigate back to overview without closing).
      refetchBalance();
      // Don't auto-close — show the success state so player sees confirmation
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Transfer failed";
      setError(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <>
      {/* Backdrop — tapping closes the sheet */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 90,
          background: "rgba(2,1,10,0.72)", backdropFilter: "blur(6px)",
          animation: "wsFade 180ms ease-out",
        }}
      />

      {/* Sheet — slides up from bottom on mobile, centered on desktop */}
      <div style={{
        position: "fixed", zIndex: 91,
        left: "50%", bottom: 0, transform: "translateX(-50%)",
        width: "100%", maxWidth: "440px",
        padding: "0 12px 12px",
        animation: "wsSlideUp 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}>
        <div style={{
          borderRadius: "20px",
          background: "#003a00",
          paddingBottom: "5px",
          boxShadow: "0 0 0 2px #15803d, 0 0 30px rgba(34,197,94,0.4), 0 -16px 40px rgba(0,0,0,0.6)",
        }}>
          <div style={{
            borderRadius: "18px 18px 14px 14px",
            background: "linear-gradient(180deg, #064e20 0%, #022010 100%)",
            border: "2px solid rgba(134,239,172,0.3)",
            padding: "16px 18px 18px",
            position: "relative", overflow: "hidden",
            display: "flex", flexDirection: "column", gap: "14px",
          }}>
            {/* Top gloss */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: "45%",
              background: "linear-gradient(180deg, rgba(134,239,172,0.12) 0%, transparent 100%)",
              pointerEvents: "none",
            }} />

            {/* Header — back arrow (in sub-views) + title + close */}
            <div style={{
              position: "relative", zIndex: 1,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {view !== "overview" ? (
                <BackButton onClick={() => setView("overview")} />
              ) : <div style={{ width: 28 }} />}
              <div style={{
                color: "rgba(134,239,172,0.85)",
                fontSize: "11px", fontWeight: 900, letterSpacing: "0.18em",
              }}>
                {view === "overview" ? "WALLET" : view === "send" ? "SEND G$" : "RECEIVE"}
              </div>
              <CloseButton onClick={onClose} />
            </div>

            {/* ───── OVERVIEW VIEW ───── */}
            {view === "overview" && (
              <>
                <BalanceCard balance={balanceDisplay} shortAddr={shortAddr} onCopyAddress={handleCopy} copied={copied} />

                <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <SheetAction
                    label="💸 SEND"
                    wallColor="#064e20"
                    faceGrad="linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)"
                    glowColor="rgba(34,197,94,0.55)"
                    onClick={() => setView("send")}
                  />
                  <SheetAction
                    label="📥 RECEIVE"
                    wallColor="#1e3a8a"
                    faceGrad="linear-gradient(160deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)"
                    glowColor="rgba(59,130,246,0.55)"
                    onClick={() => setView("receive")}
                  />
                </div>

                <div style={{
                  position: "relative", zIndex: 1,
                  color: "rgba(134,239,172,0.45)",
                  fontSize: "9.5px", fontWeight: 700,
                  letterSpacing: "0.06em",
                  textAlign: "center",
                }}>
                  Network: Celo Mainnet · Earn more by playing games or claiming daily
                </div>
              </>
            )}

            {/* ───── SEND VIEW ───── */}
            {view === "send" && !txHash && (
              <>
                <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: "rgba(134,239,172,0.65)", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em" }}>
                    AVAILABLE
                  </span>
                  <span style={{ color: "#86efac", fontSize: "14px", fontWeight: 900 }}>
                    {balanceDisplay} G$
                  </span>
                </div>

                <SheetField label="TO">
                  <input
                    value={recipient}
                    onChange={e => setRecipient(e.target.value.trim())}
                    placeholder="0x… recipient address"
                    spellCheck={false}
                    autoComplete="off"
                    style={inputStyle}
                  />
                  {recipient && !recipientValid && (
                    <div style={errorTextStyle}>Not a valid address</div>
                  )}
                </SheetField>

                <SheetField label="AMOUNT">
                  <div style={{ display: "flex", alignItems: "stretch", gap: "8px" }}>
                    <input
                      value={amount}
                      onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="0"
                      inputMode="decimal"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => setAmount(balanceNum > 0 ? String(balanceNum) : "")}
                      style={maxBtnStyle}
                    >MAX</button>
                  </div>
                  {amount && amountNum > balanceNum && (
                    <div style={errorTextStyle}>Exceeds balance</div>
                  )}
                </SheetField>

                {error && (
                  <div style={{
                    position: "relative", zIndex: 1,
                    padding: "8px 12px", borderRadius: "10px",
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.45)",
                    color: "#fca5a5", fontSize: "11px", fontWeight: 700,
                  }}>{error}</div>
                )}

                <SheetAction
                  label={sending ? "SENDING…" : `💸 SEND ${amount || "0"} G$`}
                  wallColor="#003a00"
                  faceGrad="linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)"
                  glowColor="rgba(34,197,94,0.7)"
                  onClick={handleSend}
                  disabled={!canSend}
                  fullWidth
                />
              </>
            )}

            {/* ───── SEND SUCCESS VIEW (after tx submitted) ───── */}
            {view === "send" && txHash && (
              <>
                <div style={{
                  position: "relative", zIndex: 1, textAlign: "center",
                  padding: "8px 0",
                }}>
                  <div style={{ fontSize: "36px", marginBottom: "8px" }}>✅</div>
                  <div style={{
                    color: "#86efac", fontSize: "16px", fontWeight: 900,
                    letterSpacing: "0.04em",
                  }}>
                    {amount} G$ sent
                  </div>
                  <div style={{
                    color: "rgba(134,239,172,0.6)", fontSize: "11px",
                    marginTop: "4px", fontWeight: 700,
                  }}>
                    to {recipient.slice(0, 6)}…{recipient.slice(-4)}
                  </div>
                </div>

                <a
                  href={`https://celoscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    position: "relative", zIndex: 1, textAlign: "center",
                    color: "rgba(134,239,172,0.7)", fontSize: "11px",
                    textDecoration: "underline", fontWeight: 700,
                  }}
                >
                  View on Celoscan ↗
                </a>

                <SheetAction
                  label="DONE"
                  wallColor="#064e20"
                  faceGrad="linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)"
                  glowColor="rgba(34,197,94,0.55)"
                  onClick={onClose}
                  fullWidth
                />
              </>
            )}

            {/* ───── RECEIVE VIEW ───── */}
            {view === "receive" && (
              <>
                <div style={{
                  position: "relative", zIndex: 1, display: "flex", justifyContent: "center",
                }}>
                  {qrSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={qrSrc}
                      alt="Wallet QR"
                      width={240}
                      height={240}
                      style={{
                        borderRadius: "14px",
                        boxShadow: "0 0 18px rgba(134,239,172,0.4)",
                        background: "#86efac",
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 240, height: 240, borderRadius: "14px",
                      background: "rgba(134,239,172,0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "rgba(134,239,172,0.5)", fontSize: "11px", fontWeight: 700,
                    }}>generating QR…</div>
                  )}
                </div>

                <div style={{
                  position: "relative", zIndex: 1,
                  padding: "10px 14px", borderRadius: "12px",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(134,239,172,0.2)",
                  textAlign: "center",
                  color: "rgba(229,231,235,0.92)",
                  fontFamily: "monospace",
                  fontSize: "12px", fontWeight: 700,
                  wordBreak: "break-all",
                }}>
                  {address}
                </div>

                <SheetAction
                  label={copied ? "✓ COPIED" : "📋 COPY ADDRESS"}
                  wallColor={copied ? "#064e20" : "#1e3a8a"}
                  faceGrad={copied
                    ? "linear-gradient(160deg, #86efac 0%, #22c55e 50%, #15803d 100%)"
                    : "linear-gradient(160deg, #93c5fd 0%, #3b82f6 50%, #1d4ed8 100%)"}
                  glowColor={copied ? "rgba(34,197,94,0.55)" : "rgba(59,130,246,0.55)"}
                  onClick={handleCopy}
                  fullWidth
                />

                <div style={{
                  position: "relative", zIndex: 1,
                  color: "rgba(134,239,172,0.55)",
                  fontSize: "10px", fontWeight: 700,
                  letterSpacing: "0.04em",
                  textAlign: "center",
                }}>
                  Only send G$ or other Celo tokens to this address. Network: Celo Mainnet.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes wsFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes wsSlideUp {
          from { transform: translate(-50%, 100%); opacity: 0.6; }
          to   { transform: translate(-50%, 0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ─── Sub-components (kept inline so the sheet is one self-contained file) ───

function BalanceCard({ balance, shortAddr, onCopyAddress, copied }: {
  balance: string; shortAddr: string;
  onCopyAddress: () => void; copied: boolean;
}) {
  return (
    <div style={{
      position: "relative", zIndex: 1,
      borderRadius: "14px",
      background: "linear-gradient(180deg, rgba(134,239,172,0.16) 0%, rgba(34,197,94,0.06) 100%)",
      border: "1.5px solid rgba(134,239,172,0.4)",
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: "8px",
    }}>
      <div style={{
        color: "rgba(134,239,172,0.7)", fontSize: "10px",
        fontWeight: 800, letterSpacing: "0.18em",
      }}>G$ BALANCE</div>
      <div style={{
        color: "#86efac", fontSize: "30px", fontWeight: 900,
        lineHeight: 1, textShadow: "0 0 16px rgba(134,239,172,0.55)",
      }}>{balance}</div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginTop: "4px",
      }}>
        <span style={{
          color: "rgba(229,231,235,0.85)",
          fontFamily: "monospace", fontSize: "12px", fontWeight: 700,
        }}>{shortAddr}</span>
        <button
          onClick={onCopyAddress}
          style={{
            padding: "5px 11px", borderRadius: "999px",
            background: "rgba(134,239,172,0.12)",
            border: "1px solid rgba(134,239,172,0.4)",
            color: copied ? "#86efac" : "rgba(229,231,235,0.92)",
            fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >{copied ? "✓ COPIED" : "📋 COPY"}</button>
      </div>
    </div>
  );
}

function SheetAction({
  label, wallColor, faceGrad, glowColor, onClick, fullWidth, disabled,
}: {
  label: string; wallColor: string; faceGrad: string; glowColor: string;
  onClick: () => void; fullWidth?: boolean; disabled?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={disabled ? undefined : onClick}
      style={{
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        width: fullWidth ? "100%" : "auto",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity 0.12s, transform 0.12s",
        position: "relative", zIndex: 1,
      }}
      onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: "14px", background: wallColor, paddingBottom: "5px",
        boxShadow: `0 10px 24px -4px ${glowColor}`,
      }}>
        <div style={{
          borderRadius: "12px 12px 10px 10px",
          background: faceGrad,
          padding: "12px 16px", textAlign: "center", position: "relative", overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.65), inset 0 -3px 6px rgba(0,0,0,0.3)",
        }}>
          <div style={{
            position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <span style={{
            color: "white", fontSize: 13, fontWeight: 900,
            letterSpacing: "0.14em", position: "relative", zIndex: 1,
          }}>{label}</span>
        </div>
      </div>
    </div>
  );
}

function SheetField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      position: "relative", zIndex: 1,
      display: "flex", flexDirection: "column", gap: "6px",
    }}>
      <div style={{
        color: "rgba(134,239,172,0.7)", fontSize: "10px",
        fontWeight: 800, letterSpacing: "0.14em",
      }}>{label}</div>
      {children}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Back" style={{
      width: 28, height: 28, borderRadius: "999px",
      background: "rgba(134,239,172,0.12)",
      border: "1px solid rgba(134,239,172,0.3)",
      color: "#86efac", fontSize: "14px", fontWeight: 900,
      cursor: "pointer", lineHeight: 1,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>←</button>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Close" style={{
      width: 28, height: 28, borderRadius: "999px",
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.18)",
      color: "rgba(229,231,235,0.85)", fontSize: "13px", fontWeight: 900,
      cursor: "pointer", lineHeight: 1,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>✕</button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "12px",
  background: "rgba(0,0,0,0.4)",
  border: "1.5px solid rgba(134,239,172,0.25)",
  color: "white",
  fontSize: "13px",
  fontWeight: 700,
  fontFamily: "inherit",
  outline: "none",
};

const maxBtnStyle: React.CSSProperties = {
  padding: "0 14px",
  borderRadius: "12px",
  background: "rgba(251,191,36,0.15)",
  border: "1.5px solid rgba(251,191,36,0.5)",
  color: "#fbbf24",
  fontSize: "11px",
  fontWeight: 900,
  letterSpacing: "0.1em",
  cursor: "pointer",
};

const errorTextStyle: React.CSSProperties = {
  color: "#fca5a5",
  fontSize: "10px",
  fontWeight: 700,
  marginTop: "2px",
};
