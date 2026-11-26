"use client";

// The one cash-out sheet, opened from anywhere with openCashOut() (lib/cashout.ts).
// Mounted once in app/layout.tsx. It loads nothing until it is first opened, and
// it does not exist at all until a GoodCash key is set.
//
// A bottom sheet on a phone, a centred card on a wide screen: the same shape as
// the energy sheet. It cannot be closed while a payment is being sent, so a tap
// on the backdrop can never leave a player wondering whether it went.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GoodCash } from "@goodcash/sdk";
import { OPEN_CASHOUT, cashOutFake, cashOutOn } from "@/lib/cashout";
import { track } from "@/lib/track";

const Flow = dynamic(() => import("@/components/cashout/Flow"), { ssr: false, loading: () => <p style={{ margin: 0, padding: "40px 0", textAlign: "center", color: "rgba(34,16,79,0.6)", fontFamily: '"Fredoka", system-ui, sans-serif' }}>Opening…</p> });

export default function CashOutSheet() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<GoodCash | undefined>(undefined);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const on = async (e: Event) => {
      if (!cashOutOn()) return;
      // a developer's stand-in for GoodCash; the import is dropped from the real build
      if (process.env.NODE_ENV !== "production" && cashOutFake()) { const m = await import("@/lib/cashoutFake"); setClient((c) => c ?? m.fakeGoodCash()); }
      track("cashout_open", { from: (e as CustomEvent<{ from?: string }>).detail?.from ?? "unknown" });
      setRun((n) => n + 1); setBusy(false); setOpen(true);
    };
    window.addEventListener(OPEN_CASHOUT, on);
    return () => window.removeEventListener(OPEN_CASHOUT, on);
  }, []);

  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", key); const was = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = was; };
  }, [open, close]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="cos" role="dialog" aria-modal="true" aria-label="Cash out" onClick={close}>
      <div className="cos-card" onClick={(e) => e.stopPropagation()}>
        <Flow key={run} client={client} onClose={close} onBusy={setBusy} />
      </div>
      <style>{`
        .cos { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: flex-end; justify-content: center; background: rgba(27,13,66,0.55); animation: cosIn 0.18s ease-out; }
        .cos-card { width: 100%; max-width: 460px; max-height: 94dvh; overflow-y: auto; overscroll-behavior: contain; padding: 16px 18px calc(env(safe-area-inset-bottom, 0px) + 18px); border-radius: 28px 28px 0 0; background: #fbf8ff; box-shadow: 0 -10px 60px rgba(27,13,66,0.4); animation: cosUp 0.26s cubic-bezier(0.2, 0.9, 0.3, 1); }
        @keyframes cosIn { from { opacity: 0; } } @keyframes cosUp { from { transform: translateY(40px); opacity: 0; } }
        @media (min-width: 700px) { .cos { align-items: center; padding: 24px; } .cos-card { border-radius: 28px; max-height: 90dvh; padding: 20px 24px 22px; box-shadow: 0 20px 60px rgba(27,13,66,0.4); } }
        @media (prefers-reduced-motion: reduce) { .cos, .cos-card { animation: none; } }
      `}</style>
    </div>,
    document.body,
  );
}
