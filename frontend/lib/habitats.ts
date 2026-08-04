// ─── Habitat tier definitions ─────────────────────────────────────────────────
//
// Free tiers (1-5) auto-unlock as the player levels up. They line up with
// the existing pet evolution stages so the world grows alongside the pet.
//
// Paid tiers (6-10) unlock by donating G$ via the HabitatRegistry contract.
// 85% of every donation routes to the GoodDollar UBI pool, 15% to the
// GameArena treasury.
//
// Visual style is CSS-based for now (gradients + glow). When real art ships
// later, swap `bgImage` in to replace the gradient.

export type HabitatTier = {
  id: number;            // 1-10
  name: string;          // display name
  type: "free" | "paid";
  unlockLevel?: number;  // for free tiers
  costG$?: bigint;       // for paid tiers (18-decimal G$)
  bgImage?: string;      // premium art (public/habitats/<id>.jpg). When set,
                         // renders as the scene; the CSS gradient/Scene is the
                         // fallback. A light animated sparkle layer keeps it alive.
  bg: {
    gradient: string;    // CSS gradient for the background
    accent: string;      // glow / particle color
    overlay?: string;    // optional radial overlay for atmosphere
  };
  blurb: string;         // one-line vibe descriptor
};

const G$ = (amount: number) => BigInt(amount) * 10n ** 18n;

export const HABITATS: HabitatTier[] = [
  // ── FREE TIERS (level-gated, mapped to pet evolution) ────────────────────
  // Tier id = pet stage. The world your pet lives in grows up with them.
  //   1 Egg     → Cozy Nest      (born safe, warmth, twigs and feathers)
  //   2 Baby    → Sunny Meadow   (first steps, open field, butterflies)
  //   3 Teen    → Ancient Forest (exploring, deep woods, dappled light)
  //   4 Crystal → Crystal Cavern (real cave geology, stalactites)
  //   5 King    → Royal Hall     (peak status, ornate marble + gold)
  {
    id: 1, name: "Cozy Nest", type: "free", unlockLevel: 1,
    bgImage: "/habitats/1.jpg",
    bg: {
      gradient: "linear-gradient(180deg, #4a2c1a 0%, #2e1a0e 100%)",
      accent: "#fcd34d",
    },
    blurb: "A nest of twigs. Safe and warm.",
  },
  {
    id: 2, name: "Sunny Meadow", type: "free", unlockLevel: 5,
    bgImage: "/habitats/2.jpg",
    bg: {
      gradient: "linear-gradient(180deg, #93c5fd 0%, #86efac 60%, #166534 100%)",
      accent: "#86efac",
    },
    blurb: "Wildflowers and butterflies.",
  },
  {
    id: 3, name: "Ancient Forest", type: "free", unlockLevel: 15,
    bgImage: "/habitats/3.jpg",
    bg: {
      gradient: "linear-gradient(180deg, #14532d 0%, #052e16 100%)",
      accent: "#22c55e",
    },
    blurb: "Deep woods. Light through the canopy.",
  },
  {
    id: 4, name: "Crystal Cavern", type: "free", unlockLevel: 30,
    bgImage: "/habitats/4.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 100%, #0a6594 0%, #04293d 70%, #02141f 100%)",
      accent: "#22d3ee",
    },
    blurb: "Stalactites and glowing geodes.",
  },
  {
    id: 5, name: "Royal Hall", type: "free", unlockLevel: 50,
    bgImage: "/habitats/5.jpg",
    bg: {
      gradient: "linear-gradient(180deg, #2e1604 0%, #6e3d0a 50%, #92400e 100%)",
      accent: "#fbbf24",
    },
    blurb: "Marble, gold, and the throne.",
  },

  // ── PAID TIERS (G$ donation) ──────────────────────────────────────────────
  {
    id: 6, name: "Celestial Arena", type: "paid", costG$: G$(500),
    bgImage: "/habitats/6.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 90%, rgba(167,139,250,0.5) 0%, transparent 60%), linear-gradient(180deg, #1e0b4d 0%, #4c1d95 100%)",
      accent: "#a78bfa",
      overlay: "radial-gradient(circle at 70% 25%, rgba(196,181,253,0.22) 0%, transparent 40%), radial-gradient(circle at 25% 65%, rgba(139,92,246,0.18) 0%, transparent 35%)",
    },
    blurb: "Floating among the stars.",
  },
  {
    id: 7, name: "Mystic Garden", type: "paid", costG$: G$(1_500),
    bgImage: "/habitats/7.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 90%, rgba(20,184,166,0.55) 0%, transparent 60%), linear-gradient(180deg, #042f2e 0%, #115e59 100%)",
      accent: "#2dd4bf",
      overlay: "radial-gradient(circle at 30% 30%, rgba(94,234,212,0.25) 0%, transparent 40%), radial-gradient(circle at 75% 70%, rgba(15,118,110,0.3) 0%, transparent 35%)",
    },
    blurb: "Glowing flora and chimes.",
  },
  {
    id: 8, name: "Astral Realm", type: "paid", costG$: G$(5_000),
    bgImage: "/habitats/8.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 90%, rgba(232,121,249,0.5) 0%, transparent 60%), linear-gradient(180deg, #1f0a3a 0%, #581c87 100%)",
      accent: "#e879f9",
      overlay: "radial-gradient(circle at 25% 30%, rgba(244,114,182,0.28) 0%, transparent 40%), radial-gradient(circle at 75% 60%, rgba(129,140,248,0.2) 0%, transparent 40%)",
    },
    blurb: "Dimensions fold into each other.",
  },
  {
    id: 9, name: "Cosmic Throne", type: "paid", costG$: G$(15_000),
    bgImage: "/habitats/9.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 90%, rgba(251,146,60,0.55) 0%, transparent 60%), linear-gradient(180deg, #4a1604 0%, #92400e 50%, #fbbf24 130%)",
      accent: "#fb923c",
      overlay: "radial-gradient(circle at 50% 30%, rgba(254,215,170,0.3) 0%, transparent 45%), radial-gradient(circle at 80% 70%, rgba(251,191,36,0.25) 0%, transparent 40%)",
    },
    blurb: "Reserved for the few.",
  },
  {
    id: 10, name: "Eternal Sanctuary", type: "paid", costG$: G$(50_000),
    bgImage: "/habitats/10.jpg",
    bg: {
      gradient: "radial-gradient(ellipse at 50% 90%, rgba(192,132,252,0.6) 0%, transparent 60%), linear-gradient(135deg, #ec4899 0%, #8b5cf6 35%, #06b6d4 70%, #fbbf24 100%)",
      accent: "#fde68a",
      overlay: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25) 0%, transparent 40%), radial-gradient(circle at 70% 70%, rgba(244,114,182,0.3) 0%, transparent 40%)",
    },
    blurb: "Mythic. Forever.",
  },
];

