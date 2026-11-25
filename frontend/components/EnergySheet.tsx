"use client";

// The one place a player is told they are out of energy, wherever they were.
// Any page calls outOfEnergy() (lib/energy.ts) when the server refuses a ranked
// run for lack of it. This sheet says what happened, when the free runs come
// back, and offers a pack if the shop is selling one. It never blocks play: the
// other choice is always to play for fun.
//
// Mounted once in app/layout.tsx. It does nothing until energy is switched on
// on the server, because nothing calls outOfEnergy() before then.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getEnergy } from "@/app/actions/perks";
import { usePerks } from "@/hooks/usePerks";
import { useLivePerk } from "@/hooks/useLivePerk";
import { OUT_OF_ENERGY, timeUntil, type EnergyState } from "@/lib/energy";
import { track } from "@/lib/track";

const DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';

export default function EnergySheet() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EnergyState | null>(null);
  const [status, setStatus] = useState<"idle" | "buying" | "bought" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const { address } = useAccount();
  const pack = useLivePerk(10);
  const { buyAndStock, gBalance } = usePerks();

  const read = useCallback(async () => {
    if (!address) return;
    const s = await getEnergy(address);
    if (s.on) setState(s as EnergyState);
  }, [address]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<EnergyState | null>).detail;
      if (d) setState(d);
      setStatus("idle"); setErr(null); setOpen(true); void read();
      track("energy_out", { has_pack: !!pack });
    };
    window.addEventListener(OUT_OF_ENERGY, on);
    return () => window.removeEventListener(OUT_OF_ENERGY, on);
  }, [read, pack]);

  if (!open) return null;
  const plays = state?.packPlays ?? 5;
  const canAfford = !!pack && gBalance >= pack.priceG$;
  const buy = async () => {
    if (!pack || status === "buying") return;
    setStatus("buying"); setErr(null);
    try {
      await buyAndStock(pack);
      track("energy_bought", { price: pack.priceLabel });
      await read(); setStatus("bought");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/insufficient|balance/i.test(m) ? "Not enough G$ for a pack." : /cancel|reject|denied/i.test(m) ? "Cancelled. Nothing was spent." : "That did not go through. Nothing was spent. Try again.");
      setStatus("error");
    }
  };
  const close = () => { if (status !== "buying") setOpen(false); };

  return (
    <div className="ens" role="dialog" aria-modal="true" aria-label="Out of energy" onClick={close}>
      <div className="ens-card" onClick={(e) => e.stopPropagation()}>
        <div className="ens-bolt" aria-hidden>⚡</div>
        {status === "bought" ? (
          <>
            <h2 style={{ fontFamily: DISPLAY }}>You are back in</h2>
            <p>{state ? `${state.left} ranked run${state.left === 1 ? "" : "s"} ready.` : `${plays} ranked runs added.`} They do not expire.</p>
            <button className="ens-main" onClick={close}>Play ranked</button>
          </>
        ) : (
          <>
            <h2 style={{ fontFamily: DISPLAY }}>Out of energy</h2>
            <p>
              You have played today&apos;s {state?.free ?? 5} free ranked runs.
              {state ? <> They come back in <b>{timeUntil(state.resetsAt)}</b>.</> : " They come back tomorrow."}
            </p>
            {pack && address && (
              <button className="ens-main" onClick={buy} disabled={status === "buying" || !canAfford}>
                {status === "buying" ? "Confirming…" : <>Get {plays} more runs <span>{pack.priceLabel}</span></>}
              </button>
            )}
            {pack && address && !canAfford && status !== "buying" && <div className="ens-note">You need {pack.priceLabel} for a pack.</div>}
            {err && <div className="ens-err" role="alert">{err}</div>}
            <button className="ens-ghost" onClick={close} disabled={status === "buying"}>Play for fun instead</button>
            <div className="ens-note">A run played for fun is not ranked and does not use energy.</div>
          </>
        )}
      </div>
      <style>{`
        .ens { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: flex-end; justify-content: center; padding: 0 12px calc(env(safe-area-inset-bottom, 0px) + 14px); background: rgba(27,13,66,0.55); animation: ensIn 0.18s ease-out; }
        .ens-card { width: 100%; max-width: 420px; padding: 22px 18px 16px; border-radius: 26px; background: #fff; color: #22104f; text-align: center; box-shadow: 0 20px 60px rgba(27,13,66,0.4); animation: ensUp 0.24s cubic-bezier(0.2, 0.9, 0.3, 1); font-family: "Fredoka", system-ui, sans-serif; }
        .ens-bolt { width: 58px; height: 58px; margin: 0 auto 8px; border-radius: 50%; display: grid; place-items: center; font-size: 28px; background: linear-gradient(180deg, #f3e8ff, #e4d4ff); }
        .ens-card h2 { margin: 0; font-size: 26px; line-height: 1.1; color: #22104f; }
        .ens-card p { margin: 8px 0 16px; font-size: 15px; line-height: 1.45; color: rgba(34,16,79,0.78); }
        .ens-card p b { color: #22104f; }
        .ens-main { width: 100%; min-height: 52px; border: none; border-radius: 16px; background: linear-gradient(180deg, #7c3aed, #6d28d9); color: #fff; font: 700 16px "Fredoka", system-ui, sans-serif; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .ens-main span { padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.2); font-size: 14px; }
        .ens-main:disabled { opacity: 0.55; cursor: default; }
        .ens-ghost { width: 100%; min-height: 48px; margin-top: 8px; border-radius: 16px; border: 1px solid rgba(76,29,149,0.22); background: #fff; color: #4c1d95; font: 600 15px "Fredoka", system-ui, sans-serif; cursor: pointer; }
        .ens-note { margin-top: 8px; font-size: 12.5px; color: rgba(34,16,79,0.62); }
        .ens-err { margin-top: 8px; font-size: 13.5px; font-weight: 600; color: #b91c1c; }
        @keyframes ensIn { from { opacity: 0; } } @keyframes ensUp { from { transform: translateY(24px); opacity: 0; } }
        @media (min-width: 700px) { .ens { align-items: center; padding: 24px; } }
        @media (prefers-reduced-motion: reduce) { .ens, .ens-card { animation: none; } }
      `}</style>
    </div>
  );
}
