'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
          logo: '/components/game_arena_text.png',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'wallet', 'google'],
        defaultChain: supportedChains[0],
        supportedChains: [...supportedChains],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users',
          },
          showWalletUIs: false,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <MiniPayConnector />
          <SelfVerificationProvider>
            <Toaster
              position="top-center"
              toastOptions={{
                style: {
                  background: 'rgba(20,8,60,0.95)',
                  border: '1px solid rgba(140,80,255,0.3)',
                  color: '#fff',
                  fontFamily: 'Melon Pop, sans-serif',
                  fontSize: '13px',
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
