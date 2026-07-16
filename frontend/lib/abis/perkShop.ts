// Minimal ABI for PerkShop — only the entries the frontend calls.
// PerkShop is the M1 "G$ Perk Economy" contract: casual-mode saves, retries
// and cosmetics paid in G$, with 20% of every sale routed to the GoodCollective
// UBI pool (visible on Celoscan). Ranked play never touches this shop.
// Deployed on Celo mainnet: 0x0fc6C5593B205b1c617CF33A236362B2c5c67650

export const perkShopAbi = [
  // ── Reads ────────────────────────────────────────────────────────────────
  {
    type: "function", stateMutability: "view", name: "perkPrice",
    inputs: [{ name: "perkId", type: "uint16" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", stateMutability: "view", name: "ownsCosmetic",
    inputs: [
      { name: "player", type: "address" },
      { name: "perkId", type: "uint16" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", stateMutability: "view", name: "perksBought",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", stateMutability: "view", name: "playerUbiContributed",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", stateMutability: "view", name: "totalCommunityContribution",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", stateMutability: "view", name: "ubiBps",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", stateMutability: "view", name: "paused",
    inputs: [],
    outputs: [{ type: "bool" }],
  },

  // ── Writes ───────────────────────────────────────────────────────────────
  {
    type: "function", stateMutability: "nonpayable", name: "buyPerk",
    inputs: [{ name: "perkId", type: "uint16" }],
    outputs: [],
  },

  // ── Events ───────────────────────────────────────────────────────────────
  {
    type: "event", name: "PerkPurchased",
    inputs: [
      { indexed: true,  name: "player",         type: "address" },
      { indexed: true,  name: "perkId",         type: "uint16"  },
      { indexed: false, name: "cosmetic",       type: "bool"    },
      { indexed: false, name: "totalPaid",      type: "uint256" },
      { indexed: false, name: "ubiAmount",      type: "uint256" },
      { indexed: false, name: "treasuryAmount", type: "uint256" },
    ],
  },
] as const;
