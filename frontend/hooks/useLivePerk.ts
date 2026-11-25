"use client";

// A shop item that is built in the app but only sold once the shop's owner has
// priced it on the contract. Until then this returns null and the game never
// shows the offer. The price shown and paid is the contract's, so the owner can
// set any price without an app release.

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { formatEther } from "viem";
import { celo } from "viem/chains";
import { perkShopAbi } from "@/lib/abis/perkShop";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { UPCOMING_PERKS, getPerk, type Perk } from "@/lib/perks";

export function useLivePerk(id: number): Perk | null {
  const base = useMemo(() => getPerk(id) ?? UPCOMING_PERKS.find((p) => p.id === id) ?? null, [id]);
  const { data } = useReadContract({
    address: CONTRACT_ADDRESSES.PERK_SHOP as `0x${string}`, abi: perkShopAbi, functionName: "perkPrice", args: [id], chainId: celo.id,
    query: { enabled: !!base, staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false },
  });
  return useMemo(() => {
    const price = typeof data === "bigint" ? data : 0n;
    if (!base || price <= 0n) return null;
    const whole = Number(formatEther(price));
    return { ...base, priceG$: price, priceLabel: `${Number.isInteger(whole) ? whole.toLocaleString() : whole.toFixed(2)} G$` };
  }, [base, data]);
}
