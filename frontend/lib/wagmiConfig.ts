import { http } from 'wagmi';
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

export const supportedChains = [customCelo] as const;

export const wagmiConfig = createConfig({
  chains: [customCelo],
  connectors: [injected()],
  transports: {
    [customCelo.id]: http('https://forno.celo.org'),
  },
  pollingInterval: 30_000,
  batch: { multicall: true },
});
