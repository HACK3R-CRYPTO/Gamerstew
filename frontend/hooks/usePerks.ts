"use client";

import { useCallback, useMemo } from "react";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES, detectFeeSpread } from "@/lib/contracts";
import { perkShopAbi } from "@/lib/abis/perkShop";
import { erc20Abi } from "@/lib/abis/habitatRegistry";
import { PERKS, COSMETIC_PERK_IDS, type Perk } from "@/lib/perks";
import { useIsMiniPay } from "@/hooks/useMiniPay";

const PERK_SHOP = CONTRACT_ADDRESSES.PERK_SHOP as `0x${string}`;
const G_TOKEN = CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`;

// Single source of truth for PerkShop state on the client. Mirrors
// useHabitats: reads G$ balance + allowance for the shop, cosmetic ownership,
// and the player's UBI contribution; exposes buyPerk (approve → buy → confirm).
export function usePerks() {
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // G$ balance — gates "can afford" in the UI.
  const { data: gBalanceRaw, refetch: refetchBalance } = useReadContract({
    address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // Allowance granted to the shop — drives whether the buy needs an approve.
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: G_TOKEN, abi: erc20Abi, functionName: "allowance",
    args: address ? [address, PERK_SHOP] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  // Per-player UBI contributed through perks (for the "you gave X to UBI" line).
  const { data: ubiContributedRaw, refetch: refetchUbi } = useReadContract({
    address: PERK_SHOP, abi: perkShopAbi, functionName: "playerUbiContributed",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  // Whole-community UBI pool contributed through perks — the judge-facing
  // number, and the proof the split is real (matches Celoscan).
  const { data: totalCommunityRaw, refetch: refetchTotal } = useReadContract({
    address: PERK_SHOP, abi: perkShopAbi, functionName: "totalCommunityContribution",
    query: { refetchInterval: 30_000 },
  });

  // Cosmetic ownership, batched in one round-trip.
  const cosmeticContracts = useMemo(() => {
    if (!address) return [];
    return COSMETIC_PERK_IDS.map(id => ({
      address: PERK_SHOP, abi: perkShopAbi, functionName: "ownsCosmetic" as const,
      args: [address, id] as const,
    }));
  }, [address]);

  const { data: cosmeticData, refetch: refetchCosmetics } = useReadContracts({
    contracts: cosmeticContracts,
    query: { enabled: !!address && cosmeticContracts.length > 0, refetchInterval: 30_000 },
  });

  const ownedCosmeticIds = useMemo<number[]>(() => {
    if (!cosmeticData) return [];
    const owned: number[] = [];
    cosmeticData.forEach((res, i) => {
      if (res.status === "success" && res.result === true) owned.push(COSMETIC_PERK_IDS[i]);
    });
    return owned;
  }, [cosmeticData]);

  const gBalance = (gBalanceRaw as bigint | undefined) ?? 0n;
  const allowance = (allowanceRaw as bigint | undefined) ?? 0n;
  const ubiContributed = (ubiContributedRaw as bigint | undefined) ?? 0n;
  const totalCommunity = (totalCommunityRaw as bigint | undefined) ?? 0n;

  const ownsCosmetic = useCallback(
    (perkId: number) => ownedCosmeticIds.includes(perkId),
    [ownedCosmeticIds],
  );

  // ── Buy flow ──────────────────────────────────────────────────────────────
  // Two-step: ensure allowance ≥ price, then buyPerk. writeContractAsync
  // resolves on SUBMIT, not on mine — so we waitForTransactionReceipt on each
  // tx and, for cosmetics, poll ownership until the chain flips (RPC lag).
  // Same shape as useHabitats.unlock so the two flows behave identically.
  const buyPerk = useCallback(async (perk: Perk): Promise<`0x${string}`> => {
    if (!address)      throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("RPC client not ready");
    if (gBalance < perk.priceG$) throw new Error("Insufficient G$ balance");
    if (perk.kind === "cosmetic" && ownsCosmetic(perk.id)) {
      throw new Error("You already own this");
    }

    // Step 1: approve if the shop can't yet pull this much G$.
    if (allowance < perk.priceG$) {
      const approveHash = await writeContractAsync({
        dataSuffix: ATTRIBUTION_SUFFIX,
        address: G_TOKEN, abi: erc20Abi, functionName: "approve",
        args: [PERK_SHOP, perk.priceG$],
        ...(await detectFeeSpread(isMiniPay, address)),
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      await refetchAllowance();
    }

    // Step 2: buyPerk. Wait for the tx to actually mine.
    const txHash = await writeContractAsync({
      dataSuffix: ATTRIBUTION_SUFFIX,
      address: PERK_SHOP, abi: perkShopAbi, functionName: "buyPerk",
      args: [perk.id],
      ...(await detectFeeSpread(isMiniPay, address)),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("Purchase reverted on-chain");

    // Step 3: for cosmetics, poll ownership until the RPC catches up.
    if (perk.kind === "cosmetic") {
      for (let attempt = 0; attempt < 8; attempt++) {
        const owned = await publicClient.readContract({
          address: PERK_SHOP, abi: perkShopAbi, functionName: "ownsCosmetic",
          args: [address, perk.id],
        });
        if (owned === true) break;
        await new Promise(r => setTimeout(r, 800));
      }
    }

    await Promise.all([refetchBalance(), refetchAllowance(), refetchUbi(), refetchTotal(), refetchCosmetics()]);
    return txHash;
  }, [address, publicClient, gBalance, allowance, isMiniPay, ownsCosmetic,
      writeContractAsync, refetchBalance, refetchAllowance, refetchUbi, refetchTotal, refetchCosmetics]);

  return {
    perks: PERKS,
    gBalance,
    allowance,
    ubiContributed,
    totalCommunity,
    ownedCosmeticIds,
    ownsCosmetic,
    buyPerk,
    refetch: () => Promise.all([refetchBalance(), refetchAllowance(), refetchUbi(), refetchTotal(), refetchCosmetics()]),
  };
}
