import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { ethers } from 'ethers';
import type { AgentRecord } from '@agentforge/common';
import { accountExplorerUrl, escrowViewerUrl } from '@agentforge/common';
import { checkFeasibility } from './capability-check.js';
import { createPlan } from './planner.js';
import { PlanExecutor } from './executor.js';
import { scoreAgents } from './selector.js';
import * as activityStore from './activity-store.js';
import { appendEscrowTx, getEscrowLedger } from './escrow-ledger.js';
import { saveTaskResult, getTaskResults, deleteTaskResult } from './task-results.js';
import { getEscrow } from './somnia-client.js';

const __dirname = path.dirname(path.resolve(process.argv[1]));

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || process.env.PORT || '5000');
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const BUDGET_DEFAULT = parseFloat(process.env.DEFAULT_BUDGET || '1.0');
const APPROVAL_TIMEOUT_MS = parseInt(process.env.PLAN_APPROVAL_TIMEOUT_MS || '60000');
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

if (!process.env.PLATFORM_PRIVATE_KEY) {
  console.error('[Orchestrator] PLATFORM_PRIVATE_KEY not set');
  process.exit(1);
}

const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const platformWallet = new ethers.Wallet(process.env.PLATFORM_PRIVATE_KEY, provider);
const PLATFORM_ADDRESS = platformWallet.address;

const activeExecutors = new Map<string, import('./executor.js').PlanExecutor>();

async function fetchAgents(): Promise<AgentRecord[]> {
  const response = await fetch(`${REGISTRY_URL}/agents`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Registry returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : data.agents ?? [];
}

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(event: string, data: unknown) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Orchestrator] Unhandled rejection:', reason);
});

interface PendingApproval {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

function waitForApproval(task_id: string, planPayload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingApprovals.has(task_id)) {
        pendingApprovals.delete(task_id);
        broadcast('plan_auto_approved', { task_id, reason: 'timeout' });
        resolve();
      }
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(task_id, { resolve, reject, timer });
    broadcast('plan_approval_required', planPayload);
  });
}

interface EscrowFundingDetails {
  contractId: string;
  totalUsdc: number;
}
const escrowFundingDetails = new Map<string, EscrowFundingDetails>();

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const dashboardPath = path.join(__dirname, '..', 'public');
app.use(express.static(dashboardPath));
app.get('/', (_req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not built. Run: npm run build:dashboard' });
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agent: 'AgentForge Orchestrator',
    platform_address: PLATFORM_ADDRESS,
    network: 'somnia:testnet',
    explorer_url: accountExplorerUrl(PLATFORM_ADDRESS),
  });
});

