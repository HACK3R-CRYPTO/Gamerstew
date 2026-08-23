"use client";

import { useCallback } from "react";
import { parseSignature, parseEventLogs, keccak256, stringToHex } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { ATTRIBUTION_SUFFIX } from "@/lib/attribution";
import { CONTRACT_ADDRESSES, detectFeeSpread } from "@/lib/contracts";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { DUEL_ESCROW_ADDRESS, DUEL_ESCROW_ABI, ZERO_BYTES32 } from "@/lib/duel";

const G_TOKEN = CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`;
const CELO_CHAIN_ID = 42220;

const permitNonceAbi = [
  { type: "function", stateMutability: "view", name: "nonces", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function isUserRejection(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? "";
  return /reject|denied|cancel/i.test(m);
}

export type CreateRoomInput = {
  gameType: number;      // on-chain representative game (first of `games`)
  games?: number[];      // full set of games players can compete in (off-chain)
  stakeWei: bigint;      // per-participant entry (0 = free)
  seedWei: bigint;       // creator-seeded prize (0 = none)
  feeBps: number;        // 0 for community pools
  capacity: number;
  deadlineSec: bigint;   // unix seconds
  code?: string;         // private join-code (empty = no code)
  useAllowlist?: boolean;
  targetScore?: bigint;
};

export function useDuel() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const isMiniPay = useIsMiniPay();

  // Sign an EIP-2612 permit authorizing DuelEscrow to pull `value` of G$.
  const signPermit = useCallback(async (value: bigint) => {
    if (!address || !publicClient) throw new Error("WALLET_NOT_READY");
    const nonce = await publicClient.readContract({
      address: G_TOKEN, abi: permitNonceAbi, functionName: "nonces", args: [address],
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    let signature: `0x${string}`;
    try {
      signature = await signTypedDataAsync({
        domain: { name: "GoodDollar", version: "1", chainId: CELO_CHAIN_ID, verifyingContract: G_TOKEN },
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
        message: { owner: address, spender: DUEL_ESCROW_ADDRESS, value, nonce: nonce as bigint, deadline },
      });
    } catch (e) {
      throw new Error(isUserRejection(e) ? "USER_REJECTED" : "SIGN_FAILED");
    }
    const { v, r, s } = parseSignature(signature);
    return { value, deadline, v: Number(v), r, s } as const;
  }, [address, publicClient, signTypedDataAsync]);

  // Mirror the room into the backend so the hub/detail reflect it fast. Carries
  // the off-chain `games` set (the contract only stores one representative game).
  const sync = useCallback(async (id: number, games?: number[]) => {
    try {
      await fetch(`/api/duel/sync/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ games: games && games.length ? games : undefined }),
      });
    } catch { /* best-effort */ }
  }, []);

  // ── Create a room (pool or duel) ──────────────────────────────────────────
  const createRoom = useCallback(async (input: CreateRoomInput): Promise<number> => {
    if (!address || !publicClient) throw new Error("WALLET_NOT_READY");
    const joinCodeHash = input.code && input.code.length > 0
      ? keccak256(stringToHex(input.code)) : ZERO_BYTES32;
    const params = {
      gameType: input.gameType,
      stake: input.stakeWei,
      seed: input.seedWei,
      feeBps: input.feeBps,
      capacity: input.capacity,
      deadline: input.deadlineSec,
      joinCodeHash,
      useAllowlist: !!input.useAllowlist,
      targetScore: input.targetScore ?? 0n,
    } as const;

    const upfront = input.stakeWei + input.seedWei;
    const permit = await signPermit(upfront); // one sig, no separate approve tx
    const feeSpread = await detectFeeSpread(isMiniPay, address);
    const hash = await writeContractAsync({
      dataSuffix: ATTRIBUTION_SUFFIX,
      address: DUEL_ESCROW_ADDRESS, abi: DUEL_ESCROW_ABI,
      functionName: "createRoomWithPermit",
      args: [params, permit],
      ...feeSpread,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: DUEL_ESCROW_ABI, logs: receipt.logs, eventName: "RoomCreated" });
    const id = Number((ev as { args: { id: bigint } }).args.id);
    await sync(id, input.games && input.games.length ? input.games : [input.gameType]);
    return id;
  }, [address, publicClient, signPermit, writeContractAsync, isMiniPay, sync]);

  // ── Join a room ────────────────────────────────────────────────────────────
  const joinRoom = useCallback(async (id: number, code: string, stakeWei: bigint): Promise<void> => {
    if (!address || !publicClient) throw new Error("WALLET_NOT_READY");
    const feeSpread = await detectFeeSpread(isMiniPay, address);
    let hash: `0x${string}`;
    if (stakeWei > 0n) {
      const permit = await signPermit(stakeWei);
      hash = await writeContractAsync({
        dataSuffix: ATTRIBUTION_SUFFIX,
        address: DUEL_ESCROW_ADDRESS, abi: DUEL_ESCROW_ABI,
        functionName: "joinRoomWithPermit",
        args: [BigInt(id), code, permit],
        ...feeSpread,
      });
    } else {
      // Free entry (pool): no G$ moves, no permit needed.
      hash = await writeContractAsync({
        dataSuffix: ATTRIBUTION_SUFFIX,
        address: DUEL_ESCROW_ADDRESS, abi: DUEL_ESCROW_ABI,
        functionName: "joinRoom",
        args: [BigInt(id), code],
        ...feeSpread,
      });
    }
    await publicClient.waitForTransactionReceipt({ hash });
    await sync(id);
  }, [address, publicClient, signPermit, writeContractAsync, isMiniPay, sync]);

  // ── Admin: add the voted+verified wallets to a room's allowlist ────────────
  const addToAllowlist = useCallback(async (id: number, wallets: `0x${string}`[]): Promise<void> => {
    if (!address || !publicClient) throw new Error("WALLET_NOT_READY");
    const feeSpread = await detectFeeSpread(isMiniPay, address);
    const hash = await writeContractAsync({
      dataSuffix: ATTRIBUTION_SUFFIX,
      address: DUEL_ESCROW_ADDRESS, abi: DUEL_ESCROW_ABI,
      functionName: "addToAllowlist",
      args: [BigInt(id), wallets],
      ...feeSpread,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }, [address, publicClient, writeContractAsync, isMiniPay]);

  return { createRoom, joinRoom, addToAllowlist };
}
