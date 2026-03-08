import ArenaPlatformABIJson from './ArenaPlatformABI.json';

// Contract addresses
export const CONTRACT_ADDRESSES = {
  ARENA_PLATFORM: '0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE', // Just deployed to Celo Mainnet
  AI_AGENT: import.meta.env.VITE_AI_AGENT_ADDRESS || '0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1',
  AGENT_REGISTRY: import.meta.env.VITE_AGENT_REGISTRY_ADDRESS || "0x30e56137F118EE75D64b13C322261f8AB955A5d1",
  G_TOKEN: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', // GoodDollar on Celo
};

export const AGENT_REGISTRY_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "agents",
    "outputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "model", "type": "string" },
      { "internalType": "string", "name": "description", "type": "string" },
      { "internalType": "string", "name": "metadataUri", "type": "string" },
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "uint256", "name": "registeredAt", "type": "uint256" },
      { "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];


export const GAME_LOTTERY_ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
      { "indexed": false, "internalType": "enum GameLottery.PrizeType", "name": "pType", "type": "uint8" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "assetId", "type": "uint256" },
      { "indexed": false, "internalType": "string", "name": "assetName", "type": "string" }
    ],
    "name": "PrizeWon",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_ticketCount", "type": "uint256" }],
    "name": "enterLottery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ticketPrice",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

export const GAME_ASSETS_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "id", "type": "uint256" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "uint256", "name": "assetType", "type": "uint256" },
      { "internalType": "bytes", "name": "data", "type": "bytes" }
    ],
    "name": "mintAsset",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "account", "type": "address" },
      { "internalType": "uint256", "name": "id", "type": "uint256" }
    ],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

export const ERC20_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "transfer",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "to", "type": "address" },
      { "internalType": "uint256", "name": "value", "type": "uint256" },
      { "internalType": "bytes", "name": "data", "type": "bytes" }
    ],
    "name": "transferAndCall",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

export const ARENA_PLATFORM_ABI = ArenaPlatformABIJson;

