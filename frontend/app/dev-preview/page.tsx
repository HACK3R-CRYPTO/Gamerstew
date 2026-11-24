"use client";

// Development only: a place to LOOK at pop-ups that normally need a level-up or
// a pet evolution to appear. In a production build this page is not found.
import { notFound } from "next/navigation";
import { useState } from "react";
import LevelUpToast from "@/components/LevelUpToast";
import PetEvolveToast from "@/components/PetEvolveToast";
import SaveRunOverlay from "@/components/SaveRunOverlay";
import GameResult from "@/components/GameResult";
import RunSaveStatus from "@/components/RunSaveStatus";
import MintScorePrompt from "@/components/MintScorePrompt";

export default function DevPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [show, setShow] = useState<"level" | "pet" | "save" | "saved" | "signing" | "topup" | "failed" | "mint" | null>(null);
  return (
    <div style={{ minHeight: "100vh", padding: 24, background: "linear-gradient(180deg,#f3eeff,#e6dcff)", color: "#22104f", fontFamily: "system-ui, sans-serif" }}>
      <h1>Pop-up preview</h1>
      <button id="level" onClick={() => setShow("level")}>Level up</button>{" "}
      <button id="pet" onClick={() => setShow("pet")}>Pet evolves</button>{" "}
      <button id="save" onClick={() => setShow("save")}>Save my run</button>
      <SaveRunOverlay open={show === "save"} score={12} game="stack" headline="TOWER TOPPLED" decideMs={600000} onSaved={() => setShow(null)} onDecline={() => setShow(null)} />
      {(["saved", "signing", "topup", "failed", "mint"] as const).map((k) => <button key={k} id={k} onClick={() => setShow(k)} style={{ marginLeft: 6 }}>Result: {k}</button>)}
      {(show === "saved" || show === "signing" || show === "topup" || show === "failed" || show === "mint") && (
        <GameResult
          eyebrow="Great" tone="#0e7490" badge="B" score={1240}
          notes={<><span className="gold">New best! +180 on your old one</span><span>Only <b>2</b> rounds from <b>6TH COLOR</b></span></>}
          stats={[{ label: "Rounds", value: 9 }, { label: "Time", value: "48s" }]}
          saving={show === "signing"}
          onPlayAgain={() => setShow(null)} onExit={() => setShow(null)}
          challengeLabel="Challenge a friend to beat round 9" onChallenge={() => {}}
          status={show === "mint" ? <MintScorePrompt score={1240} /> : (
            <RunSaveStatus
              submitting={false} signingOnChain={show === "signing"} score={1240}
              result={show === "saved" ? { txHash: "0x15337dfc983975b1f3a0769b2b6af5905677973395f783bb4e2ae63f15b621e7", rank: 4, xpEarned: 35, level: 12, leveledUp: true, isNewPb: true, prevBest: 1060, newAchievements: ["first_win", { id: "x", name: "Sharp Memory", icon: "🧠" }] } : null}
              error={null} txError={show === "topup" ? "Not enough CELO. Top up to save." : show === "failed" ? "The wallet rejected the request." : null}
            />
          )}
        />
      )}
      <LevelUpToast level={show === "level" ? 12 : null} onClose={() => setShow(null)} />
      <PetEvolveToast pet={show === "pet" ? { id: "slime", name: "King Slime", src: "/pets/slime.png", color: "#22c55e", minLevel: 10 } : null} newLevel={12} onClose={() => setShow(null)} />
    </div>
  );
}
