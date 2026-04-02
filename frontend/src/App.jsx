import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './config/wagmi';
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
      staleTime: 60 * 1000, // Important: keep data fresh for 60s
    },
  },
});

function App() {
  // Show splash only once per session
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('splashSeen'));

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SelfVerificationProvider>
          <Toaster position="top-right" toastOptions={{
            style: {
              background: 'rgba(13, 13, 25, 0.9)',
              border: '1px solid rgba(0, 212, 255, 0.1)',
              color: '#fff',
              fontFamily: 'Orbitron, sans-serif',
            },
          }} />

          {/* Splash Screen Overlay */}
          {showSplash && (
            <LandingOverlay onEnter={() => { sessionStorage.setItem('splashSeen', '1'); setShowSplash(false); }} />
          )}

          <Router>
            <div className="min-h-screen relative bg-[#050505] text-gray-200 selection:bg-purple-500/30">
              {/* Navigation is hidden while splash is active, or we can leave it behind */}
              <Navigation />

              <div className="relative z-10 pt-24 px-4 pb-12 max-w-[1000px] mx-auto">
                {/* Main Content (blur it when splash is active?) */}
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
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
