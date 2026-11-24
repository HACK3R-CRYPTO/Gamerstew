// ─── Street Strike billboards ────────────────────────────────────────────────
// The boards along the street are ad space. Each board cycles through this
// list, so selling a slot is one entry here: give it `image` (a 2:1 picture in
// /public) and the artwork replaces the drawn poster. Without an image the
// board draws a poster from the text and colours.
//
// The house ads below fill every slot nobody has bought: they send players to
// our other games, and one tells brands the space is for sale.

export interface Ad {
  id: string;
  kicker?: string; // small line above the headline
  title: string;
  sub?: string;
  bg: [string, string]; // gradient, top-left to bottom-right
  ink: string; // headline colour
  accent: string; // kicker, stripe and frame glow
  image?: string; // sponsor artwork; replaces the drawn poster
}

export const ADS: Ad[] = [
  { id: "sell", kicker: "THIS BOARD IS FOR SALE", title: "YOUR BRAND HERE", sub: "gamearenahq.xyz", bg: ["#2a1240", "#7c3aed"], ink: "#ffffff", accent: "#fbbf24" },
  { id: "rhythm", kicker: "NOW PLAYING", title: "RHYTHM RUSH", sub: "Tap the beat. Climb the board.", bg: ["#0b1a4a", "#2563eb"], ink: "#ffffff", accent: "#5fd4ff" },
  { id: "nepa", kicker: "LAGOS IS DARK", title: "UP NEPA!", sub: "Bring back the light", bg: ["#3a2a05", "#f59e0b"], ink: "#fff7d6", accent: "#fff3cf" },
  { id: "markov", kicker: "THINK YOU CAN READ IT?", title: "BEAT MARKOV", sub: "Rock. Paper. Scissors. Mind games.", bg: ["#3b0a2a", "#e11d48"], ink: "#ffffff", accent: "#ffd56b" },
  { id: "simon", kicker: "HOW FAR CAN YOU GO?", title: "SIMON MEMORY", sub: "Watch. Remember. Repeat.", bg: ["#052e1b", "#16a34a"], ink: "#ffffff", accent: "#bbf7d0" },
];
