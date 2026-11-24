"use client";

// ─── Did the score really reach the chain? ───────────────────────────────────
// A transaction being SENT is not the same as it SUCCEEDING. This asks the
// chain for the receipt and says what happened: still confirming, confirmed, or
// failed. It is what lets a result screen say "recorded on-chain" and mean it.

import { useEffect, useState } from "react";
import { useWaitForTransactionReceipt } from "wagmi";
import { txUrl } from "@/lib/subgraph";

const CELO = 42220;
const SLOW_MS = 45_000; // past this, stop implying it is about to land

export type TxState = "confirming" | "confirmed" | "failed" | "slow";

/** The state of one transaction, watched until it is final. */
export function useTxState(hash?: string | null): TxState | null {
  const ok = !!hash && /^0x[0-9a-fA-F]{64}$/.test(hash);
  const { data, isError } = useWaitForTransactionReceipt({ hash: ok ? (hash as `0x${string}`) : undefined, chainId: CELO, confirmations: 1, query: { enabled: ok, retry: 6 } });
  const [slow, setSlow] = useState(false);
  useEffect(() => { if (!ok) return; setSlow(false); const t = setTimeout(() => setSlow(true), SLOW_MS); return () => clearTimeout(t); }, [hash, ok]);
  if (!ok) return null;
  if (data) return data.status === "success" ? "confirmed" : "failed";
  if (isError || slow) return "slow";
  return "confirming";
}

export default function TxStatus({ hash, compact }: { hash?: string | null; compact?: boolean }) {
  const state = useTxState(hash);
  if (!state || !hash) return null;
  const words: Record<TxState, string> = {
    confirming: "Confirming on the chain…",
    confirmed: "Confirmed on the chain",
    failed: "The transaction failed on the chain. This score was not recorded there.",
    slow: "Still waiting for the chain to confirm.",
  };
  const tone = state === "confirmed" ? "#166534" : state === "failed" ? "#9f1239" : "rgba(34,16,79,0.7)";
  return (
    <span role="status" style={{ display: compact ? "inline-flex" : "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: compact ? 12.5 : 13.5, fontWeight: 700, color: tone, lineHeight: 1.35 }}>
      {state === "confirming" && <i aria-hidden style={{ width: 13, height: 13, borderRadius: "50%", border: "2.5px solid rgba(76,29,149,0.2)", borderTopColor: "#6d28d9", animation: "txSpin .7s linear infinite", flex: "none" }} />}
      {state === "confirmed" && <i aria-hidden style={{ width: 17, height: 17, borderRadius: "50%", background: "#dcfce7", border: "1px solid rgba(22,163,74,0.45)", display: "grid", placeItems: "center", fontStyle: "normal", fontSize: 10.5, flex: "none" }}>✓</i>}
      <span>{words[state]}</span>
      <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer" style={{ color: "#6d28d9", fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>{state === "confirmed" ? "View it ›" : "Check it ›"}</a>
      <style>{`@keyframes txSpin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
