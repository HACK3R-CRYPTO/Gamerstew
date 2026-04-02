import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { celo } from '@reown/appkit/networks'


// Get project ID from https://cloud.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || 'YOUR_PROJECT_ID'

// Define Celo network with explicit public RPC to avoid Reown 403 CORS issues
const customCelo = {
  ...celo,
  rpcUrls: {
    default: { http: ['https://forno.celo.org'] },
    public: { http: ['https://forno.celo.org'] },
  }
}

const metadata = {
  name: 'GameArena',
  description: 'Competitive Gaming on Celo with GoodDollar',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://gamearena.xyz',
  icons: ['https://avatars.githubusercontent.com/u/37784886']
}

const networks = [customCelo]

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: false,
})

createAppKit({
  adapters: [wagmiAdapter],
  networks: [customCelo],
  defaultNetwork: customCelo,
  projectId,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
    smartSessions: false,
    onramp: false,
    swaps: false
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#7b2ff7'
  }
})

export const config = wagmiAdapter.wagmiConfig
