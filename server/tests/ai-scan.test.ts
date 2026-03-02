import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "test-fixtures" || entry.name === "replit_integrations") continue;
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractCallBlock(content: string, startIndex: number): string {
  let depth = 0;
  let started = false;
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === "(") {
      depth++;
      started = true;
    } else if (content[i] === ")") {
      depth--;
      if (started && depth === 0) {
        return content.substring(startIndex, i + 1);
      }
    }
  }
  return content.substring(startIndex, Math.min(startIndex + 500, content.length));
}

const serverDir = path.resolve(__dirname, "..");

describe("AI Client Enforcement Scan", () => {
  const files = getAllTsFiles(serverDir);

  it("no direct OpenAI or GoogleGenAI instantiation outside ai-client.ts", () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = path.relative(serverDir, file);
      if (relPath === "ai-client.ts") continue;

      const content = fs.readFileSync(file, "utf-8");

      if (content.includes("new OpenAI(")) {
        violations.push(`${relPath}: contains "new OpenAI(" — must use ai-client.ts`);
      }
      if (content.includes("new GoogleGenAI(")) {
        violations.push(`${relPath}: contains "new GoogleGenAI(" — must use ai-client.ts`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("all aiChat calls have explicit max_tokens", () => {
    const uncapped: string[] = [];

    for (const file of files) {
      const relPath = path.relative(serverDir, file);
      if (relPath === "ai-client.ts") continue;
      const content = fs.readFileSync(file, "utf-8");

      const aiChatPattern = /aiChat\(/g;
      let match;
      while ((match = aiChatPattern.exec(content)) !== null) {
        const callBlock = extractCallBlock(content, match.index);
        if (!callBlock.includes("max_tokens")) {
          const lineNum = content.substring(0, match.index).split("\n").length;
          uncapped.push(`${relPath}:${lineNum}: aiChat call missing max_tokens`);
        }
      }
    }

    expect(uncapped).toEqual([]);
  });
});
