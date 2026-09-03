import "dotenv/config";
import { getGemini } from "../server/ai-client";

async function main() {
  const gemini = getGemini();
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.6-flash"];
  for (const m of models) {
    try {
      console.log(`Testing model: ${m}...`);
      const res = await gemini.models.generateContent({
        model: m,
        contents: "Hello, answer in one word: ready?",
      });
      console.log(`  Success with ${m}:`, res.text);
    } catch (e: any) {
      console.log(`  Failed with ${m}:`, e.message);
    }
  }
}

main().catch(console.error);
