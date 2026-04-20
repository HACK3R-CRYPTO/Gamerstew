"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Shared game audio / feedback settings ───────────────────────────────────
// Persisted in localStorage under the key "gameSettings". Shape mirrors the
// profile page's settings UI exactly so the panel and the game are always in
// sync. Any call to the setters writes through to localStorage immediately.
//
// Volumes are 0–100 ints (matches slider UI). The game should scale them to
// 0–1 by dividing by 100 before feeding into Web Audio gain nodes.

export type AudioSettings = {
  musicOn: boolean;       // in-game music (rhythm/simon: bass, hats, lead)
  sfxOn: boolean;         // in-game sfx (rhythm/simon: tap bells, miss buzz)
  appAudioOn: boolean;    // EVERYTHING app-wide: ambient pad + UI clicks + stings + chimes + coin + tab switch
  musicVol: number;       // 0–100
  sfxVol: number;         // 0–100
  appAudioVol: number;    // 0–100
  notifOn: boolean;
  hapticsOn: boolean;
};

const KEY = "gameSettings";

const DEFAULTS: AudioSettings = {
  musicOn: true,
  sfxOn: true,
  appAudioOn: true,
  musicVol: 70,
  sfxVol: 85,
  appAudioVol: 60,
  notifOn: true,
  hapticsOn: true,
};

// SSR-safe reader — localStorage is undefined on the server, so fall back to
// defaults. Hydration will pick up the real value on the first client render.
function read(): AudioSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

// Same-tab sync uses this event name. Every mounted hook instance listens
// for it, so a toggle in Profile reaches useAppAudio in the layout immediately.
const SAME_TAB_EVENT = "gamesettings:changed";

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULTS);

  // Hydrate from localStorage on first mount — avoids SSR hydration mismatch.
  useEffect(() => { setSettings(read()); }, []);

  // Cross-tab sync: the native "storage" event only fires in OTHER tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setSettings(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Same-tab sync: every hook instance (Profile page, useAppAudio in layout,
  // any game page, etc.) holds its own useState — they don't share. Without
  // this, toggling App Audio in Profile leaves the layout's copy stale and
  // the ambient pad keeps playing. The custom event fans every update out
  // to all instances in the same tab.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<AudioSettings>).detail;
      if (next) setSettings(next);
    };
    window.addEventListener(SAME_TAB_EVENT, onChange);
    return () => window.removeEventListener(SAME_TAB_EVENT, onChange);
  }, []);

  const update = useCallback((patch: Partial<AudioSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      // Broadcast to sibling hook instances in the same tab
      try {
        window.dispatchEvent(new CustomEvent<AudioSettings>(SAME_TAB_EVENT, { detail: next }));
      } catch {}
      return next;
    });
  }, []);

  return { ...settings, update };
}

// Helper for games + app-wide audio: returns the effective gain multipliers
// (0–1) accounting for both the master toggle and the slider. Use these when
// scheduling audio. Games use .music / .sfx, the menu system uses .appAudio.
export function effectiveGains(s: AudioSettings) {
  return {
    music:    s.musicOn    ? s.musicVol    / 100 : 0,
    sfx:      s.sfxOn      ? s.sfxVol      / 100 : 0,
    appAudio: s.appAudioOn ? s.appAudioVol / 100 : 0,
  };
}
