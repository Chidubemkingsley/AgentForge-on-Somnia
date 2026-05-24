export const SOMNIA_TESTNET_RPC = 'https://api.infra.testnet.somnia.network';
export const SOMNIA_MAINNET_RPC = 'https://api.infra.mainnet.somnia.network';
export const SOMNIA_TESTNET_CHAIN_ID = 50312;
export const SOMNIA_MAINNET_CHAIN_ID = 5031;

export const USDC_CONTRACT_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x5D4266f4DD721c1cD8367FEb23E4940d17C83C93';
export const USDC_DECIMALS = 6;

export const BLOCK_EXPLORER = 'https://shannon-explorer.somnia.network';

export const txExplorerUrl = (hash: string) => `${BLOCK_EXPLORER}/tx/${hash}`;
export const accountExplorerUrl = (addr: string) => `${BLOCK_EXPLORER}/address/${addr}`;
export const escrowViewerUrl = (contractId: string) =>
  `${BLOCK_EXPLORER}/address/${contractId}`;
