"use client";

import { useCallback, useMemo } from "react";
import { parseSignature } from "viem";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSignTypedData, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES, detectFeeSpread } from "@/lib/contracts";
import { perkShopAbi } from "@/lib/abis/perkShop";
import { erc20Abi } from "@/lib/abis/habitatRegistry";
import { PERKS, COSMETIC_PERK_IDS, type Perk } from "@/lib/perks";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { buyPerkGasless } from "@/app/actions/perks";

// Minimal G$ permit ABI — just the nonce read for EIP-2612 signing.
const permitNonceAbi = [
  { type: "function", stateMutability: "view", name: "nonces", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function isUserRejection(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /reject|denied|cancell?ed|4001/.test(msg);
}

const PERK_SHOP = CONTRACT_ADDRESSES.PERK_SHOP as `0x${string}`;
const G_TOKEN = CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`;

// Single source of truth for PerkShop state on the client. Mirrors
// useHabitats: reads G$ balance + allowance for the shop, cosmetic ownership,
// and the player's UBI contribution; exposes buyPerk (approve → buy → confirm).
export function usePerks() {
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
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

  // Post-purchase bookkeeping shared by both buy paths: for cosmetics, poll
  // ownership until the RPC catches up, then refresh all reads.
  const settle = useCallback(async (perk: Perk) => {
    if (perk.kind === "cosmetic" && address && publicClient) {
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
  }, [address, publicClient, refetchBalance, refetchAllowance, refetchUbi, refetchTotal, refetchCosmetics]);

  // ── Gasless buy (preferred) ─────────────────────────────────────────────────
  // One EIP-2612 signature, zero CELO: the player signs a permit for PerkShop,
  // the backend relayer submits buyPerkWithPermit and pays the gas. Mirrors the
  // proven Challenge AI gasless refill. Throws USER_REJECTED if the player
  // cancels the signature, or RELAYER_DOWN so the caller can fall back.
  const buyPerkViaPermit = useCallback(async (perk: Perk): Promise<`0x${string}`> => {
    if (!address || !publicClient) throw new Error("RELAYER_DOWN");
    const nonce = await publicClient.readContract({
      address: G_TOKEN, abi: permitNonceAbi, functionName: "nonces", args: [address],
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    let signature: `0x${string}`;
    try {
      signature = await signTypedDataAsync({
        domain: { name: "GoodDollar", version: "1", chainId: 42220, verifyingContract: G_TOKEN },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner: address, spender: PERK_SHOP, value: perk.priceG$, nonce: nonce as bigint, deadline },
      });
    } catch (e) {
      throw new Error(isUserRejection(e) ? "USER_REJECTED" : "RELAYER_DOWN");
    }
    const { v, r, s } = parseSignature(signature);
    const res = await buyPerkGasless(address, {
      perkId: perk.id, deadline: deadline.toString(), v: Number(v), r, s,
    });
    if (!res.ok || !res.txHash) throw new Error("RELAYER_DOWN");
    await settle(perk);
    return res.txHash as `0x${string}`;
  }, [address, publicClient, signTypedDataAsync, settle]);

  // ── Fallback buy: approve + buyPerk (MiniPay, or when the relayer is down) ───
  const buyPerkDirect = useCallback(async (perk: Perk): Promise<`0x${string}`> => {
    if (!address || !publicClient) throw new Error("RPC client not ready");
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
    const txHash = await writeContractAsync({
      dataSuffix: ATTRIBUTION_SUFFIX,
      address: PERK_SHOP, abi: perkShopAbi, functionName: "buyPerk",
      args: [perk.id],
      ...(await detectFeeSpread(isMiniPay, address)),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("Purchase reverted on-chain");
    await settle(perk);
    return txHash;
  }, [address, publicClient, allowance, isMiniPay, writeContractAsync, refetchAllowance, settle]);

  // ── Buy flow ──────────────────────────────────────────────────────────────
  // Gasless-first for non-MiniPay (one signature, zero CELO); MiniPay pays gas
  // in stablecoin via approve + buyPerk. If the relayer is unavailable we fall
  // back to the direct path so a buy always completes; a user-cancelled
  // signature aborts instead of re-prompting.
  const buyPerk = useCallback(async (perk: Perk): Promise<`0x${string}`> => {
    if (!address)      throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("RPC client not ready");
    if (gBalance < perk.priceG$) throw new Error("Insufficient G$ balance");
    if (perk.kind === "cosmetic" && ownsCosmetic(perk.id)) {
      throw new Error("You already own this");
    }

    if (!isMiniPay) {
      try {
        return await buyPerkViaPermit(perk);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "USER_REJECTED") throw new Error("Purchase cancelled");
        // RELAYER_DOWN (or anything else) → fall back to the direct path.
      }
    }
    return await buyPerkDirect(perk);
  }, [address, publicClient, gBalance, isMiniPay, ownsCosmetic, buyPerkViaPermit, buyPerkDirect]);

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
