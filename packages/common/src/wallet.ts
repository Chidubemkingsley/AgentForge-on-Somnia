import { ethers } from 'ethers';

export function loadWallet(privateKeyEnvVar: string): ethers.Wallet {
  const key = process.env[privateKeyEnvVar];
  if (!key) {
    throw new Error(`Missing environment variable: ${privateKeyEnvVar}`);
  }
  const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(key, provider);
}

export function getAddress(privateKeyEnvVar: string): string {
  return loadWallet(privateKeyEnvVar).address;
}

export function walletFromPrivateKey(key: string, rpcUrl?: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl || 'https://testnet.somnia.network');
  return new ethers.Wallet(key, provider);
}
