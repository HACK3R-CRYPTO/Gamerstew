// ─── Slime Survivor — upgrade economy ─────────────────────────────────────────
// Step 2 of the build plan: the between-runs loop that turns a fun game into
// a product. Every run banks the coins you caught; you spend them here to
// run further next time. That "one more run to afford the next upgrade"
// pull is the whole retention engine.
//
// Persistence is localStorage for now (free-play, device-local). Step 4
// (G$ ranked entry via SoloWager) layers paid runs on top WITHOUT changing
// this — the upgrade math stays identical, only the coin source differs.
//
// Effects are read by the game loop through the derived `UpgradeEffects`
// object so the page never hard-codes per-level numbers.

export type UpgradeId = "heart" | "magnet" | "shield" | "value";

export type UpgradeDef = {
  id: UpgradeId;
  name: string;
  icon: string;
  blurb: string;
  /** Cost in banked coins to buy each level, index 0 = level 1. */
  costs: number[];
  /** Short per-level effect label shown in the shop. */
  effectLabel: (level: number) => string;
};

export const UPGRADES: UpgradeDef[] = [
  {
    id: "heart",
    name: "Extra Heart",
    icon: "❤️",
    blurb: "Start each run with more lives.",
    costs: [150, 450],                       // max level 2
    effectLabel: (lv) => `+${lv} starting ${lv === 1 ? "heart" : "hearts"}`,
  },
  {
    id: "magnet",
    name: "Coin Magnet",
    icon: "🧲",
    blurb: "Nearby coins drift toward your slime.",
    costs: [120, 280, 560],                  // max level 3
    effectLabel: (lv) => `${lv * 55}px pull range`,
  },
  {
    id: "shield",
    name: "Bubble Shield",
    icon: "🛡️",
    blurb: "Absorb spike hits before losing a heart.",
    costs: [140, 340, 680],                  // max level 3
    effectLabel: (lv) => `${lv} shield ${lv === 1 ? "charge" : "charges"} per run`,
  },
  {
    id: "value",
    name: "Golden Touch",
    icon: "🪙",
    blurb: "Every coin and gem is worth more.",
    costs: [100, 240, 500],                  // max level 3
    effectLabel: (lv) => `+${lv * 25}% coin score`,
  },
];

export type UpgradeLevels = Record<UpgradeId, number>;

const COINS_KEY = "survivor_coins";
const LEVELS_KEY = "survivor_upgrades";

export function maxLevel(id: UpgradeId): number {
  return UPGRADES.find(u => u.id === id)?.costs.length ?? 0;
}

/** Cost of the NEXT level, or null if maxed. */
export function nextCost(id: UpgradeId, currentLevel: number): number | null {
  const def = UPGRADES.find(u => u.id === id);
  if (!def || currentLevel >= def.costs.length) return null;
  return def.costs[currentLevel];
}

export function loadCoins(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(COINS_KEY) || 0);
}

export function saveCoins(n: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COINS_KEY, String(Math.max(0, Math.floor(n))));
}

export function loadLevels(): UpgradeLevels {
  const base: UpgradeLevels = { heart: 0, magnet: 0, shield: 0, value: 0 };
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(LEVELS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<UpgradeLevels>;
    return {
      heart: clampLevel("heart", parsed.heart),
      magnet: clampLevel("magnet", parsed.magnet),
      shield: clampLevel("shield", parsed.shield),
      value: clampLevel("value", parsed.value),
    };
  } catch {
    return base;
  }
}

function clampLevel(id: UpgradeId, v: number | undefined): number {
  return Math.max(0, Math.min(maxLevel(id), Math.floor(v ?? 0)));
}

export function saveLevels(levels: UpgradeLevels): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
}

// ─── Derived effects the game loop consumes ───────────────────────────────────
export type UpgradeEffects = {
  startHearts: number;       // total hearts at run start (base + heart upgrade)
  magnetRange: number;       // px; 0 = off
  shieldCharges: number;     // absorbs this many spike hits before hearts
  coinMultiplier: number;    // multiply coin/gem base score
};

export function effectsFor(levels: UpgradeLevels, baseHearts: number): UpgradeEffects {
  return {
    startHearts: baseHearts + levels.heart,
    magnetRange: levels.magnet * 55,
    shieldCharges: levels.shield,
    coinMultiplier: 1 + levels.value * 0.25,
  };
}
