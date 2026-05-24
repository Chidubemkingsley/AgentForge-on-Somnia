import { callAI } from '@agentforge/common';

export async function generateReport(input: string): Promise<string> {
  if (!input.trim()) {
    return '**Report unavailable** — no data was provided.';
  }

  const prompt = `You are a professional report writer. Format the following data into a clear, structured report.

Data:
${input}

Requirements:
- Use clear markdown headings and sections
- Include an executive summary at the top
- Report only on data that was actually provided — do not invent missing sections
- Highlight key findings and actionable insights
- Format numbers and data clearly

Produce a well-formatted markdown report:`;

  return callAI(prompt, 'llama-3.1-8b-instant', 1500);
}
