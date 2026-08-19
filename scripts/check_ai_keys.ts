import "dotenv/config";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

async function main() {
  console.log("=== Checking AI Keys ===");
  const oKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  console.log("OpenAI key defined:", !!oKey);
  if (oKey) {
    try {
      const o = new OpenAI({ apiKey: oKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
      const resp = await o.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      });
      console.log("OpenAI success! Reply:", resp.choices[0]?.message?.content);
    } catch (err: any) {
      console.log("OpenAI call failed:", err.message);
    }
  }

  const gKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  console.log("Gemini key defined:", !!gKey);
  if (gKey) {
    try {
      const g = new GoogleGenAI({ apiKey: gKey });
      const resp = await g.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "hi",
      });
      console.log("Gemini success! Reply:", resp.text);
    } catch (err: any) {
      console.log("Gemini call failed:", err.message);
    }
  }
}

main().catch(console.error);
