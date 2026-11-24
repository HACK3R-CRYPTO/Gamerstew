"use client";

// ─── useRankedRun ────────────────────────────────────────────────────────────
// Everything a game needs to put a run on the board, in two calls:
//
//   const ranked = useRankedRun("ladder");
//   const opened = await ranked.start();            // server ticket (+ anything it deals)
//   const saved  = await ranked.finish({ score, gameTime, proof });
//
// finish() does the three steps every game was repeating in its own page:
//   1. the server checks the run and approves a score
//   2. the score goes on-chain: gasless (the backend sends it) or, when the
//      gasless budget is used up, the player's wallet sends it
//   3. the run is saved for the leaderboard, XP, missions and achievements
//
// A game that is new to ranking only has to supply `proof`, its own record of
// what the player did. Guests can still play: `canRank` is false and the game
// keeps the score on the device.

import { useCallback, useRef, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { useAuthStatus } from "@/hooks/useRequireAuth";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { CONTRACT_ADDRESSES, GAME_PASS_ABI, detectFeeSpread } from "@/lib/contracts";
import { startRun, signRun, saveRun, type GameId, type StartRunResult } from "@/app/actions/game";

export interface RankedResult {
  score: number;        // the score the server approved
  txHash: string | null;
  gasless: boolean;
  rank?: number;
  xpEarned?: number;
  level?: number;
  leveledUp?: boolean;
  isNewPb?: boolean;
  streak?: number;
}
export type RankedStatus = "idle" | "checking" | "wallet" | "saving" | "saved" | "error";

export function useRankedRun(game: GameId) {
  const { address } = useAccount();
  const { authed } = useAuthStatus();
  const { getAccessToken, user } = usePrivy();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();
  const { data: hasMinted } = useReadContract({
    address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "hasMinted",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const isEmbeddedWallet = user?.linkedAccounts?.some((a: { type: string; walletClientType?: string }) => a.type === "wallet" && a.walletClientType === "privy");

  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<RankedStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RankedResult | null>(null);

  /** signed in, with a GamePass: this player's runs can be ranked */
  const canRank = authed && !!address && hasMinted === true;

  const token = useCallback(async () => (isMiniPay ? null : await getAccessToken()), [isMiniPay, getAccessToken]);

  const start = useCallback(async (): Promise<StartRunResult> => {
    tokenRef.current = null; setStatus("idle"); setError(null); setResult(null);
    if (!canRank || !address) return { success: false, error: "Not signed in" };
    const auth = await token();
    if (!isMiniPay && !auth) return { success: false, error: "Not signed in" };
    const opened = await startRun(auth, address, game);
    if (opened.success) tokenRef.current = opened.sessionToken;
    return opened;
  }, [canRank, address, token, isMiniPay, game]);

  const finish = useCallback(async (run: { score: number; gameTime: number; proof?: Record<string, unknown> }): Promise<RankedResult | null> => {
    const sessionToken = tokenRef.current;
    if (!sessionToken || !address) return null;
    tokenRef.current = null; // a ticket is single-use
    const fail = (m: string) => { setError(m); setStatus("error"); return null; };
    try {
      setStatus("checking"); setError(null);
      const auth = await token();
      if (!isMiniPay && !auth) return fail("Not signed in. Score not saved.");
      const sig = await signRun(auth, address, { game, score: run.score, sessionToken, proof: run.proof });
      if (!sig.success) return fail(sig.error || "The server could not check this run.");
      const score = typeof sig.score === "number" ? sig.score : run.score;

      let txHash: string | null = null;
      if (sig.gasless) txHash = sig.txHash;
      else {
        setStatus("wallet");
        try {
          txHash = await writeContractAsync({
            dataSuffix: ATTRIBUTION_SUFFIX,
            address: CONTRACT_ADDRESSES.GAME_PASS as `0x${string}`, abi: GAME_PASS_ABI, functionName: "recordScoreWithBackendSig",
            args: [sig.gameType, BigInt(score), BigInt(sig.nonce), sig.signature as `0x${string}`],
            ...(isEmbeddedWallet ? { gas: 300000n } : {}),
            ...(await detectFeeSpread(isMiniPay, address as `0x${string}`)),
          });
        } catch (e) {
          const m = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "").toLowerCase();
          return fail(m.includes("reject") || m.includes("denied") ? "You cancelled the transaction. Score not saved." : "Score did not save. Your wallet may need a small top up.");
        }
      }

      setStatus("saving");
      const saved = await saveRun(auth, address, { game, score, gameTime: Math.max(5000, run.gameTime), txHash });
      const out: RankedResult = { score, txHash, gasless: !!sig.gasless, ...(saved.success ? { rank: saved.rank, xpEarned: saved.xpEarned, level: saved.level, leveledUp: saved.leveledUp, isNewPb: saved.isNewPb, streak: saved.streak } : {}) };
      setResult(out); setStatus("saved");
      // the score is on-chain even if this last save failed, so say so plainly
      if (!saved.success) setError("Score is on-chain. The leaderboard will catch up shortly.");
      return out;
    } catch {
      return fail("Something went wrong. Score not saved.");
    }
  }, [address, token, isMiniPay, game, writeContractAsync, isEmbeddedWallet]);

  return { canRank, authed, needsPass: authed && hasMinted === false, status, error, result, start, finish, hasTicket: () => !!tokenRef.current };
}
