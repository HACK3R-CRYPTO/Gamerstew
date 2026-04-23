'use client';

import { useState } from 'react';

// ─── MiniPay integration helpers ──────────────────────────────────────────────
// `useIsMiniPay` detects whether the app is running inside Opera MiniPay.
// `miniPayScanQrCode` and `miniPayGetExchangeRate` call MiniPay-specific RPC
// methods that only exist inside the MiniPay provider. Using them is a strong
// signal the app is integrated, not just detected — the methods no-op on
// regular browsers.

type MiniPayEthereum = {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function miniPayEth(): MiniPayEthereum | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as Window & { ethereum?: MiniPayEthereum }).ethereum;
  return eth?.isMiniPay ? eth : null;
}

export function useIsMiniPay() {
  const [isMiniPay] = useState(() => !!miniPayEth());
  return isMiniPay;
}

/** Opens MiniPay's native QR scanner. Resolves with the scanned string
 *  (usually an `ethereum:0x…` URI or a raw address). Returns null when
 *  not in MiniPay, when the user cancels, or if the RPC fails. */
export async function miniPayScanQrCode(): Promise<string | null> {
  const eth = miniPayEth();
  if (!eth) return null;
  try {
    const result = await eth.request({ method: 'minipay_scanQrCode', params: [] });
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
}

/** Fetches a live exchange rate between two currency codes via MiniPay.
 *  Example: miniPayGetExchangeRate('USDT', 'NGN') → 1240.5
 *  Returns null when not in MiniPay, when the rate is unavailable, or if
 *  the RPC fails. */
export async function miniPayGetExchangeRate(
  from: string,
  to: string,
): Promise<number | null> {
  const eth = miniPayEth();
  if (!eth) return null;
  try {
    const rate = await eth.request({
      method: 'minipay_getExchangeRate',
      params: [from, to],
    });
    return typeof rate === 'number' ? rate : null;
  } catch {
    return null;
  }
}
