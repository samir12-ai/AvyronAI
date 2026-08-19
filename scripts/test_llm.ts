import "dotenv/config";
import { aiChat } from "../server/ai-client";

async function main() {
  console.log("Testing live LLM connection...");
  try {
    const res = await aiChat({
      messages: [{ role: "user", content: "Respond with the single word: READY" }],
      model: "gpt-4o",
      max_tokens: 10,
      temperature: 0,
    });
    console.log("LLM Success! Response:", res.choices?.[0]?.message?.content);
  } catch (err: any) {
    console.error("LLM Error:", err.message);
  }
}

main().catch(console.error);
