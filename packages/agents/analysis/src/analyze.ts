import { callAI } from '@agentforge/common';

export async function analyzeData(data: string, instruction: string): Promise<string> {
  return callAI(
    `${instruction}\n\nData to analyze:\n${data}\n\nProvide a structured analysis with: key trends, risks, and outlook. Be concise and data-driven.`,
    'llama-3.1-8b-instant',
    800,
  );
}
