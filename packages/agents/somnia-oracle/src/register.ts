import { ethers } from 'ethers';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.SOMNIA_ORACLE_PORT || '4001';
const SELF_URL = process.env.SOMNIA_ORACLE_SELF_URL || `http://localhost:${PORT}`;
const PRIVATE_KEY = process.env.SOMNIA_ORACLE_PRIVATE_KEY!;

let _attempt = 0;

export async function registerSelf(): Promise<void> {
  const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const manifest = {
    agent_id: 'somnia-oracle',
    name: 'SomniaOracle',
    description: 'Live Somnia blockchain data — token prices, account balances, network stats, and DEX data.',
    capabilities: ['blockchain-data', 'crypto-prices', 'somnia-rpc', 'token-data', 'network-stats', 'market-data'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    endpoint: `${SELF_URL}/query`,
    evm_address: wallet.address,
    health_check: `${SELF_URL}/health`,
  };

  try {
    const res = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    if (res.ok) {
      console.log(`[SomniaOracle] Registered with registry at ${REGISTRY_URL}`);
      _attempt = 0;
      setTimeout(registerSelf, 4 * 60 * 1000);
    } else {
      scheduleRetry('SomniaOracle');
    }
  } catch {
    scheduleRetry('SomniaOracle');
  }
}

function scheduleRetry(label: string): void {
  const delays = [5000, 15000, 30000, 60000];
  const delay = delays[Math.min(_attempt, delays.length - 1)];
  console.warn(`[${label}] Registry unavailable, retrying in ${delay / 1000}s...`);
  _attempt++;
  setTimeout(registerSelf, delay);
}
