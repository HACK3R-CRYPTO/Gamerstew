import GameLeaderboardPage from "@/components/GameLeaderboardPage";

export default function Page() {
  return <GameLeaderboardPage gameKind="strike" game="Street Strike" back="/bowling" title="Street champions" blurb="Best solo game this week. Every throw was replayed by the server before the score was saved on-chain." />;
}