// ABIs - Import from compiled contract artifacts
export const TOURNAMENT_PLATFORM_ABI = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_treasury", "type": "address", "internalType": "address" },
      { "name": "_winnerBadge", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_PARTICIPANTS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_ENTRY_FEE",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_PARTICIPANTS",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelTournament",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createTournament",
    "inputs": [
      { "name": "_name", "type": "string", "internalType": "string" },
      { "name": "_description", "type": "string", "internalType": "string" },
      { "name": "_entryFee", "type": "uint256", "internalType": "uint256" },
      { "name": "_maxParticipants", "type": "uint256", "internalType": "uint256" },
      { "name": "_startTime", "type": "uint256", "internalType": "uint256" },
      { "name": "_endTime", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeAndDistribute",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getParticipantScore",
    "inputs": [
      { "name": "_tournamentId", "type": "uint256", "internalType": "uint256" },
      { "name": "_participant", "type": "address", "internalType": "address" }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TournamentPlatform.ParticipantScore",
        "components": [
          { "name": "participant", "type": "address", "internalType": "address" },
          { "name": "score", "type": "uint256", "internalType": "uint256" },
          { "name": "survivalTime", "type": "uint256", "internalType": "uint256" },
          { "name": "killCount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPlayerTournaments",
    "inputs": [{ "name": "_player", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256[]", "internalType": "uint256[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTournament",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TournamentPlatform.Tournament",
        "components": [
          { "name": "id", "type": "uint256", "internalType": "uint256" },
          { "name": "name", "type": "string", "internalType": "string" },
          { "name": "description", "type": "string", "internalType": "string" },
          { "name": "creator", "type": "address", "internalType": "address" },
          { "name": "entryFee", "type": "uint256", "internalType": "uint256" },
          { "name": "maxParticipants", "type": "uint256", "internalType": "uint256" },
          { "name": "startTime", "type": "uint256", "internalType": "uint256" },
          { "name": "endTime", "type": "uint256", "internalType": "uint256" },
          { "name": "prizePool", "type": "uint256", "internalType": "uint256" },
          { "name": "status", "type": "uint8", "internalType": "enum TournamentPlatform.TournamentStatus" },
          { "name": "resultsSubmitted", "type": "bool", "internalType": "bool" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTournamentParticipants",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address[]", "internalType": "address[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTournamentStatus",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "enum TournamentPlatform.TournamentStatus" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getTournamentWinners",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address[]", "internalType": "address[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasJoined",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "joinTournament",
    "inputs": [{ "name": "_tournamentId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "participantScores",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "address", "internalType": "address" }
    ],
    "outputs": [
      { "name": "participant", "type": "address", "internalType": "address" },
      { "name": "score", "type": "uint256", "internalType": "uint256" },
      { "name": "survivalTime", "type": "uint256", "internalType": "uint256" },
      { "name": "killCount", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "platformFeePercent",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "platformTreasury",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "playerTournaments",
    "inputs": [
      { "name": "", "type": "address", "internalType": "address" },
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitScore",
    "inputs": [
      { "name": "_tournamentId", "type": "uint256", "internalType": "uint256" },
      { "name": "_survivalTime", "type": "uint256", "internalType": "uint256" },
      { "name": "_killCount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tournamentCounter",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tournamentParticipants",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tournamentWinners",
    "inputs": [
      { "name": "", "type": "uint256", "internalType": "uint256" },
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tournaments",
    "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "id", "type": "uint256", "internalType": "uint256" },
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "description", "type": "string", "internalType": "string" },
      { "name": "creator", "type": "address", "internalType": "address" },
      { "name": "entryFee", "type": "uint256", "internalType": "uint256" },
      { "name": "maxParticipants", "type": "uint256", "internalType": "uint256" },
      { "name": "startTime", "type": "uint256", "internalType": "uint256" },
      { "name": "endTime", "type": "uint256", "internalType": "uint256" },
      { "name": "prizePool", "type": "uint256", "internalType": "uint256" },
      { "name": "status", "type": "uint8", "internalType": "enum TournamentPlatform.TournamentStatus" },
      { "name": "resultsSubmitted", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [{ "name": "newOwner", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updatePlatformFee",
    "inputs": [{ "name": "_newFeePercent", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateTreasury",
    "inputs": [{ "name": "_newTreasury", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateWinnerBadge",
    "inputs": [{ "name": "_newBadgeContract", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "winnerBadge",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "contract WinnerBadge" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "BadgesMinted",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "winnersCount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      { "name": "previousOwner", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "newOwner", "type": "address", "indexed": true, "internalType": "address" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ParticipantJoined",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "participant", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "entryFee", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PlatformFeeUpdated",
    "inputs": [
      { "name": "newFeePercent", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PrizesDistributed",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "totalPrizes", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "platformFee", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ResultsFinalized",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "totalParticipants", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ScoreSubmitted",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "participant", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "score", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "survivalTime", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "killCount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TournamentCancelled",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "refundedAmount", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TournamentCreated",
    "inputs": [
      { "name": "tournamentId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "creator", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "name", "type": "string", "indexed": false, "internalType": "string" },
      { "name": "entryFee", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "maxParticipants", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "startTime", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "endTime", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryUpdated",
    "inputs": [
      { "name": "newTreasury", "type": "address", "indexed": false, "internalType": "address" }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WinnerBadgeUpdated",
    "inputs": [
      { "name": "newBadgeContract", "type": "address", "indexed": false, "internalType": "address" }
    ],
    "anonymous": false
  }
];

export const WINNER_BADGE_ABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "winner", "type": "address" },
      { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "tournamentId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "position", "type": "uint256" }
    ],
    "name": "BadgeMinted",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "_winner", "type": "address" },
      { "internalType": "uint256", "name": "_tournamentId", "type": "uint256" },
      { "internalType": "uint256", "name": "_position", "type": "uint256" },
      { "internalType": "uint256", "name": "_score", "type": "uint256" },
      { "internalType": "string", "name": "_tournamentName", "type": "string" }
    ],
    "name": "mintBadge",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "tokenURI",
    "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

export const ARCADE_PLATFORM_ABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "_score", "type": "uint256" }],
    "name": "submitScore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getLeaderboard",
    "outputs": [
      {
        "components": [
          { "internalType": "address", "name": "player", "type": "address" },
          { "internalType": "uint256", "name": "score", "type": "uint256" }
        ],
        "internalType": "struct ArcadePlatform.PlayerScore[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "highScores",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getPlayerCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];



// Chain IDs
export const SEPOLIA_CHAIN_ID = 11155111;
export const MONAD_TESTNET_CHAIN_ID = 10143;
