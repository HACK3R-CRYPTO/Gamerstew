"use client";

// Development only: a place to LOOK at pop-ups that normally need a level-up or
// a pet evolution to appear. In a production build this page is not found.
import { notFound } from "next/navigation";
import { useState } from "react";
import LevelUpToast from "@/components/LevelUpToast";
import PetEvolveToast from "@/components/PetEvolveToast";
import SaveRunOverlay from "@/components/SaveRunOverlay";

export default function DevPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [show, setShow] = useState<"level" | "pet" | "save" | null>(null);
  return (
    <div style={{ minHeight: "100vh", padding: 24, background: "linear-gradient(180deg,#f3eeff,#e6dcff)", color: "#22104f", fontFamily: "system-ui, sans-serif" }}>
      <h1>Pop-up preview</h1>
      <button id="level" onClick={() => setShow("level")}>Level up</button>{" "}
      <button id="pet" onClick={() => setShow("pet")}>Pet evolves</button>{" "}
      <button id="save" onClick={() => setShow("save")}>Save my run</button>
      <SaveRunOverlay open={show === "save"} score={12} game="stack" headline="TOWER TOPPLED" decideMs={600000} onSaved={() => setShow(null)} onDecline={() => setShow(null)} />
      <LevelUpToast level={show === "level" ? 12 : null} onClose={() => setShow(null)} />
      <PetEvolveToast pet={show === "pet" ? { id: "slime", name: "King Slime", src: "/pets/slime.png", color: "#22c55e", minLevel: 10 } : null} newLevel={12} onClose={() => setShow(null)} />
    </div>
  );
}
