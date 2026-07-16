// Perk catalog — the single source of truth for the 6 launch perks in the
// M1 "G$ Perk Economy". IDs and prices MUST match the deployed PerkShop
// (0x0fc6C5593B205b1c617CF33A236362B2c5c67650). Prices are display values;
// the contract holds the canonical on-chain price in 18-decimal G$.
//
// Every perk is CASUAL-MODE ONLY. Ranked play stays pure skill and never
// touches this shop. 85% of every purchase streams to the GoodCollective
// UBI pool; the split is enforced on-chain.

import { parseEther } from "viem";

export type PerkKind = "save" | "retry" | "cosmetic";

export interface Perk {
  id: number;              // on-chain perkId (uint16)
  game: "rhythm" | "stack" | "simon" | "challenge-ai";
  gameLabel: string;       // human game name
  name: string;            // perk display name
  blurb: string;           // one-line "what it does"
  priceG$: bigint;         // 18-decimal, matches contract
  priceLabel: string;      // e.g. "30 G$"
  kind: PerkKind;
  emoji: string;
}

// Order here is the display order in the shop shelf.
export const PERKS: Perk[] = [
  {
    id: 1, game: "rhythm", gameLabel: "Rhythm Rush",
    name: "Save your run", blurb: "Miss a note? Keep the combo alive and play on.",
    priceG$: parseEther("30"), priceLabel: "30 G$", kind: "save", emoji: "🎵",
  },
  {
    id: 3, game: "stack", gameLabel: "Stack Tower",
    name: "Save your run", blurb: "Fumble a block? Rescue the tower and keep stacking.",
    priceG$: parseEther("30"), priceLabel: "30 G$", kind: "save", emoji: "🧱",
  },
  {
    id: 4, game: "stack", gameLabel: "Stack Tower",
    name: "Crystal Blocks", blurb: "Build your tower from glowing crystal. Yours forever.",
    priceG$: parseEther("250"), priceLabel: "250 G$", kind: "cosmetic", emoji: "🧊",
  },
  {
    id: 5, game: "simon", gameLabel: "Simon Memory",
    name: "Retry", blurb: "Botched the sequence? Take the round again.",
    priceG$: parseEther("20"), priceLabel: "20 G$", kind: "retry", emoji: "🔁",
  },
  {
    id: 6, game: "challenge-ai", gameLabel: "Challenge AI",
    name: "Rematch", blurb: "Lost to MARKOV? Line up an instant rematch.",
    priceG$: parseEther("15"), priceLabel: "15 G$", kind: "retry", emoji: "🤖",
  },
  {
    id: 2, game: "rhythm", gameLabel: "Rhythm Rush",
    name: "Neon Trail", blurb: "A glowing neon trail on your notes. Yours forever.",
    priceG$: parseEther("300"), priceLabel: "300 G$", kind: "cosmetic", emoji: "✨",
  },
];

export function getPerk(id: number): Perk | undefined {
  return PERKS.find(p => p.id === id);
}

// The in-run "save" perk for a given game (used by the SaveRunOverlay). Only
// stack + rhythm have a live-rescue save; the rest use shop-bought retries.
export function savePerkFor(game: Perk["game"]): Perk | undefined {
  return PERKS.find(p => p.game === game && p.kind === "save");
}

export const COSMETIC_PERK_IDS = PERKS.filter(p => p.kind === "cosmetic").map(p => p.id);
