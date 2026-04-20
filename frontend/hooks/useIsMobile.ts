"use client";

import { useEffect, useState } from "react";

// ─── useIsMobile ────────────────────────────────────────────────────────────
// Returns true on viewports under 768px. SSR-safe — returns false during the
// server render and the first client render, then flips on mount if the
// viewport is actually mobile. Prevents hydration mismatch while still
// producing the correct layout within the first client frame.
//
// 768px is the standard mobile/tablet boundary (Tailwind's `md:` breakpoint).
// Under it we switch sidebar → bottom nav; above, we keep the sidebar.

const BREAKPOINT_PX = 768;

export function useIsMobile(breakpoint: number = BREAKPOINT_PX): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const apply = () => setIsMobile(mql.matches);
    apply();
    // addEventListener is the modern API; older Safari needs addListener
    if (mql.addEventListener) mql.addEventListener("change", apply);
    else mql.addListener(apply);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", apply);
      else mql.removeListener(apply);
    };
  }, [breakpoint]);

  return isMobile;
}
