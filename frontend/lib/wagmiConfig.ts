import { fallback, http } from 'wagmi';
import { createConfig } from '@privy-io/wagmi';
import { celo } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const customCelo = {
  ...celo,
  rpcUrls: {
    default: { http: ['https://forno.celo.org'] },
    public: { http: ['https://forno.celo.org'] },
  },
};

// Mainnet only. The product ships against Celo mainnet (chainId 42220);
// no testnet in prod so we don't leak a dev chain into production wallets.
export const supportedChains = [customCelo] as const;

export const wagmiConfig = createConfig({
  chains: [customCelo],
  // shimDisconnect: false — MiniPay has no disconnect UX; without this
  // the wagmi shim can wedge in a stale "disconnected" state when the
  // MiniPay tab is reopened, which looks to users like the auto-connect
  // broke.
  connectors: [injected({ shimDisconnect: false })],
  // Multi-RPC fallback — if Forno throttles or goes down, wagmi fails over
  // to Ankr then 1rpc then wagmi's default. One bad node no longer stalls
  // the whole app, which matters on MiniPay where users cannot refresh
  // easily.
  transports: {
    [customCelo.id]: fallback([
      http('https://forno.celo.org'),
      http('https://rpc.ankr.com/celo'),
      http('https://1rpc.io/celo'),
      http(),
    ]),
  },
  pollingInterval: 30_000,
  batch: { multicall: true },
});
