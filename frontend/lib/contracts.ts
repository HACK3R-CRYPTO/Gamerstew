// Contract addresses
export const CONTRACT_ADDRESSES = {
  ARENA_PLATFORM: '0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE',
  AI_AGENT: process.env.NEXT_PUBLIC_AI_AGENT_ADDRESS || '0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1',
  ERC8004_REGISTRY: process.env.NEXT_PUBLIC_ERC8004_REGISTRY || '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  ERC8004_REPUTATION: process.env.NEXT_PUBLIC_ERC8004_REPUTATION || '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  AGENT_TOKEN_ID: process.env.NEXT_PUBLIC_AGENT_TOKEN_ID || null,
  G_TOKEN: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
  GAME_PASS: '0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE',
  HABITAT_REGISTRY: process.env.NEXT_PUBLIC_HABITAT_REGISTRY || '0x8888FEb43ac1833c683D0474204aa55A55BD010F',
  // PerkShop — M1 "G$ Perk Economy". Casual-mode saves/retries/cosmetics in G$,
  // 85% of every sale to the GoodCollective UBI pool.
  PERK_SHOP: process.env.NEXT_PUBLIC_PERK_SHOP || '0xbccCa01A253C25dC2cd60ee4640a4Bfea695eddb',
};

// MiniPay deeplink targets (celopedia minipay-requirements §"Deeplinks"
// and §6 "Integration & Support"). Use these instead of in-app explainer
// screens — MiniPay handles the funding UX natively and pulls users
// back into the Mini App afterwards. Canonical list:
// https://docs.minipay.xyz/technical-references/deeplinks.html
export const MINIPAY_DEEPLINKS = {
  ADD_CASH: 'https://link.minipay.xyz/add_cash?tokens=USDC,USDT,USDm',
  INVITE_FRIENDS: 'https://link.minipay.xyz/invite_friends',
  BALANCE: 'https://link.minipay.xyz/balance',
} as const;

// Celo MiniPay fee-currency adapters. MiniPay users have zero CELO by
// design, so every tx they sign must include `feeCurrency` pointing at
// one of these addresses. Canonical mapping from celopedia minipay-
// guide §"Supported Stablecoins":
//   USDC / USDT — fee currency is a separate **adapter** address
//   USDm        — fee currency is the **token** address itself
// Passing the token instead of the adapter for USDC/USDT causes silent
// tx failures, which is exactly the foot-gun celopedia warns about.
export const STABLECOIN_TOKENS = {
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
  USDm: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
} as const;
export const FEE_CURRENCY_ADAPTERS = {
  USDC: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
  USDT: '0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72',
  USDm: '0x765DE816845861e75A25fCA122bb6898B8B1282a', // token == adapter
} as const;

// Sync fallback: returns the USDm fee currency for MiniPay (MiniPay's own
// default), or empty for non-MiniPay (pay in CELO). Used when we can't
// await a balance check — e.g. inside a render path. Async callers
// should prefer detectFeeSpread for correct token selection.
export function feeCurrencyFor(isMiniPay: boolean): `0x${string}` | undefined {
  return isMiniPay ? (FEE_CURRENCY_ADAPTERS.USDm as `0x${string}`) : undefined;
}

// Sync spread variant of the above. Stays for back-compat with render-
// path callers; async tx flows should use detectFeeSpread instead.
export function celoFeeSpread(isMiniPay: boolean): Record<string, unknown> {
  const fc = feeCurrencyFor(isMiniPay);
  return fc ? { feeCurrency: fc } : {};
}

// Preferred-stablecoin detection (celopedia minipay-requirements §2
// "Dynamic Adaptation"). Reads the user's USDT and USDC balances over a
// direct HTTP RPC — NOT the MiniPay WebView — then picks the highest
// non-zero balance, falling back to USDm. This is the only stablecoin
// MiniPay funds by default, so USDm is the safe end of the chain.
//
// Returns a {} when not in MiniPay so non-MiniPay callers spread nothing.
export async function detectFeeSpread(
  isMiniPay: boolean,
  account: `0x${string}` | undefined,
): Promise<Record<string, unknown>> {
  if (!isMiniPay) return {};
  if (!account) return { feeCurrency: FEE_CURRENCY_ADAPTERS.USDm };
  try {
    // Direct RPC call so the read doesn't go through the MiniPay
    // WebView. Forno is public and CORS-permissive.
    const balanceOfData = (addr: string) =>
      `0x70a08231000000000000000000000000${addr.slice(2).toLowerCase()}`;
    const call = async (to: string) => {
      const res = await fetch('https://forno.celo.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to, data: balanceOfData(account) }, 'latest'],
        }),
      });
      const j = await res.json();
      return j?.result ? BigInt(j.result) : 0n;
    };
    const [usdt, usdc] = await Promise.all([
      call(STABLECOIN_TOKENS.USDT),
      call(STABLECOIN_TOKENS.USDC),
    ]);
    if (usdt > 0n) return { feeCurrency: FEE_CURRENCY_ADAPTERS.USDT };
    if (usdc > 0n) return { feeCurrency: FEE_CURRENCY_ADAPTERS.USDC };
  } catch {
    // RPC failure — fall through to USDm
  }
  return { feeCurrency: FEE_CURRENCY_ADAPTERS.USDm };
}

