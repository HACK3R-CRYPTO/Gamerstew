"use client";

// ─── useGasStatus ─────────────────────────────────────────────────────────────
// Buckets the player's current CELO balance into one of four states so every
// gas-aware surface (lobby gate, AccountSheet status pill, post-fail rescue)
// reads from the same source of truth instead of each one rolling its own
// threshold math.
//
// Why this matters · onchain finality is binary. A score is either recorded
// on Celo mainnet or it doesn't exist. By the time `submitScore` throws an
// insufficient-funds error the run is already lost · the player tapped to
// drop blocks for ten minutes, hit a new PB, and the database has nothing.
// The fix has to be at the GATE before the run starts, not at the rescue
// after the fall. This hook is that gate's vital sign.
//
// Buckets:
//   guest      · no wallet connected · no gas needed, free-play only
//   minipay    · MiniPay user · USDC fee-currency adapter pays gas, no CELO
//                check applies. Treat as `safe` to skip every gate.
//   safe       · ≥ WARN_THRESHOLD · plenty of headroom for normal play
//   warn       · between BLOCK and WARN · still playable, encourage top-up
//   block      · < BLOCK_THRESHOLD · effectively zero, must top up first
//
// Thresholds are env-tunable so we can dial them up/down without redeploys.
// Defaults sized against REAL recordScoreWithBackendSig receipts on Celo
// mainnet (2026-06-24 telemetry):
//   - gas used: 55k-130k, weighted avg ~58k for simon, ~63k for stack,
//     ~78k for rhythm
//   - effective gas price: 202.5 gwei (Celo's current base fee floor)
//   - per-tx cost: 0.011 – 0.026 CELO, weighted avg ~0.012 CELO
// The 0.05 CELO per-submit constant below = max observed (0.026) + a
// safety pad for gas spikes between gate-check and tx submit.
//
// ─── A known edge case we DELIBERATELY do not compensate for ────────────
// External wallets (Rabby tested 2026-06-25, likely MetaMask too) use a
// USD-rounded "Gas Balance" display and hard-reject at < $0.01 post-tx.
// At CELO ≈ $0.068 that's a ~0.2 CELO effective wallet floor. We don't
// raise OUR gate to that level because:
//   1. Privy embedded wallets (the 90%+ majority path) sign silently
//      and don't impose that floor · raising the gate would penalise
//      them for an issue they never hit.
//   2. The Rabby user can't be saved by our gate either way · their
//      wallet will reject them at whatever balance we let them through.
//      The right answer for that user is "top up more CELO," not "our
//      app blocks them earlier with a friendlier message."
// If/when external-wallet usage grows enough to justify it, we can either
// detect wallet type at the call site and pass higher overrides, or just
// raise the env defaults. For now: gate against real tx cost, accept
// that external-wallet UX has a separate ceiling we don't manage.

import { useAccount, useBalance } from "wagmi";
import { celo } from "viem/chains";
import { formatEther, parseEther } from "viem";
import { useIsMiniPay } from "@/hooks/useMiniPay";

export type GasBucket = "guest" | "minipay" | "safe" | "warn" | "block";

// Per-submit cost the gate plans against. Sized to swallow raw tx max
// observed (0.026) + a margin for gas spikes / wallet estimation buffer.
const PER_SUBMIT_SAFE_CELO = 0.05;
const WARN_DEFAULT = "0.15";   // ≥ this → safe · roughly 3 safe saves ahead
const BLOCK_DEFAULT = "0.05";  // < this → can't reliably afford one save

// Callers can override the per-game thresholds. MARKOV / Arena matches are
// 5-10× heavier per tx (propose ~ 0.1 CELO at 202.5 gwei) so the score-game
// defaults would let a player tap PLAY only to fail at the wager step.
// Pass `{ warnFloorCelo, blockFloorCelo, perTxCelo }` to recalibrate for
// that surface · all three are optional and fall back to env / defaults.
export type GasStatusOptions = {
  warnFloorCelo?: number;
  blockFloorCelo?: number;
  perTxCelo?: number;
};

function envFloor(envKey: string, fallback: string): bigint {
  const raw = process.env[envKey];
  const v = raw && !Number.isNaN(Number(raw)) ? raw : fallback;
  try { return parseEther(v as `${number}`); } catch { return parseEther(fallback as `${number}`); }
}

export function useGasStatus(opts: GasStatusOptions = {}): {
  status: GasBucket;
  balanceWei: bigint | undefined;
  balanceCelo: number;
  // Approx how many more scores the player can submit before hitting block.
  // Useful for warn-state copy ("about N saves left"). null when unknown.
  approxSavesLeft: number | null;
} {
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();

  const { data } = useBalance({
    address,
    chainId: celo.id,
    query: {
      enabled: !!address && !isMiniPay,
      refetchInterval: 20_000,
    },
  });

  if (!address) {
    return { status: "guest", balanceWei: undefined, balanceCelo: 0, approxSavesLeft: null };
  }
  if (isMiniPay) {
    return { status: "minipay", balanceWei: undefined, balanceCelo: 0, approxSavesLeft: null };
  }

  const wei = data?.value;
  if (wei === undefined) {
    // Still loading · treat as safe so we don't pre-emptively block. The
    // gate revalidates on the next refetch.
    return { status: "safe", balanceWei: undefined, balanceCelo: 0, approxSavesLeft: null };
  }

  // Per-call overrides (e.g. MARKOV / Arena) win over env, which wins
  // over the score-game defaults. Bad inputs fall back gracefully so a
  // typo in env can't NaN-out the gate.
  const warnFromOpts = opts.warnFloorCelo != null && opts.warnFloorCelo > 0
    ? parseEther(String(opts.warnFloorCelo) as `${number}`)
    : null;
  const blockFromOpts = opts.blockFloorCelo != null && opts.blockFloorCelo > 0
    ? parseEther(String(opts.blockFloorCelo) as `${number}`)
    : null;
  const warnFloor = warnFromOpts ?? envFloor("NEXT_PUBLIC_GAS_WARN_CELO", WARN_DEFAULT);
  const blockFloor = blockFromOpts ?? envFloor("NEXT_PUBLIC_GAS_BLOCK_CELO", BLOCK_DEFAULT);
  // Tighten ordering so misconfigured envs (warn < block) can't invert
  // the meaning. block always ≤ warn.
  const block = blockFloor < warnFloor ? blockFloor : warnFloor;
  const warn = warnFloor;

  let status: GasBucket;
  if (wei < block) status = "block";
  else if (wei < warn) status = "warn";
  else status = "safe";

  const celoNum = Number(formatEther(wei));
  // Saves remaining estimate uses the conservative per-submit constant so
  // we under-promise. Real average for score games is ~0.012 CELO but we
  // plan against the max (0.025) so "3 saves left" means 3+. MARKOV callers
  // pass a bigger perTxCelo (~0.12) so the same display reads as
  // "match attempts left" instead of "saves left".
  const perTx = opts.perTxCelo != null && opts.perTxCelo > 0
    ? opts.perTxCelo
    : PER_SUBMIT_SAFE_CELO;
  const approxSavesLeft = Math.max(0, Math.floor(celoNum / perTx));

  return { status, balanceWei: wei, balanceCelo: celoNum, approxSavesLeft };
}
