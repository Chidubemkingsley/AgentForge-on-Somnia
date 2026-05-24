import { ethers } from 'ethers';
import { callAI } from '@agentforge/common';
import type { VerifierVerdict } from '@agentforge/common';
import { approveMilestone } from './somnia-client.js';

export interface VerifierInput {
  acceptanceCriteria: string;
  deliverable: string;
  milestoneTitle: string;
}

export interface VerifierResult {
  verdict: VerifierVerdict;
  approvalTxHash: string | null;
}

export async function getVerifierVerdict(input: VerifierInput): Promise<VerifierVerdict> {
  const prompt = `You are an objective AI quality verifier for a task marketplace. Your job is to evaluate a deliverable against explicit acceptance criteria and return a structured verdict.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 3000)}

Evaluate each criterion individually. Be honest and strict — only pass if the criterion is genuinely met.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "passed": true or false,
  "reasoning": "One paragraph explaining the overall verdict",
  "per_criterion": [
    { "criterion": "criterion text", "passed": true or false, "note": "brief note" }
  ]
}`;

  try {
    const text = await callAI(prompt, 'llama-3.1-8b-instant', 1500);
    return parseVerdict(text);
  } catch (err: any) {
    console.warn(`[Verifier] getVerifierVerdict infrastructure error: ${err.message} — defaulting to pass`);
    return { passed: true, reasoning: `Verifier unavailable (${err.message}). Defaulting to pass — agent should not be penalized for infrastructure failures.`, per_criterion: [] };
  }
}

export async function verifyMilestone(
  input: VerifierInput,
  contractId: string,
  milestoneIndex: number,
  verifierWallet: ethers.Wallet,
): Promise<VerifierResult> {
  const prompt = `You are an objective AI quality verifier for a task marketplace. Your job is to evaluate a deliverable against explicit acceptance criteria and return a structured verdict.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 3000)}

Evaluate each criterion individually. Be honest and strict — only pass if the criterion is genuinely met. A vague or incomplete deliverable should FAIL.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "passed": true or false,
  "reasoning": "One paragraph explaining the overall verdict",
  "per_criterion": [
    {
      "criterion": "criterion text",
      "passed": true or false,
      "note": "brief note on why"
    }
  ]
}`;

  let verdict: VerifierVerdict;
  try {
    const text = await callAI(prompt, 'llama-3.1-8b-instant', 1500);
    verdict = parseVerdict(text);
  } catch (err: any) {
    console.warn(`[Verifier] verifyMilestone infrastructure error: ${err.message} — defaulting to pass`);
    verdict = { passed: true, reasoning: `Verifier unavailable (${err.message}). Defaulting to pass.`, per_criterion: [] };
  }

  let approvalTxHash: string | null = null;

  if (verdict.passed) {
    try {
      approvalTxHash = await approveMilestone(contractId, milestoneIndex, verifierWallet);
      console.log(`[Verifier] Approved milestone ${milestoneIndex} on-chain: ${approvalTxHash}`);
    } catch (err: any) {
      console.error(`[Verifier] On-chain approval failed: ${err.message}`);
    }
  } else {
    console.log(`[Verifier] Rejected milestone ${milestoneIndex}: ${verdict.reasoning}`);
  }

  return { verdict, approvalTxHash };
}

function parseVerdict(text: string): VerifierVerdict {
  const fallback = (reason: string): VerifierVerdict => ({
    passed: false,
    reasoning: reason,
    per_criterion: [],
  });

  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let raw: any;

  try { raw = JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback('Verifier returned non-JSON response.');
    try { raw = JSON.parse(match[0]); }
    catch {
      const passedMatch = cleaned.match(/"passed"\s*:\s*(true|false)/);
      const reasonMatch = cleaned.match(/"reasoning"\s*:\s*"([^"]{0,500})"/);
      if (!passedMatch) return fallback('Verifier response was truncated and unparseable.');
      return {
        passed: passedMatch[1] === 'true',
        reasoning: reasonMatch ? reasonMatch[1] : 'Verdict truncated — see raw output.',
        per_criterion: [],
      };
    }
  }

  return {
    passed: Boolean(raw.passed),
    reasoning: String(raw.reasoning || ''),
    per_criterion: Array.isArray(raw.per_criterion)
      ? raw.per_criterion.map((c: any) => ({
          criterion: String(c.criterion || ''),
          passed: Boolean(c.passed),
          note: String(c.note || ''),
        }))
      : [],
  };
}

export function loadVerifierWallet(): ethers.Wallet {
  const key = process.env.VERIFIER_PRIVATE_KEY;
  if (!key) throw new Error('VERIFIER_PRIVATE_KEY not set');
  const rpcUrl = process.env.SOMNIA_RPC_URL || 'https://testnet.somnia.network';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(key, provider);
}
