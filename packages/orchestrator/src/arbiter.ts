import { ethers } from 'ethers';
import { callAI } from '@agentforge/common';
import { resolveDispute, type Distribution } from './somnia-client.js';

export interface ArbiterInput {
  milestoneTitle: string;
  acceptanceCriteria: string;
  deliverable: string;
  verifierReasoning: string;
  agentContestReason: string;
  verifierVerdict: { per_criterion: Array<{ criterion: string; passed: boolean; reason: string }> };
}

export interface ArbiterResult {
  resolution: { winner: string; reasoning: string; agent_pct: number; funder_pct: number };
  resolveTxHash: string | null;
}

export async function arbitrateDispute(
  input: ArbiterInput,
  contractId: string,
  milestoneIndex: number,
  milestoneAmount: number,
  receiverAddress: string,
  funderAddress: string,
  arbiterWallet: ethers.Wallet,
): Promise<ArbiterResult> {
  const prompt = `You are an impartial AI arbiter for a task marketplace dispute. An agent's work was rejected by the AI Verifier; the agent has contested the rejection. You must decide the outcome.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 2000)}

VERIFIER'S REJECTION REASONING:
${input.verifierReasoning}

PER-CRITERION BREAKDOWN:
${JSON.stringify(input.verifierVerdict.per_criterion, null, 2)}

AGENT'S CONTEST ARGUMENT:
${input.agentContestReason}

Weigh both sides fairly. Decide:
- If the agent clearly met the requirements: award 100% to agent
- If the agent clearly failed: award 0% to agent (full refund to funder)
- If partially met: award a fair percentage (e.g., 50%, 70%) to agent

Return ONLY valid JSON (no markdown):
{
  "winner": "agent" | "funder" | "split",
  "reasoning": "Two-paragraph explanation of the decision",
  "agent_pct": 0-100,
  "funder_pct": 0-100
}

agent_pct + funder_pct must equal 100.`;

  const text = await callAI(prompt, 'llama-3.1-8b-instant', 600);
  const resolution = parseResolution(text);

  const agentAmount = parseFloat((milestoneAmount * resolution.agent_pct / 100).toFixed(6));
  const funderAmount = parseFloat((milestoneAmount * resolution.funder_pct / 100).toFixed(6));

  const distributions: Distribution[] = [];
  if (resolution.agent_pct > 0) {
    distributions.push({ address: receiverAddress, amount: agentAmount });
  }
  if (resolution.funder_pct > 0) {
    distributions.push({ address: funderAddress, amount: funderAmount });
  }
  if (distributions.length === 0) {
    distributions.push({ address: funderAddress, amount: parseFloat(milestoneAmount.toFixed(6)) });
  }

  let resolveTxHash: string | null = null;
  try {
    resolveTxHash = await resolveDispute(
      contractId,
      milestoneIndex,
      distributions,
      arbiterWallet,
    );
    console.log(`[Arbiter] Resolved dispute on-chain (agent ${resolution.agent_pct}%): ${resolveTxHash}`);
  } catch (err: any) {
    console.error(`[Arbiter] On-chain dispute resolution failed: ${err.message}`);
  }

  return { resolution, resolveTxHash };
}

function parseResolution(text: string): { winner: string; reasoning: string; agent_pct: number; funder_pct: number } {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return { winner: 'split', reasoning: 'Arbiter failed to produce a verdict.', agent_pct: 50, funder_pct: 50 };
    }
    raw = JSON.parse(match[0]);
  }

  const agent_pct = Math.min(100, Math.max(0, Math.round(Number(raw.agent_pct) || 0)));
  const funder_pct = 100 - agent_pct;

  let winner: 'agent' | 'funder' | 'split' = 'split';
  if (agent_pct === 100) winner = 'agent';
  else if (agent_pct === 0) winner = 'funder';

  return {
    winner,
    reasoning: String(raw.reasoning || ''),
    agent_pct,
    funder_pct,
  };
}

export function loadArbiterWallet(): ethers.Wallet {
  const key = process.env.ARBITER_PRIVATE_KEY;
  if (!key) throw new Error('ARBITER_PRIVATE_KEY not set');
  const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(key, provider);
}
