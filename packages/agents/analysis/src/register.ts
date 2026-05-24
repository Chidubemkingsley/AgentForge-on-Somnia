import { ethers } from 'ethers';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.ANALYSIS_AGENT_PORT || '4004';
const SELF_URL = process.env.ANALYSIS_AGENT_SELF_URL || `http://localhost:${PORT}`;
const PRIVATE_KEY = process.env.ANALYSIS_AGENT_PRIVATE_KEY!;

let _attempt = 0;

export async function registerSelf(): Promise<void> {
  const wallet = new ethers.Wallet(PRIVATE_KEY);

  const manifest = {
    agent_id: 'analysis-agent',
    name: 'AnalysisBot',
    description: 'AI-powered data analysis and trend identification. Identifies risks, insights, and patterns from structured data.',
    capabilities: ['data-analysis', 'comparison', 'trend-analysis', 'sentiment-analysis', 'risk-assessment'],
    pricing: { model: 'free', price_per_call: 0.005, currency: 'USDC' },
    endpoint: `${SELF_URL}/analyze`,
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
      console.log(`[AnalysisBot] Registered with registry at ${REGISTRY_URL}`);
      _attempt = 0;
      setTimeout(registerSelf, 4 * 60 * 1000);
    } else {
      scheduleRetry('AnalysisBot');
    }
  } catch {
    scheduleRetry('AnalysisBot');
  }
}

function scheduleRetry(label: string): void {
  const delays = [5000, 15000, 30000, 60000];
  const delay = delays[Math.min(_attempt, delays.length - 1)];
  console.warn(`[${label}] Registry unavailable, retrying in ${delay / 1000}s...`);
  _attempt++;
  setTimeout(registerSelf, delay);
}
