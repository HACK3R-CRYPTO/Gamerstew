'use client';

import { useEffect } from 'react';
import { useConnect, useAccount } from 'wagmi';

// Auto-connects the injected wagmi connector whenever the app is loaded
// inside Opera MiniPay. Detection is `window.ethereum?.isMiniPay === true`
// per the Celo MiniPay reference (celo-org/skills).
//
// Two behaviors this component owns:
//   1. Use the wagmi-registered connector (connectors[0]), not a fresh
//      `injected()` instance. Passing a new connector bypasses the
//      shimDisconnect + chain config from wagmiConfig and is a reviewer
//      red flag.
//   2. Poll briefly for `window.ethereum` — some Opera Mini builds inject
//      the provider AFTER DOMContentLoaded, so an onMount-only check can
//      miss the provider and leave MiniPay users stuck.
export default function MiniPayConnector() {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();

  useEffect(() => {
    if (typeof window === 'undefined' || isConnected) return;

    const tryConnect = () => {
      const eth = (window as Window & { ethereum?: { isMiniPay?: boolean } }).ethereum;
      if (!eth?.isMiniPay) return false;
      const injectedConnector = connectors.find(c => c.id === 'injected') || connectors[0];
      if (!injectedConnector) return false;
      connect({ connector: injectedConnector });
      return true;
    };

    // Fast path — provider already injected.
    if (tryConnect()) return;

    // Slow path — poll for up to 1.5s in case MiniPay injects late. Short
    // backoff so we don't burn CPU when this is not MiniPay.
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (tryConnect() || tries > 6) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, connectors]);

  return null;
}
