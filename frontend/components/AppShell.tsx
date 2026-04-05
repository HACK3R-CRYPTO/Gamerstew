'use client';

import { useState, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import Navigation from '@/components/Navigation';
import LandingOverlay from '@/components/LandingOverlay';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005';

function useLiveActivityToasts() {
  useEffect(() => {
    const poll = async () => {
      // Skip if tab is hidden — no wasted requests
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(`${BACKEND_URL}/api/activity`);
        if (!res.ok) return;
        const { activity } = await res.json();
        if (!activity?.length) return;

        const lastSeen = parseInt(localStorage.getItem('last_seen_activity') || '0');
        // All entries newer than last seen, newest-first
        const fresh = activity.filter((e: { timestamp: number }) => e.timestamp > lastSeen);
        if (!fresh.length) return;

        // Update last seen to the newest timestamp
        localStorage.setItem('last_seen_activity', String(fresh[0].timestamp));

        // Don't fire on first ever load
        if (lastSeen === 0) return;

        // Show up to 3 toasts so we don't spam
        fresh.slice(0, 3).reverse().forEach((e: { username?: string; player: string; score: number; game: string }) => {
          const name = e.username || `${e.player.slice(0, 6)}...${e.player.slice(-4)}`;
          const gameLabel = e.game === 'rhythm' ? 'Rhythm Rush' : 'Simon Memory';
          toast(`${name} scored ${e.score} on ${gameLabel}!`, {
            icon: '🎯',
            duration: 4000,
            style: { background: '#1a1a2e', color: '#fff', border: '1px solid rgba(168,85,247,0.3)', fontFamily: 'Orbitron, monospace', fontSize: '11px' },
          });
        });
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, []);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('splashSeen');
  });

  useLiveActivityToasts();

  return (
    <>
      <Toaster position="top-right" />
      {showSplash && (
        <LandingOverlay onEnter={() => {
          sessionStorage.setItem('splashSeen', '1');
          setShowSplash(false);
        }} />
      )}
      <div className="min-h-screen relative bg-[#050505] text-gray-200 selection:bg-purple-500/30">
        <Navigation />
        <div className={`relative z-10 pt-24 px-4 pb-12 max-w-[1000px] mx-auto transition-all duration-1000 ${showSplash ? 'blur-sm opacity-50 grayscale' : 'blur-0 opacity-100 grayscale-0'}`}>
          {children}
        </div>
      </div>
    </>
  );
}
