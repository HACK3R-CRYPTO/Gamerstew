'use client';

import { useEffect } from 'react';
import { useConnect, useAccount } from 'wagmi';
import { injected } from 'wagmi/connectors';

export default function MiniPayConnector() {
  const { connect } = useConnect();
  const { isConnected } = useAccount();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum?.isMiniPay && !isConnected) {
      connect({ connector: injected() });
    }
  }, []);

  return null;
}
