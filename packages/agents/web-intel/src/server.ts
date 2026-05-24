import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { callAI } from '@agentforge/common';
import { getBlockchainNews, getTechNews, getAINews } from './news.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_PORT || process.env.PORT || '4002');
const PRIVATE_KEY = process.env.WEB_INTEL_PRIVATE_KEY!;
const AGENT_ADDRESS = PRIVATE_KEY
  ? new ethers.Wallet(PRIVATE_KEY).address
  : '0x0000000000000000000000000000000000000000';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelligence', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelligence',
    description: 'News and web research across blockchain, tech, and AI.',
    capabilities: ['news', 'web-search', 'information-retrieval', 'blockchain-news', 'tech-news', 'ai-news', 'research'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    evm_address: AGENT_ADDRESS,
  });
});

app.post('/query', async (req, res) => {
  try {
    const { query = '', instruction, context } = req.body;
    const q = (query || instruction || '').toLowerCase();

    const wantsBlockchain = q.includes('blockchain') || q.includes('crypto') || q.includes('somnia') || q === '';
    const wantsTech = q.includes('tech') || q.includes('technology') || q === '';
    const wantsAI = q.includes('ai') || q.includes('artificial intelligence') || q === '';

    const fetches: Promise<any>[] = [];
    if (wantsBlockchain) fetches.push(getBlockchainNews().catch(() => []));
    if (wantsTech)       fetches.push(getTechNews().catch(() => []));
    if (wantsAI)         fetches.push(getAINews().catch(() => []));

    const newsResults = await Promise.all(fetches);
    const allArticles = newsResults.flat();

    let summary = `Found ${allArticles.length} articles.`;

    if (allArticles.length > 0) {
      const articlesText = allArticles.slice(0, 10).map(a =>
        `- ${a.title}: ${a.description}`.slice(0, 200)
      ).join('\n');

      try {
        summary = await callAI(
          `Extract 3-5 key insights from these news articles relevant to: "${q}"\n\n${articlesText}\n\nReturn a brief bullet-point summary.${context ? `\n\nContext: ${context}` : ''}`,
          'llama-3.1-8b-instant',
          400,
        );
      } catch {
        summary = allArticles.slice(0, 5).map(a => `- ${a.title}`).join('\n');
      }
    }

    res.json({
      result: `${summary}\n\nArticles found: ${allArticles.slice(0, 5).map(a => `- ${a.title}`).join('\n')}`,
      agent: 'WebIntelligence',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelligence] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelligence] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
