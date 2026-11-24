// The room stakes' one connection to the chain: the G$ token itself. There is
// no contract of ours here. A player's permit lets this server's wallet move one
// entry of their G$; `collect` uses it to send that entry from the loser to the
// winner. Nothing is ever held in between.
import { Signature, verifyTypedData } from 'ethers';
import type { Permit, StakePay } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The G$ token, with this server's wallet as the signer. */
export interface TokenLike {
  nonces(owner: string): Promise<bigint>;
  balanceOf(owner: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  permit(owner: string, spender: string, value: bigint, deadline: bigint, v: number, r: string, s: string): Promise<{ hash: string; wait(): Promise<any> }>;
  transferFrom(from: string, to: string, value: bigint): Promise<{ hash: string; wait(): Promise<any> }>;
}
export const TOKEN_ABI = [
  'function nonces(address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)', 'function transferFrom(address,address,uint256) returns (bool)',
];
const PERMIT_TYPES = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };

export function tokenStakePay(deps: {
  token: TokenLike; tokenAddress: string; tokenName: string; tokenVersion: string; chainId: number;
  /** this server's wallet: who the permits are made out to */
  spender: string;
  /** where the fee goes */
  treasury: string;
  /** every write from this wallet goes through one queue, so two never clash */
  serialize?: <T>(fn: () => Promise<T>) => Promise<T>;
  isVerified?: (wallet: string) => Promise<boolean>;
}): StakePay {
  const serialize = deps.serialize ?? (<T>(fn: () => Promise<T>) => fn());
  const domain = { name: deps.tokenName, version: deps.tokenVersion, chainId: deps.chainId, verifyingContract: deps.tokenAddress };
  return {
    async check(p: Permit) {
      // The token only accepts a permit signed over the owner's CURRENT nonce, so
      // checking against that nonce also proves the permit has not been used.
      const nonce = await deps.token.nonces(p.owner);
      let signer: string;
      try { signer = verifyTypedData(domain, PERMIT_TYPES, { owner: p.owner, spender: deps.spender, value: p.value, nonce, deadline: p.deadline }, Signature.from({ v: p.v, r: p.r, s: p.s })); }
      catch { return { ok: false, why: 'That signature could not be read' }; }
      if (signer.toLowerCase() !== p.owner) return { ok: false, why: 'That permit was not signed by this wallet, or has been used' };
      if ((await deps.token.balanceOf(p.owner)) < BigInt(p.value)) return { ok: false, why: 'That wallet does not hold the entry' };
      return { ok: true };
    },
    collect: (p: Permit, winner: string, winnerWei: string, feeWei: string) => serialize(async () => {
      const toWinner = BigInt(winnerWei); const fee = BigInt(feeWei); const total = toWinner + fee;
      let allowance = await deps.token.allowance(p.owner, deps.spender);
      // Look before using the permit: if the wallet has been emptied, the permit is
      // left unused to run out, and no allowance is left standing against it.
      if (allowance === 0n && (await deps.token.balanceOf(p.owner)) < total) return { ok: false as const, why: 'The wallet no longer holds the entry' };
      if (allowance < total) {
        // Turn the signature into an allowance of exactly one entry. If that has
        // been done already (an earlier try), the allowance below says so.
        try { const tx = await deps.token.permit(p.owner, deps.spender, BigInt(p.value), BigInt(p.deadline), p.v, p.r, p.s); await tx.wait(); } catch { /* read the allowance to find out */ }
        allowance = await deps.token.allowance(p.owner, deps.spender);
      }
      // An earlier try paid the winner and stopped before the fee: only the fee is left to take.
      if (allowance < total && fee > 0n && allowance === fee) {
        try { const tx = await deps.token.transferFrom(p.owner, deps.treasury, fee); await tx.wait(); } catch { /* the fee is ours to lose */ }
        return { ok: true as const, tx: '' };
      }
      if (allowance < total) return { ok: false as const, why: 'The permit could not be used' };
      if ((await deps.token.balanceOf(p.owner)) < total) return { ok: false as const, why: 'The wallet no longer holds the entry' };
      const paid = await deps.token.transferFrom(p.owner, winner, toWinner);
      await paid.wait();
      if (fee > 0n) { try { const tx = await deps.token.transferFrom(p.owner, deps.treasury, fee); await tx.wait(); } catch { /* the winner is paid; the fee is ours to lose */ } }
      return { ok: true as const, tx: paid.hash };
    }),
    ...(deps.isVerified ? { allowed: (wallet: string) => deps.isVerified!(wallet) } : {}),
  };
}
