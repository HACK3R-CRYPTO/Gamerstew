// ─── DuelEscrow · address, ABI, types, helpers ──────────────────────────────
// The on-chain money layer for duel rooms / prize pools. Reads come from the
// backend mirror (fast, filters private rooms); writes go straight to the
// contract from the player's wallet (permit saves the approve tx).

export const DUEL_ESCROW_ADDRESS =
  (process.env.NEXT_PUBLIC_DUEL_ESCROW_ADDRESS || "0x5dd223edb320Bc7e5D1DbF0D68512D1917E0c557") as `0x${string}`;

// gameType ↔ key (matches GamePass gameType + the games' string keys)
export const DUEL_GAMES = [
  { type: 0, key: "rhythm", label: "Rhythm Rush" },
  { type: 1, key: "simon", label: "Simon Memory" },
  { type: 2, key: "stack", label: "Stack Tower" },
  { type: 3, key: "challenge-ai", label: "Challenge AI" },
] as const;

export type Gating = "open" | "code" | "allowlist";
export type Visibility = "public" | "private";

export type DuelRoom = {
  id: number;
  creator: string;
  game_type: number;
  games?: number[] | null;
  visibility: Visibility;
  gating: Gating;
  stake_wei: string;
  seed_wei: string;
  fee_bps: number;
  capacity: number;
  starts_at?: string | null; // ISO · when scoring opens (off-chain)
  deadline: string;          // ISO · when it ends (on-chain)
  status: "open" | "resolved" | "refunded";
  winner?: string | null;
};

export type DuelParticipant = { wallet: string; join_index: number; score: number | null };

// Full write ABI, const-asserted for wagmi type inference.
export const DUEL_ESCROW_ABI = [
  {
    type: "function", stateMutability: "nonpayable", name: "createRoom",
    inputs: [{
      name: "p", type: "tuple",
      components: [
        { name: "gameType", type: "uint8" },
        { name: "stake", type: "uint256" },
        { name: "seed", type: "uint256" },
        { name: "feeBps", type: "uint16" },
        { name: "capacity", type: "uint16" },
        { name: "deadline", type: "uint64" },
        { name: "joinCodeHash", type: "bytes32" },
        { name: "useAllowlist", type: "bool" },
        { name: "targetScore", type: "uint256" },
      ],
    }],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function", stateMutability: "nonpayable", name: "createRoomWithPermit",
    inputs: [
      {
        name: "p", type: "tuple",
        components: [
          { name: "gameType", type: "uint8" },
          { name: "stake", type: "uint256" },
          { name: "seed", type: "uint256" },
          { name: "feeBps", type: "uint16" },
          { name: "capacity", type: "uint16" },
          { name: "deadline", type: "uint64" },
          { name: "joinCodeHash", type: "bytes32" },
          { name: "useAllowlist", type: "bool" },
          { name: "targetScore", type: "uint256" },
        ],
      },
      {
        name: "permit", type: "tuple",
        components: [
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function", stateMutability: "nonpayable", name: "joinRoom",
    inputs: [{ name: "id", type: "uint256" }, { name: "code", type: "string" }],
    outputs: [],
  },
  {
    type: "function", stateMutability: "nonpayable", name: "joinRoomWithPermit",
    inputs: [
      { name: "id", type: "uint256" }, { name: "code", type: "string" },
      {
        name: "permit", type: "tuple",
        components: [
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function", stateMutability: "nonpayable", name: "addToAllowlist",
    inputs: [{ name: "id", type: "uint256" }, { name: "wallets", type: "address[]" }],
    outputs: [],
  },
  {
    type: "function", stateMutability: "nonpayable", name: "removeFromAllowlist",
    inputs: [{ name: "id", type: "uint256" }, { name: "wallet", type: "address" }],
    outputs: [],
  },
  {
    type: "function", stateMutability: "view", name: "roomCount",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "event", name: "RoomCreated", anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "gameType", type: "uint8", indexed: false },
      { name: "stake", type: "uint256", indexed: false },
      { name: "seed", type: "uint256", indexed: false },
      { name: "feeBps", type: "uint16", indexed: false },
      { name: "capacity", type: "uint16", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "isPrivate", type: "bool", indexed: false },
      { name: "useAllowlist", type: "bool", indexed: false },
      { name: "targetScore", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ZERO_BYTES32 = ("0x" + "0".repeat(64)) as `0x${string}`;

// Duel room state: upcoming (before the start time) → live (scoring open) →
// sealed (past the end, or already resolved/refunded).
export function duelPhase(room: Pick<DuelRoom, "deadline" | "status" | "starts_at">, now: number): "upcoming" | "live" | "sealed" {
  if (room.status !== "open") return "sealed";
  const starts = room.starts_at ? Date.parse(room.starts_at) : 0;
  if (starts && now < starts) return "upcoming";
  return now < Date.parse(room.deadline) ? "live" : "sealed";
}

export function gameLabel(type: number): string {
  return DUEL_GAMES.find((g) => g.type === type)?.label ?? "Game";
}
export function gameKey(type: number): string {
  return DUEL_GAMES.find((g) => g.type === type)?.key ?? "rhythm";
}
