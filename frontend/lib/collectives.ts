// ─── GoodCollective registry ─────────────────────────────────────────────────
// The collectives a player can point their UBI share at. RULE: only entries
// with on-chain-verified addresses ship here (see memory: never mislabel
// GoodDollar ecosystem names). The default entry is the pool BOTH live
// contracts (PerkShop.ubiPool, HabitatRegistry.ubiPool) pay today — verified
// via forno read on 2026-08-02.
//
// Adding a collective = one entry with a verified pool address (confirm on
// Celoscan / official GoodDollar sources first). The picker, storage, and
// passport display all read from this list.

export type Collective = {
  id: string;        // stable slug stored in the player's choice
  name: string;
  tagline: string;
  emoji: string;
  address: `0x${string}`; // verified pool address
};

export const COLLECTIVES: Collective[] = [
  {
    id: "gooddollar-ubi",
    name: "GoodDollar UBI Pool",
    tagline: "Daily universal basic income for verified people worldwide",
    emoji: "🌍",
    address: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",
  },
  // Next entries land here once their pool addresses are verified with the
  // GoodDollar team (e.g. climate collectives like Silvi/DeTrash).
];

export const DEFAULT_COLLECTIVE_ID = "gooddollar-ubi";

export function collectiveById(id?: string | null): Collective {
  return COLLECTIVES.find((c) => c.id === id) ?? COLLECTIVES[0]!;
}
