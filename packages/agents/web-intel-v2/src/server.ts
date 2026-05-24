import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { getBlockchainNews } from './news.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_V2_PORT || process.env.PORT || '4003');
const PRIVATE_KEY = process.env.WEB_INTEL_V2_PRIVATE_KEY!;
const AGENT_ADDRESS = PRIVATE_KEY
  ? new ethers.Wallet(PRIVATE_KEY).address
  : '0x0000000000000000000000000000000000000000';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelV2', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelV2',
    description: 'Lightweight blockchain news fetcher.',
    capabilities: ['news', 'blockchain-news', 'information-retrieval'],
    pricing: { model: 'free', price_per_call: 0.01, currency: 'USDC' },
    evm_address: AGENT_ADDRESS,
  });
});

app.post('/query', async (req, res) => {
  try {
    const articles = await getBlockchainNews();
    const summary = articles.length > 0
      ? articles.slice(0, 5).map(a => `- ${a.title}: ${a.description}`).join('\n')
      : 'No articles found from news feed at this time.';

    res.json({
      result: summary,
      agent: 'WebIntelV2',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelV2] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelV2] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