export const FIRST_PAID_TIER = 6;

// ── Helpers ────────────────────────────────────────────────────────────────
export function getHabitat(id: number): HabitatTier | undefined {
  return HABITATS.find(h => h.id === id);
}

// Highest free tier available at a given level.
export function freeTierForLevel(level: number): HabitatTier {
  let tier = HABITATS[0];
  for (const h of HABITATS) {
    if (h.type !== "free") break;
    if (h.unlockLevel != null && level >= h.unlockLevel) tier = h;
  }
  return tier;
}

// Best habitat to display: highest paid tier the player owns, otherwise the
// highest free tier their level grants. Auto-equip on the read side keeps
// the contract storage minimal (no equippedTier needed on-chain).
export function defaultEquipped(level: number, ownedPaidTiers: number[]): HabitatTier {
  if (ownedPaidTiers.length > 0) {
    const highest = Math.max(...ownedPaidTiers);
    const found = getHabitat(highest);
    if (found) return found;
  }
  return freeTierForLevel(level);
}

// Format G$ amount with 18 decimals to a clean display string.
export function formatG$(amount: bigint, decimals = 0): string {
  const whole = amount / 10n ** 18n;
  if (decimals === 0) return whole.toLocaleString();
  const frac  = amount % 10n ** 18n;
  const fracStr = (Number(frac) / 1e18).toFixed(decimals).slice(2);
  return `${whole.toLocaleString()}.${fracStr}`;
}
