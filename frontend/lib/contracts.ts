// Contract addresses
export const CONTRACT_ADDRESSES = {
  ARENA_PLATFORM: '0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE',
  AI_AGENT: process.env.NEXT_PUBLIC_AI_AGENT_ADDRESS || '0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1',
  ERC8004_REGISTRY: process.env.NEXT_PUBLIC_ERC8004_REGISTRY || '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  ERC8004_REPUTATION: process.env.NEXT_PUBLIC_ERC8004_REPUTATION || '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  AGENT_TOKEN_ID: process.env.NEXT_PUBLIC_AGENT_TOKEN_ID || null,
  G_TOKEN: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
  GAME_PASS: '0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE',
};

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
