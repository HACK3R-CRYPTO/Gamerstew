"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES, detectFeeSpread } from "@/lib/contracts";
import { habitatRegistryAbi, erc20Abi } from "@/lib/abis/habitatRegistry";
import { HABITATS, FIRST_PAID_TIER, getHabitat, defaultEquipped, freeTierForLevel, type HabitatTier } from "@/lib/habitats";
import { useIsMiniPay } from "@/hooks/useMiniPay";

// Equipped tier preference is per-wallet. localStorage acts as a fast cache
// for instant UI; backend `/api/habitat` is the source of truth so the
// choice travels across devices and shows on third-party reads (leaderboard,
// share cards, dashboards).
function equippedKey(addr?: `0x${string}`) {
  return addr ? `gamearena:habitat:equipped:${addr.toLowerCase()}` : null;
}

// Custom event broadcast on equip so every useHabitats instance in the tree
// (PetSlot, HabitatsPanel, ShareCard) re-reads localStorage and updates in
// sync. localStorage's native `storage` event only fires across tabs, not
// within the same tab, so we broadcast our own for in-tab subscribers.
const EQUIP_EVENT = "gamearena:habitat:equipped:changed";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// Single source of truth for habitat state on the client.
// Reads owned paid tiers, donation totals, and exposes the unlock flow.
export function useHabitats(playerLevel: number = 1) {
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Batch read ownership for every paid tier in one RPC round-trip.
  const paidTiers = useMemo(() => HABITATS.filter(h => h.type === "paid"), []);

  const ownsContracts = useMemo(() => {
    if (!address) return [];
    return paidTiers.map(tier => ({
      address: CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`,
      abi: habitatRegistryAbi,
      functionName: "ownsHabitat" as const,
      args: [address, tier.id] as const,
    }));
  }, [address, paidTiers]);

  const { data: ownsData, refetch: refetchOwned } = useReadContracts({
    contracts: ownsContracts,
    query: { enabled: !!address && ownsContracts.length > 0, refetchInterval: 30_000 },
  });

  // Donation total (UBI portion only, matches what the contract tracks).
  const { data: ubiDonatedRaw, refetch: refetchDonation } = useReadContract({
    address: CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`,
    abi: habitatRegistryAbi,
    functionName: "playerUbiDonated",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  // G$ balance + current allowance for the registry. Drives the approve
  // step in the unlock flow and the "insufficient balance" guard in the UI.
  const { data: gBalanceRaw, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  // Decoded ownership map: tierId → boolean.
  const ownedPaidTierIds = useMemo<number[]>(() => {
    if (!ownsData) return [];
    const owned: number[] = [];
    ownsData.forEach((res, i) => {
      if (res.status === "success" && res.result === true) owned.push(paidTiers[i].id);
    });
    return owned;
  }, [ownsData, paidTiers]);

  // ── Equipped tier (player choice, per wallet) ────────────────────────────
  // Stored in localStorage so the choice persists. Falls back to highest
  // owned paid tier, otherwise highest free tier for level.
  const [equippedId, setEquippedIdState] = useState<number | null>(null);

  // Hydrate from localStorage on mount / address change for instant UI,
  // then refresh from backend so the choice picks up cross-device changes.
  // Listen for the EQUIP_EVENT so changes from any component instantly
  // reflect everywhere in the tree.
  useEffect(() => {
    const key = equippedKey(address);
    const syncFromLocal = () => {
      if (!key) { setEquippedIdState(null); return; }
      const raw = window.localStorage.getItem(key);
      setEquippedIdState(raw ? Number(raw) : null);
    };
    syncFromLocal();
    window.addEventListener(EQUIP_EVENT, syncFromLocal);

    // Background refresh from backend (canonical). If it differs, write to
    // localStorage and broadcast so all in-tab listeners pick it up.
    let cancelled = false;
    if (address && key) {
      (async () => {
        try {
          const r = await fetch(`${BACKEND_URL}/api/habitat/${address}`);
          if (!r.ok) return;
          const data = await r.json();
          if (cancelled) return;
          const tierId = typeof data.equipped === "number" ? data.equipped : null;
          if (tierId == null) return;
          const cached = window.localStorage.getItem(key);
          if (cached !== String(tierId)) {
            window.localStorage.setItem(key, String(tierId));
            window.dispatchEvent(new Event(EQUIP_EVENT));
          }
        } catch { /* offline / backend down — keep local choice */ }
      })();
    }
    return () => {
      cancelled = true;
      window.removeEventListener(EQUIP_EVENT, syncFromLocal);
    };
  }, [address]);

  // Resolve the actual equipped HabitatTier object. If the saved id is no
  // longer valid (player no longer owns it, or tier was removed), fall
  // through to the default.
  const equipped = useMemo<HabitatTier>(() => {
    if (equippedId != null) {
      const saved = getHabitat(equippedId);
      if (saved) {
        // Valid only if the player can actually display this tier
        if (saved.type === "paid" && ownedPaidTierIds.includes(saved.id)) return saved;
        if (saved.type === "free" && playerLevel >= (saved.unlockLevel ?? 1)) return saved;
      }
    }
    return defaultEquipped(playerLevel, ownedPaidTierIds);
  }, [equippedId, ownedPaidTierIds, playerLevel]);

  // Public setter — validates ownership before persisting. Returns false
  // if the player can't equip this tier (not unlocked).
  // Optimistic: updates localStorage + dispatches event immediately for
  // instant UI, then fires the backend POST in the background so the
  // choice persists across devices.
  const equipHabitat = useCallback((tierId: number): boolean => {
    const tier = getHabitat(tierId);
    if (!tier) return false;
    const ownsIt = tier.type === "paid"
      ? ownedPaidTierIds.includes(tier.id)
      : playerLevel >= (tier.unlockLevel ?? 1);
    if (!ownsIt) return false;
    const key = equippedKey(address);
    if (key) window.localStorage.setItem(key, String(tierId));
    setEquippedIdState(tierId);
    // Broadcast so every other useHabitats instance re-reads.
    window.dispatchEvent(new Event(EQUIP_EVENT));
    // Persist to backend (fire-and-forget). Failures are non-fatal —
    // localStorage still has the choice for this device.
    if (address) {
      fetch(`${BACKEND_URL}/api/habitat/equip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, tier: tierId }),
      }).catch(() => { /* offline / backend down */ });
    }
    return true;
  }, [address, ownedPaidTierIds, playerLevel]);

  const ubiDonated = (ubiDonatedRaw as bigint | undefined) ?? 0n;
  const gBalance   = (gBalanceRaw as bigint | undefined) ?? 0n;
  const allowance  = (allowanceRaw as bigint | undefined) ?? 0n;

  // ── Unlock flow ───────────────────────────────────────────────────────────
  // Two-step: ensure allowance ≥ tier cost, then call unlockHabitat.
  //
  // CRITICAL: writeContractAsync resolves when the tx is *submitted*, not
  // when it's *mined*. If we refetch ownership immediately we read the OLD
  // chain state and the UI says "still locked" even though the user paid.
  // We waitForTransactionReceipt on each tx, then poll the ownership read
  // until it flips, so the UI never shows a phantom-locked state.
  const unlock = useCallback(async (tier: HabitatTier) => {
    if (!address)             throw new Error("Wallet not connected");
    if (!publicClient)        throw new Error("RPC client not ready");
    if (tier.type !== "paid") throw new Error("Tier is free, no unlock needed");
    if (!tier.costG$)         throw new Error("Tier has no cost configured");
    if (gBalance < tier.costG$) throw new Error("Insufficient G$ balance");

    // Step 1: approve if allowance too low. Wait for receipt before moving on.
    if (allowance < tier.costG$) {
      const approveHash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`, tier.costG$],
        ...(await detectFeeSpread(isMiniPay, address)),
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      await refetchAllowance();
    }

    // Step 2: call unlockHabitat. Wait for the tx to actually mine.
    const txHash = await writeContractAsync({
      address: CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`,
      abi: habitatRegistryAbi,
      functionName: "unlockHabitat",
      args: [tier.id],
      ...(await detectFeeSpread(isMiniPay, address)),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("Unlock transaction reverted on-chain");
    }

    // Step 3: poll ownership until the chain returns true. Some RPC nodes
    // are slightly behind the canonical state for a few seconds even after
    // the receipt is confirmed; refetching alone can race that lag.
    for (let attempt = 0; attempt < 8; attempt++) {
      const owned = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.HABITAT_REGISTRY as `0x${string}`,
        abi: habitatRegistryAbi,
        functionName: "ownsHabitat",
        args: [address, tier.id],
      });
      if (owned === true) break;
      await new Promise(r => setTimeout(r, 800));
    }

    // Final refresh so wagmi's cached reads pick up the new state.
    await Promise.all([refetchOwned(), refetchDonation(), refetchBalance(), refetchAllowance()]);
    return txHash;
  }, [address, publicClient, gBalance, allowance, isMiniPay, writeContractAsync, refetchOwned, refetchDonation, refetchBalance, refetchAllowance]);

  return {
    equipped,
    equipHabitat,
    ownedPaidTierIds,
    ubiDonated,
    gBalance,
    allowance,
    unlock,
    refetch: () => Promise.all([refetchOwned(), refetchDonation(), refetchBalance(), refetchAllowance()]),
    FIRST_PAID_TIER,
  };
}
