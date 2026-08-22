import "dotenv/config";
import * as fs from "fs";
import { aiChat } from "../server/ai-client";

async function main() {
  const data = JSON.parse(fs.readFileSync('scratch/phase_b_5_runs.json', 'utf8'));

  let prompt = `You are a forensic semantic auditor analyzing 5 separate executions of an AI audience engine on the EXACT SAME EVIDENCE CORPUS.
This is Phase C: Validating the Product Fit Semantic Stability Fix.
Your job is to cross-reference the extracted market pains and determine their stability, specifically focusing on whether semantically equivalent pains now receive CONSISTENT Product Fit classifications across runs.

Here are the extracted pains for the 5 runs:\n\n`;

  data.forEach((run: any) => {
    prompt += `### RUN ${run.runId} ###\n`;
    run.registry.forEach((p: any) => {
      prompt += `- [${p.painId}] (Segment: ${p.segmentIds.join(", ")}) (Fit: ${p.productFit} / ${p.fitType}): ${p.canonical}\n`;
    });
    prompt += `\n`;
  });

  prompt += `
Analyze the pain portfolios across all 5 runs.
Step 1: Group the pains into underlying Semantic Themes.
Step 2: For each theme, determine its stability (STABLE, MOSTLY STABLE, VARIABLE, ONE-OFF).
Step 3: Analyze Product Fit Consistency. For pains that are semantically equivalent across runs, did Product Fit classify them consistently? If a pain was DIRECT_FIT in Run A and STRATEGIC_FIT in Run B, flag it!
Step 4: Conclude whether the PRODUCT_FIT_SEMANTIC_STABILITY_DEFECT has been successfully resolved. Success means that any wording differences within a semantic theme no longer cause Product Fit to wildly oscillate.

Output your report in markdown format. Do not write any code.
`;

  const response = await aiChat({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-4o",
    max_tokens: 8192,
    accountId: "system",
    endpoint: "audit"
  } as any);

  fs.writeFileSync('scratch/semantic_comparison_after_fix.md', response.content || (response.choices?.[0]?.message?.content) || "");
  console.log("Done semantic comparison.");
}
main().catch(console.error);