app.post('/api/register', express.json(), async (req, res) => {
  try {
    const { signature, signed_message, evm_address } = req.body as {
      signature?: string; signed_message?: string; evm_address?: string;
    };

    if (!signature || !signed_message || !evm_address) {
      return res.status(400).json({ error: 'Missing signature, signed_message, or evm_address' });
    }

    const recovered = ethers.verifyMessage(signed_message, signature);
    if (recovered.toLowerCase() !== evm_address.toLowerCase()) {
      return res.status(403).json({ error: 'Signature does not match evm_address' });
    }

    const { signature: _sig, signed_message: _msg, ...cleanBody } = req.body;
    const response = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanBody),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Registry unreachable: ${err.message}` });
  }
});

app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await fetchAgents();
    res.json({ agents, count: agents.length });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

app.get('/api/wallets', (_req, res) => {
  res.json({
    platform: {
      address: PLATFORM_ADDRESS,
      network: 'somnia:testnet',
      explorer_url: accountExplorerUrl(PLATFORM_ADDRESS),
      role: 'platform + releaseSigner',
    },
    verifier: {
      address: process.env.VERIFIER_PRIVATE_KEY
        ? new ethers.Wallet(process.env.VERIFIER_PRIVATE_KEY, provider).address
        : null,
      role: 'approver',
    },
    arbiter: {
      address: process.env.ARBITER_PRIVATE_KEY
        ? new ethers.Wallet(process.env.ARBITER_PRIVATE_KEY, provider).address
        : null,
      role: 'disputeResolver',
    },
  });
});

app.post('/api/faucet', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Valid wallet address required' });
    }
    const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS;
    if (!USDC_ADDRESS) return res.status(500).json({ error: 'USDC_CONTRACT_ADDRESS not set' });
    const usdcAbi = ['function mint(address to, uint256 amount) external'];
    const usdc = new ethers.Contract(USDC_ADDRESS, usdcAbi, platformWallet);
    const amount = ethers.parseUnits('1000', 6);
    const tx = await usdc.mint(address, amount);
    const receipt = await tx.wait();
    res.json({
      success: true,
      txHash: receipt?.hash || tx.hash,
      amount: '1000',
      explorerUrl: `https://shannon-explorer.somnia.network/tx/${receipt?.hash || tx.hash}`,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/escrow/:contractId', async (req, res) => {
  try {
    const data = await getEscrow(req.params.contractId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/stats/pulse', (_req, res) => {
  res.json(activityStore.getPulse());
});

app.get('/api/activity/:user_address', (req, res) => {
  const events = activityStore.getForUser(req.params.user_address, 50);
  res.json({ events });
});

app.get('/api/escrow-ledger/:user_address', (req, res) => {
  const entries = getEscrowLedger(req.params.user_address, 100);
  res.json({ entries });
});

app.get('/api/tasks/history/:user_address', (req, res) => {
  const results = getTaskResults(req.params.user_address, 50);
  res.json({ results });
});

app.delete('/api/tasks/history/:task_id', (req, res) => {
  const user_address = req.query.user_address as string | undefined;
  if (!user_address) return res.status(400).json({ error: 'user_address query param is required' });
  const results = getTaskResults(user_address, 1000);
  const owned = results.some(r => r.task_id === req.params.task_id);
  if (!owned) return res.status(403).json({ error: 'Not authorised or task not found' });
  const deleted = deleteTaskResult(req.params.task_id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

app.post('/api/tasks/preview', async (req, res) => {
  const { task, budget } = req.body as { task?: string; budget?: number };
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }
  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;

  let agents: AgentRecord[];
  try { agents = await fetchAgents(); }
  catch (err: any) { return res.status(503).json({ error: 'registry_unavailable', message: err.message }); }
  if (agents.length === 0) return res.status(503).json({ error: 'no_agents', message: 'No agents registered' });

  let feasibility;
  try { feasibility = await checkFeasibility(task, agents); }
  catch (err: any) { return res.status(500).json({ error: 'feasibility_failed', message: err.message }); }

  if (!feasibility.feasible) {
    return res.json({ feasible: false, missing: feasibility.missing });
  }

  let plan;
  try { plan = await createPlan(task, agents, taskBudget); }
  catch (err: any) { return res.status(500).json({ error: 'planning_failed', message: err.message }); }

  return res.json({
    feasible: true,
    total_estimated_cost: plan.total_estimated_cost,
    milestones: plan.milestones.map(m => ({ title: m.title, description: m.description, amount: m.amount })),
    reasoning: plan.reasoning,
    selected_agent_id: plan.selected_agent_id,
    over_budget: plan.total_estimated_cost > taskBudget,
    budget: taskBudget,
  });
});

app.post('/api/tasks', async (req, res) => {
  const { task, budget, user_address, human_override_approver, human_override_resolver } = req.body as {
    task?: string;
    budget?: number;
    user_address?: string;
    human_override_approver?: string;
    human_override_resolver?: string;
  };

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }

  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;
  const task_id = uuidv4();

  res.status(202).json({ status: 'accepted', task_id, task, budget: taskBudget });
  broadcast('task_accepted', { task_id, task, budget: taskBudget });

  runTask(task_id, task, taskBudget, user_address ?? null, {
    humanOverride: {
      approver: human_override_approver,
      disputeResolver: human_override_resolver,
    },
  }).catch(err => {
    console.error('[Orchestrator] Task pipeline error:', err.message);
    broadcast('task_error', { task_id, task, error: err.message });
  });
});

app.post('/api/tasks/:id/approve', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) return res.status(404).json({ error: 'No pending approval for this task' });
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_approved', { task_id: id });
  pending.resolve();
  res.json({ status: 'approved', task_id: id });
});

app.post('/api/tasks/:id/reject', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) return res.status(404).json({ error: 'No pending approval for this task' });
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_rejected', { task_id: id });
  pending.reject(new Error('Plan rejected by user'));
  res.json({ status: 'rejected', task_id: id });
});

