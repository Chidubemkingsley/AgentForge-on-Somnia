import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.SOMNIA_ORACLE_PORT || process.env.PORT || '4001');
const PRIVATE_KEY = process.env.SOMNIA_ORACLE_PRIVATE_KEY!;

if (!PRIVATE_KEY) {
  console.error('[SomniaOracle] SOMNIA_ORACLE_PRIVATE_KEY not set');
  process.exit(1);
}

const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const AGENT_ADDRESS = wallet.address;

const ESCROW_ABI = [
  'function getEscrow(string memory escrowId) external view returns (tuple(string title, string description, address platform, address serviceProvider, address approver, address disputeResolver, address releaseSigner, uint8 status, uint256 totalFunded, uint256 totalReleased, tuple(string description, uint256 amount, address receiver, uint8 status, string evidence, address agentAddress)[] milestones))',
  'function usdc() external view returns (address)',
  'event EscrowDeployed(string escrowId, string title, address indexed platform, address indexed serviceProvider, address indexed approver)',
  'event EscrowFunded(string escrowId, address indexed funder, uint256 amount)',
  'event MilestoneCompleted(string escrowId, uint256 indexed milestoneIndex, address indexed agent)',
  'event MilestoneApproved(string escrowId, uint256 indexed milestoneIndex, address indexed approver)',
  'event FundsReleased(string escrowId, uint256 indexed milestoneIndex, address indexed receiver, uint256 amount)',
  'event DisputeStarted(string escrowId, uint256 indexed milestoneIndex, address indexed initiator)',
  'event DisputeResolved(string escrowId, uint256 indexed milestoneIndex, address indexed resolver)',
];

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'SomniaOracle', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'SomniaOracle',
    description: 'Live Somnia blockchain data — token prices, account balances, DEX data, network stats',
    capabilities: ['blockchain-data', 'crypto-prices', 'somnia-rpc', 'token-data', 'network-stats', 'market-data'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    evm_address: AGENT_ADDRESS,
  });
});

app.post('/escrow-state', async (req, res) => {
  try {
    const { escrowId } = req.body;
    if (!escrowId) return res.status(400).json({ error: 'escrowId required' });

    const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || '';
    if (!escrowAddress) return res.status(500).json({ error: 'ESCROW_CONTRACT_ADDRESS not set' });

    const contract = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);
    const escrow = await contract.getEscrow(escrowId);

    const statusLabels = ['Active', 'Funded', 'Completed', 'Disputed', 'Resolved'];
    res.json({
      status: 'ok',
      escrow_id: escrowId,
      title: escrow.title,
      platform: escrow.platform,
      service_provider: escrow.serviceProvider,
      approver: escrow.approver,
      dispute_resolver: escrow.disputeResolver,
      release_signer: escrow.releaseSigner,
      status_code: Number(escrow.status),
      status_label: statusLabels[Number(escrow.status)] ?? 'Unknown',
      total_funded: ethers.formatUnits(escrow.totalFunded, 6),
      total_released: ethers.formatUnits(escrow.totalReleased, 6),
      milestone_count: escrow.milestones.length,
      milestones: escrow.milestones.map((m: any, i: number) => ({
        index: i,
        description: m.description,
        amount: ethers.formatUnits(m.amount, 6),
        receiver: m.receiver,
        status_code: Number(m.status),
        status_label: ['Pending', 'Completed', 'Approved', 'Rejected', 'Disputed'][Number(m.status)] ?? 'Unknown',
        evidence: m.evidence,
        agent: m.agentAddress,
      })),
      read_by_agent: AGENT_ADDRESS,
      read_at: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/query', async (req, res) => {
  try {
    const { query = '', instruction, context } = req.body;
    const q = (query || instruction || '').toLowerCase();

    const wantsBalances = q.includes('balance') || q.includes('account');
    const wantsNetwork  = q.includes('network') || q.includes('block') || q.includes('stats') || q === '';

    const lines: string[] = [
      '# Somnia Oracle — Somnia Testnet Data',
      `*Network: Somnia Testnet (Chain ID: 50312)*`,
      `*RPC: ${rpcUrl}*`,
      '',
    ];

    if (wantsNetwork) {
      const blockNumber = await provider.getBlockNumber();
      const gasPrice = await provider.getFeeData();

      lines.push('## Network Stats');
      lines.push(`- **Latest block**: ${blockNumber}`);
      lines.push(`- **Gas price**: ${gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') : 'N/A'} Gwei`);
      lines.push('');
    }

    if (wantsBalances) {
      const addressMatch = (query || instruction || '').match(/0x[a-fA-F0-9]{40}/);
      if (addressMatch) {
        const targetAddress = addressMatch[0];
        const balance = await provider.getBalance(targetAddress);
        const usdcAddress = process.env.USDC_CONTRACT_ADDRESS || '0x5D4266f4DD721c1cD8367FEb23E4940d17C83C93';
        lines.push(`## Account: ${targetAddress}`);
        lines.push(`- **SOMI Balance**: ${ethers.formatEther(balance)} SOMI`);

        try {
          const usdcAbi = ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
          const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
          const usdcBalance = await usdc.balanceOf(targetAddress);
          const usdcSymbol = await usdc.symbol();
          const usdcDecimals = await usdc.decimals();
          const formattedUsdc = ethers.formatUnits(usdcBalance, usdcDecimals);
          lines.push(`- **${usdcSymbol} Balance**: ${formattedUsdc}`);
        } catch {
          lines.push(`- *USDC balance query failed*`);
        }
        lines.push('');
      }
    }

    lines.push(`*Data fetched at ${new Date().toISOString()} via Somnia RPC*`);
    const markdownResult = lines.join('\n');

    res.json({ result: markdownResult, agent: 'SomniaOracle', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[SomniaOracle] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[SomniaOracle] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
