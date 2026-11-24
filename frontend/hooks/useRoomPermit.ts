"use client";

// Signing in to a room's G$ entry. This is a SIGNATURE, not a payment: it lets
// GameArena move one entry of your G$ for the next 45 minutes, and it is only
// ever used if you lose the round. Nothing leaves the wallet here.
import { useCallback } from "react";
import { parseSignature } from "viem";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

const G_TOKEN = CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`;
const CELO_CHAIN_ID = 42220;
const MINUTES = 45; // the server wants 20 to 60: long enough for the lobby and a round
const nonceAbi = [{ type: "function", stateMutability: "view", name: "nonces", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

export interface RoomPermit { owner: string; value: string; deadline: number; v: number; r: string; s: string }

export function useRoomPermit() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: CELO_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  /** Returns the permit, or a short reason it could not be signed. */
  const sign = useCallback(async (spender: string, valueWei: string): Promise<RoomPermit | { error: string }> => {
    // dev only: an automated check has no wallet, so it supplies its own stand-in signer
    const fake = process.env.NODE_ENV !== "production" ? (window as unknown as { __roomPermit?: (spender: string, valueWei: string) => RoomPermit }).__roomPermit : undefined;
    if (fake) return fake(spender, valueWei);
    if (!address || !publicClient) return { error: "Sign in to play for G$." };
    try {
      const nonce = await publicClient.readContract({ address: G_TOKEN, abi: nonceAbi, functionName: "nonces", args: [address] });
      const deadline = Math.floor(Date.now() / 1000) + MINUTES * 60;
      const signature = await signTypedDataAsync({
        domain: { name: "GoodDollar", version: "1", chainId: CELO_CHAIN_ID, verifyingContract: G_TOKEN },
        types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        primaryType: "Permit",
        message: { owner: address, spender: spender as `0x${string}`, value: BigInt(valueWei), nonce: nonce as bigint, deadline: BigInt(deadline) },
      });
      const { v, r, s, yParity } = parseSignature(signature);
      return { owner: address.toLowerCase(), value: valueWei, deadline, v: Number(v ?? (yParity ? 28n : 27n)), r, s };
    } catch (e) {
      const m = String((e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "");
      return { error: /reject|denied|cancel/i.test(m) ? "You cancelled the signature." : "Could not sign. Try again." };
    }
  }, [address, publicClient, signTypedDataAsync]);
  return { sign, canSign: !!address || (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && "__roomPermit" in window) };
}
