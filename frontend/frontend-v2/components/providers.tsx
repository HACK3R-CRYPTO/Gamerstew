'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { celo } from 'viem/chains';
import { wagmiConfig, supportedChains } from '@/lib/wagmiConfig';
import { Toaster } from 'react-hot-toast';
import { SelfVerificationProvider } from '@/contexts/SelfVerificationContext';
import MiniPayConnector from '@/components/MiniPayConnector';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 60 * 1000,
    },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#7b2ff7',
          logo: '/logo.png',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        defaultChain: supportedChains[0],
        supportedChains: [...supportedChains],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <MiniPayConnector />
          <SelfVerificationProvider>
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: 'rgba(13,13,25,0.9)',
                  border: '1px solid rgba(0,212,255,0.1)',
                  color: '#fff',
                  fontFamily: 'Orbitron, sans-serif',
                },
              }}
            />
            {children}
          </SelfVerificationProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
