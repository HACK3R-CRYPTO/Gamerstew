import type { Metadata } from "next";

// Route-level metadata for /games. The page itself is a client component and
// cannot export metadata, so this server layout supplies the SEO tags. Targets
// the searches people actually type: "brain games", "memory game", etc.
export const metadata: Metadata = {
  title: "Free Brain Games · Memory, Focus & Reflex Games",
  description:
    "Play free quick games that train your brain. Simon Memory for recall, Stack Tower for precision, Rhythm Rush for focus, and Challenge AI against MARKOV. Compete with real people and climb the leaderboard.",
  alternates: { canonical: "/games" },
  openGraph: {
    title: "Free Brain Games · Game Arena",
    description:
      "Quick games that make you sharper. Memory, focus, precision, and an AI opponent that learns how you play.",
    url: "https://gamearenahq.xyz/games",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Game Arena games" }],
  },
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