app.post('/api/tasks/:id/fund-confirm', async (req, res) => {
  const { id } = req.params;
  const { usePlatformFunds } = req.body as { usePlatformFunds?: boolean };
  const executor = activeExecutors.get(id);
  if (!executor) return res.status(404).json({ error: 'No active task' });

  try {
    if (usePlatformFunds) {
      const details = escrowFundingDetails.get(id);
      if (!details?.contractId) {
        return res.status(400).json({ error: 'No escrow details on record for this task' });
      }
      const { fundEscrow } = await import('./somnia-client.js');
      const txHash = await fundEscrow(details.contractId, platformWallet, details.totalUsdc.toFixed(6));
      broadcast('escrow_funded', { task_id: id, tx_hash: txHash, funded_by: 'platform' });
    }

    escrowFundingDetails.delete(id);
    executor.resolveFunding(id);
    res.json({ status: 'funded', task_id: id });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/milestones/:idx/human-approve', (req, res) => {
  const { id, idx } = req.params;
  const { signedTx } = req.body as { signedTx?: string };
  const executor = activeExecutors.get(id);
  if (!executor) return res.status(404).json({ error: 'No active task' });
  executor.resolveHumanDecision(id, parseInt(idx, 10), { approved: true, signedTx });
  broadcast('human_approved', { task_id: id, milestone_index: parseInt(idx, 10) });
  res.json({ status: 'approved' });
});

app.post('/api/tasks/:id/milestones/:idx/human-reject', (req, res) => {
  const { id, idx } = req.params;
  const executor = activeExecutors.get(id);
  if (!executor) return res.status(404).json({ error: 'No active task' });
  executor.resolveHumanDecision(id, parseInt(idx, 10), { approved: false });
  broadcast('human_rejected', { task_id: id, milestone_index: parseInt(idx, 10) });
  res.json({ status: 'rejected' });
});

async function runTask(
  task_id: string,
  task: string,
  budget: number,
  userAddress: string | null,
  options: { humanOverride?: { approver?: string; disputeResolver?: string } },
): Promise<void> {
  let agents: AgentRecord[];
  try {
    agents = await fetchAgents();
    broadcast('agents_loaded', { task_id, count: agents.length });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Registry unavailable: ${err.message}` });
    return;
  }

  if (agents.length === 0) {
    broadcast('task_error', { task_id, task, error: 'No agents registered' });
    return;
  }

  const allScored = scoreAgents(agents, [], budget / Math.max(1, agents.length));
  broadcast('agents_scored', {
    task_id,
    agents: allScored.map(s => ({
      agent_id: s.agent.agent_id,
      name: s.agent.name,
      score: s.score,
      reputation_score: s.agent.reputation?.score ?? 50,
      price_per_call: s.agent.pricing.price_per_call,
    })),
  });

  let feasibility;
  try {
    feasibility = await checkFeasibility(task, agents);
    broadcast('feasibility_checked', { task_id, ...feasibility });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Feasibility check failed: ${err.message}` });
    return;
  }

  if (!feasibility.feasible) {
    broadcast('task_infeasible', { task_id, task, missing: feasibility.missing });
    return;
  }

  let plan;
  try {
    plan = await createPlan(task, agents, budget);
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Planning failed: ${err.message}` });
    return;
  }

  broadcast('plan_created', {
    task_id,
    milestone_count: plan.milestones.length,
    total_estimated_cost: plan.total_estimated_cost,
    reasoning: plan.reasoning,
    milestones: plan.milestones,
    selected_agent_id: plan.selected_agent_id,
  });

  try {
    await waitForApproval(task_id, {
      task_id,
      task,
      reasoning: plan.reasoning,
      total_estimated_cost: plan.total_estimated_cost,
      milestones: plan.milestones,
      auto_approve_in_ms: APPROVAL_TIMEOUT_MS,
    });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Plan rejected: ${err.message}` });
    return;
  }

  if (userAddress) {
    activityStore.append({
      user_address: userAddress,
      event: 'task_started',
      task_id,
      task_description: task,
    });
  }

  const executor = new PlanExecutor(agents);
  activeExecutors.set(task_id, executor);

  executor.on('human_review_required', data => broadcast('human_review_required', data));
  executor.on('escrow_deployed', data => {
    broadcast('escrow_deployed', { task_id, ...data });
    if (userAddress && data.contract_id) {
      activityStore.append({
        user_address: userAddress,
        event: 'escrow_deployed',
        task_id,
        task_description: task,
        escrow_contract_id: data.contract_id,
      });
      appendEscrowTx({
        user_address: userAddress,
        type: 'deploy',
        escrow_contract_id: data.contract_id,
        tx_hash: data.tx_hash,
        task_id,
      });
    }
  });

  executor.on('funding_required', data => {
    broadcast('funding_required', { task_id, ...data });
  });

  executor.on('task_started', data => broadcast('task_started', data));
  executor.on('milestone_started', data => broadcast('milestone_started', data));
  executor.on('agent_output', data => broadcast('agent_output', data));
  executor.on('milestone_marked', data => broadcast('milestone_marked', data));
  executor.on('verifying', data => broadcast('verifying', data));
  executor.on('verified', data => broadcast('verified', data));
  executor.on('milestone_released', data => {
    broadcast('milestone_released', data);
    if (userAddress && data.tx_hash) {
      activityStore.append({
        user_address: userAddress,
        event: 'milestone_released',
        task_id,
        task_description: task,
        amount_usdc: data.amount,
        milestone_index: data.milestone_index,
      });
    }
  });
  executor.on('milestone_rejected', data => broadcast('milestone_rejected', data));
  executor.on('milestone_failed', data => broadcast('milestone_failed', data));
  executor.on('dispute_started', data => broadcast('dispute_started', data));
  executor.on('dispute_resolved', data => broadcast('dispute_resolved', data));
  executor.on('task_complete', data => broadcast('task_complete', data));

  executor.on('funding_required', data => {
    escrowFundingDetails.set(task_id, {
      contractId: data.contract_id ?? '',
      totalUsdc: data.total_usdc ?? 0,
    });
  });

  try {
    const result = await executor.execute(plan, task, REGISTRY_URL, userAddress, {
      humanOverride: options.humanOverride?.approver || options.humanOverride?.disputeResolver
        ? options.humanOverride
        : undefined,
    }, task_id);

    activeExecutors.delete(task_id);
    broadcast('task_result', result);
    console.log(`[Orchestrator] Task ${result.task_id} ${result.status} | cost: $${result.total_cost.toFixed(4)} | ${result.total_time_ms}ms`);

    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_completed',
        task_id,
        task_description: task,
        amount_usdc: result.total_cost,
      });
      saveTaskResult(userAddress, task, result);
    }
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Execution failed: ${err.message}` });
    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_failed',
        task_id,
        task_description: task,
      });
    }
  }
}

const server = createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ── On-chain event monitor ──
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '';
const ESCROW_EVENT_ABI = [
  'event EscrowDeployed(string escrowId, string title, address indexed platform, address indexed serviceProvider, address indexed approver)',
  'event EscrowFunded(string escrowId, address indexed funder, uint256 amount)',
  'event MilestoneCompleted(string escrowId, uint256 indexed milestoneIndex, address indexed agent)',
  'event MilestoneApproved(string escrowId, uint256 indexed milestoneIndex, address indexed approver)',
  'event FundsReleased(string escrowId, uint256 indexed milestoneIndex, address indexed receiver, uint256 amount)',
  'event DisputeStarted(string escrowId, uint256 indexed milestoneIndex, address indexed initiator)',
  'event DisputeResolved(string escrowId, uint256 indexed milestoneIndex, address indexed resolver)',
];

if (ESCROW_CONTRACT_ADDRESS) {
  const escrowContract = new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_EVENT_ABI, provider);
  const eventNames = ['EscrowDeployed', 'EscrowFunded', 'MilestoneCompleted', 'MilestoneApproved', 'FundsReleased', 'DisputeStarted', 'DisputeResolved'];

  eventNames.forEach(eventName => {
    escrowContract.on(eventName, (...args: any[]) => {
      const event = args[args.length - 1] as ethers.EventLog;
      const decoded: Record<string, any> = { event: eventName, block_number: event.blockNumber, tx_hash: event.transactionHash };
      eventNames.forEach((_, i) => {
        const input = escrowContract.interface.getEvent(eventName)?.inputs[i];
        if (input && args[i] !== undefined) {
          decoded[input.name] = typeof args[i] === 'bigint' ? args[i].toString() : args[i];
        }
      });
      console.log(`[OnChain] ${eventName} — block ${event.blockNumber} | tx: ${event.transactionHash.slice(0, 10)}…`);
      broadcast('onchain_event', decoded);
    });
  });

  (async () => {
    try {
      const filter = { address: ESCROW_CONTRACT_ADDRESS, fromBlock: -1000 };
      console.log('[OnChain] Monitoring escrow contract:', ESCROW_CONTRACT_ADDRESS);
    } catch (err: any) {
      console.warn('[OnChain] Event monitor init failed:', err.message);
    }
  })();
}

server.listen(PORT, () => {
  console.log(`[AgentForge] Orchestrator running on port ${PORT}`);
  console.log(`[AgentForge] Platform wallet: ${PLATFORM_ADDRESS}`);
  console.log(`[AgentForge] Network: Somnia Testnet (${rpcUrl})`);
  console.log(`[AgentForge] Registry: ${REGISTRY_URL}`);
  console.log(`[AgentForge] WebSocket: ws://localhost:${PORT}/ws`);
});
