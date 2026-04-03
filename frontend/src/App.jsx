import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDisconnect } from 'wagmi';
import { config, supportedChains } from './config/wagmi';
import { Toaster } from 'react-hot-toast';
import { SelfVerificationProvider } from './contexts/SelfVerificationContext';

import Navigation from './components/Navigation';
import ArenaGame from './pages/ArenaGame';
import RhythmRush from './pages/RhythmRush';
import SimonGame from './pages/SimonGame';
import Leaderboard from './pages/Leaderboard';
import GamesHub from './pages/GamesHub';
import LandingOverlay from './components/LandingOverlay';
import GamePassGate from './components/GamePassGate';

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

// Ensures the embedded wallet is always the active wagmi wallet for email/social logins,
// and clears wagmi connector state on logout so Rabby doesn't auto-reconnect.
function WalletManager() {
  const { authenticated } = usePrivy();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    if (!authenticated) {
      disconnect();
    }
    // Do NOT override active wallet — Privy uses whichever wallet the user connected with
  }, [authenticated]);

  return null;
}

function App() {
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splashSeen'));

  return (
    <PrivyProvider
      appId="cmg7w1zms013ik00cq19vflf7"
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#7b2ff7',
          logo: '/logo.png',
          showWalletLoginFirst: false,
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        defaultChain: supportedChains[0],
        supportedChains,
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users', // always create embedded wallet, even if injected wallet exists
          },
        },
        walletChainType: 'ethereum-only',
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <WalletManager />
          <SelfVerificationProvider>
            <Toaster position="top-right" toastOptions={{
              style: {
                background: 'rgba(13, 13, 25, 0.9)',
                border: '1px solid rgba(0, 212, 255, 0.1)',
                color: '#fff',
                fontFamily: 'Orbitron, sans-serif',
              },
            }} />

            {showSplash && (
              <LandingOverlay onEnter={() => { sessionStorage.setItem('splashSeen', '1'); setShowSplash(false); }} />
            )}

            <Router>
              <div className="min-h-screen relative bg-[#050505] text-gray-200 selection:bg-purple-500/30">
                <Navigation />
                <div className="relative z-10 pt-24 px-4 pb-12 max-w-[1000px] mx-auto">
                  <div className={`${showSplash ? 'blur-sm opacity-50 grayscale' : 'blur-0 opacity-100 grayscale-0'} transition-all duration-1000`}>
                    <Routes>
                      <Route path="/" element={<GamesHub />} />
                      <Route path="/rhythm" element={<GamePassGate><RhythmRush /></GamePassGate>} />
                      <Route path="/games" element={<Navigate to="/" replace />} />
                      <Route path="/simon" element={<GamePassGate><SimonGame /></GamePassGate>} />
                      <Route path="/leaderboard" element={<Leaderboard />} />
                      <Route path="/arena" element={<GamePassGate><ArenaGame /></GamePassGate>} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </div>
                </div>
              </div>
            </Router>
          </SelfVerificationProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

export default App;
