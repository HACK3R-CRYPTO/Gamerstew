import GameLeaderboardPage from "@/components/GameLeaderboardPage";

export default function Page() {
  return <GameLeaderboardPage gameKind="ladder" game="Word Ladder" back="/games/ladder" title="Sharpest climbers" blurb="Best round this week. Every score here was checked by the server and saved on-chain." />;
}
