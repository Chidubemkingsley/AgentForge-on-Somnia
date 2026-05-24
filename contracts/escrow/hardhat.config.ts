import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    somniaTestnet: {
      url: process.env.SOMNIA_RPC_URL || 'https://api.infra.testnet.somnia.network',
      chainId: 50312,
      accounts: process.env.PLATFORM_PRIVATE_KEY ? [process.env.PLATFORM_PRIVATE_KEY] : [],
    },
    somniaMainnet: {
      url: process.env.SOMNIA_MAINNET_RPC_URL || 'https://api.infra.mainnet.somnia.network',
      chainId: 5031,
      accounts: process.env.PLATFORM_PRIVATE_KEY ? [process.env.PLATFORM_PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: '.',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
