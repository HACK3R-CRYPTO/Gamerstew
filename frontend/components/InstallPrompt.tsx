"use client";

// ─── Install GameArena as an app ─────────────────────────────────────────────
// A website a player can put on their home screen: it opens full screen, with
// its own icon, like an app from a store, and there is nothing to download.
//
//   Android / Chrome / Edge   the browser offers an install; this card has the
//                             button that triggers it.
//   iPhone / iPad (Safari)    Apple has no install button, so the card shows
//                             the two taps: Share, then "Add to Home Screen".
//
// It stays out of the way: not inside MiniPay or a Vatar world, not when the
// app is already installed, not for a week after "Not now", and only after the
// player has been on the page a little while.

import { useEffect, useState } from "react";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { isEmbedded } from "@/lib/vatar";
import { track } from "@/lib/track";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const KEY = "ga_install_later"; const WEEK = 7 * 86400000;

export default function InstallPrompt() {
  const miniPay = useIsMiniPay();
  const [offer, setOffer] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (miniPay || isEmbedded()) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try { const later = Number(window.localStorage.getItem(KEY) || 0); if (later && Date.now() - later < WEEK) return; } catch { /* no storage: just show it */ }
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const onOffer = (e: Event) => { e.preventDefault(); setOffer(e as InstallEvent); };
    const onDone = () => { setShow(false); track("app_installed"); };
    window.addEventListener("beforeinstallprompt", onOffer);
    window.addEventListener("appinstalled", onDone);
    setIos(isIos);
    const t = window.setTimeout(() => setShow(true), 9000);
    return () => { window.removeEventListener("beforeinstallprompt", onOffer); window.removeEventListener("appinstalled", onDone); window.clearTimeout(t); };
  }, [miniPay]);

  const later = () => { setShow(false); try { window.localStorage.setItem(KEY, String(Date.now())); } catch { /* fine */ } };
  const install = async () => { if (!offer) return; track("install_tapped"); await offer.prompt(); const c = await offer.userChoice.catch(() => null); if (c?.outcome !== "accepted") later(); setOffer(null); setShow(false); };

  if (!show || (!offer && !ios)) return null;
  return (
    <div className="ip" role="dialog" aria-label="Install GameArena">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" width={48} height={48} />
      <div className="ip-text">
        <b>Get the GameArena app</b>
        {offer ? <span>One tap. Opens full screen, no download from a store.</span>
          : <span>Tap <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share" style={{ verticalAlign: "-2px" }}><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg> at the bottom of Safari, then <em>Add to Home Screen</em>.</span>}
      </div>
      {offer ? <button className="ip-go" onClick={install}>Install</button> : null}
      <button className="ip-x" onClick={later} aria-label="Not now">✕</button>
      <style>{`
        .ip { position: fixed; left: 12px; right: 12px; bottom: calc(92px + env(safe-area-inset-bottom)); z-index: 55; max-width: 460px; margin: 0 auto; display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 20px; background: #fff; color: #22104f; box-shadow: 0 0 0 1px rgba(76,29,149,0.16), 0 22px 44px -18px rgba(76,29,149,0.7); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; animation: ipIn .45s cubic-bezier(.2,.9,.3,1.2) both; }
        @keyframes ipIn { from { opacity: 0; transform: translateY(16px); } }
        .ip img { border-radius: 12px; flex: 0 0 auto; }
        .ip-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
        .ip-text b { font-size: 15px; } .ip-text span { font-size: 13px; line-height: 1.35; color: rgba(34,16,79,0.72); } .ip-text em { font-style: normal; font-weight: 700; color: #22104f; }
        .ip-go { flex: 0 0 auto; padding: 11px 16px; min-height: 44px; border: none; border-radius: 14px; background: linear-gradient(180deg, #7c3aed, #6d28d9); box-shadow: 0 4px 0 #4c1d95; color: #fff; font-weight: 800; font-size: 14.5px; cursor: pointer; }
        .ip-x { flex: 0 0 auto; width: 36px; height: 36px; border: none; background: transparent; color: rgba(34,16,79,0.55); font-size: 15px; cursor: pointer; border-radius: 10px; }
        @media (prefers-reduced-motion: reduce) { .ip { animation: none; } }
      `}</style>
    </div>
  );
}
