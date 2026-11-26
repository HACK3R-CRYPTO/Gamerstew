"use client";

// Development only: a place to LOOK at pop-ups that normally need a level-up or
// a pet evolution to appear. In a production build this page is not found.
import { notFound } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import LevelUpToast from "@/components/LevelUpToast";
import PetEvolveToast from "@/components/PetEvolveToast";
import SaveRunOverlay from "@/components/SaveRunOverlay";
import GameResult from "@/components/GameResult";
import RunSaveStatus from "@/components/RunSaveStatus";
import MintScorePrompt from "@/components/MintScorePrompt";
import FriendsSheet from "@/components/FriendsSheet";
import type { FriendRoom, RoomView } from "@/hooks/useFriendRoom";

// A room that is not real, to LOOK at the lobby in each state: /dev-preview?room=guest|agreed|host|hoststake|solo
function fakeRoom(kind: string): FriendRoom {
  const E50 = "50000000000000000000"; const staked = kind === "guest" || kind === "agreed" || kind === "hoststake";
  const you = kind === "host" || kind === "hoststake" || kind === "solo" ? 0 : 1;
  const players = [{ name: "ogazboiz", host: true, score: null, done: false, progress: 0, away: false }, { name: "lumos", host: false, score: null, done: false, progress: 0, away: false }].slice(0, kind === "solo" ? 1 : 2);
  const view = {
    code: "9UTVP", game: "simon", status: "waiting", round: 1, verified: true, you, elapsed: 0, players,
    chat: kind === "agreed" || kind === "hoststake" ? [{ id: 1, seat: 0, name: "ogazboiz", text: "Ready? 👀", at: 1 }, { id: 2, seat: 1, name: "lumos", text: "Good luck 🤝", at: 2 }] : [],
    stakes: true, stakeTerms: { spender: "0x" + "c".repeat(40), entries: [E50, "100000000000000000000", "250000000000000000000"], feeBps: 1000 },
    ...(staked ? { stake: { entryWei: E50, feeBps: 1000, state: "collecting", signed: kind === "guest" ? [true, false] : kind === "agreed" ? [true, true] : [true, false], winnerSeat: -1, pays: [], txs: [] } } : {}),
  } as unknown as RoomView;
  const nothing = async () => true;
  return { session: { code: "9UTVP", token: "t".repeat(32), game: "simon" }, view, error: null, busy: false, inRoom: true, isHost: you === 0, leave: () => {}, start: nothing, chat: nothing, say: () => {}, setEntry: nothing, agreeEntry: nothing, clearEntry: nothing, create: nothing, join: nothing } as unknown as FriendRoom;
}

export default function DevPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [show, setShow] = useState<"level" | "pet" | "save" | "saved" | "signing" | "topup" | "failed" | "mint" | null>(null);
  const roomKind = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("room"), () => null);
  if (roomKind) return <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#f3eeff,#e6dcff)" }}><FriendsSheet room={fakeRoom(roomKind)} gameName="Simon Memory" sharePath="/games/simon" onClose={() => {}} /></div>;
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
