import 'dotenv/config';
import { runAudienceEngine } from "../audience-engine/engine";
import fs from 'fs';

const originalFetch = global.fetch;
global.fetch = async (...args) => {
    const requestArgs = args;
    let requestBody = undefined;
    if (args[1] && args[1].body) {
        requestBody = JSON.parse(args[1].body);
        const endpoint = requestBody.messages ? "openai-chat" : "other";
        fs.appendFileSync('audit_llm_dump.jsonl', JSON.stringify({
            type: "REQUEST",
            endpoint,
            model: requestBody.model,
            messages: requestBody.messages
        }) + "\n");
    }

    const response = await originalFetch(...args);
    const responseClone = response.clone();
    
    try {
        const responseData = await responseClone.json();
        fs.appendFileSync('audit_llm_dump.jsonl', JSON.stringify({
            type: "RESPONSE",
            data: responseData
        }) + "\n");
    } catch (e) {}

    return response;
};

async function run() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  console.log("Running audience engine with fetch intercepted...");
  await runAudienceEngine(accountId, campaignId, undefined, "audit_job");
  console.log("Done.");
}

run().catch(console.error).then(() => process.exit(0));
