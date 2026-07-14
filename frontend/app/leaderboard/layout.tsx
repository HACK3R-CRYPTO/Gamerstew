import type { Metadata } from "next";

// Route-level metadata for /leaderboard. The page is a client component, so
// this server layout supplies the SEO tags.
export const metadata: Metadata = {
  title: "Leaderboard · Top Players & Weekly Ranks",
  description:
    "See who is on top at Game Arena. Live weekly and all-time leaderboards across memory, focus, and reflex games, played by real verified people, no bots. Climb the ranks and earn real rewards.",
  alternates: { canonical: "/leaderboard" },
  openGraph: {
    title: "Leaderboard · Game Arena",
    description: "Live weekly and all-time ranks. Real verified players, no bots. Climb the board.",
    url: "https://gamearenahq.xyz/leaderboard",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Game Arena leaderboard" }],
  },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
