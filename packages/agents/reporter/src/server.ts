import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { generateReport } from './report.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.REPORT_AGENT_PORT || process.env.PORT || '4005');
const PRIVATE_KEY = process.env.REPORT_AGENT_PRIVATE_KEY!;
const AGENT_ADDRESS = PRIVATE_KEY
  ? new ethers.Wallet(PRIVATE_KEY).address
  : '0x0000000000000000000000000000000000000000';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'ReporterBot', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'ReporterBot',
    description: 'AI-powered report writer. Converts data into structured markdown reports.',
    capabilities: ['report-writing', 'formatting', 'summarization', 'document-generation'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    evm_address: AGENT_ADDRESS,
  });
});

app.post('/report', async (req, res) => {
  try {
    const { data, instruction, context } = req.body;

    let reportInput = '';
    if (instruction) reportInput += `Instruction: ${instruction}\n\n`;
    if (context) reportInput += `Context:\n${context}\n\n`;
    if (data) reportInput += typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    if (!reportInput.trim()) {
      return res.status(400).json({ error: 'Provide data, instruction, or context' });
    }

    const report = await generateReport(reportInput);
    res.json({ result: report, agent: 'ReporterBot', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[ReporterBot] Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ReporterBot] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
