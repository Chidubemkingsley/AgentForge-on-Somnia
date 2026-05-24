import { callAI } from '@agentforge/common';

export async function checkFeasibility(
  task: string,
  availableAgents: AgentRecord[],
): Promise<FeasibilityResult> {
  const allCapabilities = new Set(availableAgents.flatMap(a => a.capabilities));

  const text = await callAI(`What capabilities does this task require? Return ONLY a JSON array of short capability tags (lowercase, hyphenated).

Known capability tags available: ${[...allCapabilities].join(', ')}

Task: "${task}"

Instructions:
- Prefer tags from the known list when they fit
- Always include at least one tag — never return an empty array
- If the task needs something not in the known list, add the appropriate new tag
Return only the JSON array, no explanation:`, 'llama-3.1-8b-instant', 200);

  let needed: string[] = [];
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    needed = JSON.parse(cleaned);
  } catch {
    needed = [];
  }

  const available = needed.filter(c =>
    [...allCapabilities].some(ac =>
      ac.toLowerCase().includes(c.toLowerCase()) ||
      c.toLowerCase().includes(ac.toLowerCase())
    )
  );
  const missing = needed.filter(c => !available.includes(c));

  const feasible = needed.length === 0 || (available.length / needed.length) >= 0.7;

  return { feasible, needed, available, missing };
}
