"use client";

// ─── VatarBridge ──────────────────────────────────────────────────────────────
// Mounts once, app-wide, from the root layout. It activates the Vatar (Lagos
// Life) SDK only when GameArena is embedded in a Vatar world; on the standalone
// gamearenahq.xyz site initVatar() returns immediately and does nothing. This is
// what makes "SDK init seen" tick in the Vatar dashboard and lets any embedded
// game offer a purchase. Renders nothing.

import { useEffect } from "react";
import { initVatar } from "@/lib/vatar";

export default function VatarBridge() {
  useEffect(() => {
    void initVatar();
  }, []);
  return null;
}
