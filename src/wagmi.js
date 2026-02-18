import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { http } from 'wagmi';

export const fluentTestnet = defineChain({
  id: 20994,
  name: 'Fluent Testnet',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.fluent.xyz/'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Fluent Explorer',
      url: 'https://testnet.fluentscan.xyz',
    },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: 'Chess UI',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'PLACEHOLDER',
  chains: [fluentTestnet],
  transports: {
    [fluentTestnet.id]: http('https://rpc.testnet.fluent.xyz/'),
  },
});