export const ERC20_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'value', type: 'uint256' },
      { internalType: 'bytes', name: 'data', type: 'bytes' },
    ],
    name: 'transferAndCall',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const ARENA_PLATFORM_ABI = [
  { type: 'function', name: 'getPlayerMatches', inputs: [{ name: '_player', type: 'address', internalType: 'address' }], outputs: [{ name: '', type: 'uint256[]', internalType: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'hasPlayed', inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }, { name: '', type: 'address', internalType: 'address' }], outputs: [{ name: '', type: 'bool', internalType: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'matchCounter', inputs: [], outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'matches', inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }], outputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }, { name: 'challenger', type: 'address', internalType: 'address' }, { name: 'opponent', type: 'address', internalType: 'address' }, { name: 'wager', type: 'uint256', internalType: 'uint256' }, { name: 'gameType', type: 'uint8', internalType: 'uint8' }, { name: 'status', type: 'uint8', internalType: 'uint8' }, { name: 'winner', type: 'address', internalType: 'address' }, { name: 'createdAt', type: 'uint256', internalType: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'proposeMatch', inputs: [{ name: '_opponent', type: 'address', internalType: 'address' }, { name: '_gameType', type: 'uint8', internalType: 'uint8' }, { name: '_wager', type: 'uint256', internalType: 'uint256' }], outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'playMove', inputs: [{ name: '_matchId', type: 'uint256', internalType: 'uint256' }, { name: '_move', type: 'uint8', internalType: 'uint8' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'cancelMatch', inputs: [{ name: '_matchId', type: 'uint256', internalType: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'playerMoves', inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }, { name: '', type: 'address', internalType: 'address' }], outputs: [{ name: '', type: 'uint8', internalType: 'uint8' }], stateMutability: 'view' },
  { type: 'event', name: 'MatchProposed', inputs: [{ name: 'matchId', type: 'uint256', indexed: true, internalType: 'uint256' }, { name: 'challenger', type: 'address', indexed: true, internalType: 'address' }, { name: 'opponent', type: 'address', indexed: true, internalType: 'address' }, { name: 'wager', type: 'uint256', indexed: false, internalType: 'uint256' }, { name: 'gameType', type: 'uint8', indexed: false, internalType: 'uint8' }], anonymous: false },
  { type: 'event', name: 'MatchAccepted', inputs: [{ name: 'matchId', type: 'uint256', indexed: true, internalType: 'uint256' }, { name: 'opponent', type: 'address', indexed: true, internalType: 'address' }], anonymous: false },
  { type: 'event', name: 'MovePlayed', inputs: [{ name: 'matchId', type: 'uint256', indexed: true, internalType: 'uint256' }, { name: 'player', type: 'address', indexed: true, internalType: 'address' }, { name: 'move', type: 'uint8', indexed: false, internalType: 'uint8' }], anonymous: false },
  { type: 'event', name: 'MatchCompleted', inputs: [{ name: 'matchId', type: 'uint256', indexed: true, internalType: 'uint256' }, { name: 'winner', type: 'address', indexed: true, internalType: 'address' }, { name: 'prize', type: 'uint256', indexed: false, internalType: 'uint256' }], anonymous: false },
] as const;

export const ERC8004_REGISTRY_ABI = [
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'tokenURI', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'agentId', type: 'uint256' }], name: 'getAgentWallet', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

export const SOLO_WAGER_ADDRESS = process.env.NEXT_PUBLIC_SOLO_WAGER_ADDRESS || '';

export const SOLO_WAGER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint8', name: 'gameType', type: 'uint8' },
    ],
    name: 'createWager',
    outputs: [{ internalType: 'uint256', name: 'wagerId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'wagers',
    outputs: [
      { internalType: 'uint256', name: 'id', type: 'uint256' },
      { internalType: 'address', name: 'player', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint8', name: 'gameType', type: 'uint8' },
      { internalType: 'uint8', name: 'status', type: 'uint8' },
      { internalType: 'uint256', name: 'createdAt', type: 'uint256' },
      { internalType: 'uint256', name: 'score', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'wagerId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'bool', name: 'won', type: 'bool' },
      { indexed: false, internalType: 'uint256', name: 'payout', type: 'uint256' },
    ],
    name: 'WagerResolved',
    type: 'event',
  },
] as const;

export const GAME_PASS_ABI = [
  {
    inputs: [{ internalType: 'string', name: 'username', type: 'string' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'newName', type: 'string' }],
    name: 'changeUsername',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'getUsername',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'hasMinted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'username', type: 'string' }],
    name: 'isUsernameAvailable',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'currentSeason',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'season', type: 'uint256' },
      { internalType: 'address', name: 'player', type: 'address' },
      { internalType: 'uint8', name: 'gameType', type: 'uint8' },
    ],
    name: 'weeklyBest',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'player', type: 'address' },
      { internalType: 'uint8', name: 'gameType', type: 'uint8' },
    ],
    name: 'bestScore',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'player', type: 'address' }],
    name: 'gamesPlayed',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'scoreNonces',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint8',   name: 'gameType',         type: 'uint8'   },
      { internalType: 'uint256', name: 'score',            type: 'uint256' },
      { internalType: 'uint256', name: 'nonce',            type: 'uint256' },
      { internalType: 'bytes',   name: 'backendSignature', type: 'bytes'   },
    ],
    name: 'recordScoreWithBackendSig',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
