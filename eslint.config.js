const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const noSemanticFallback = require('./.local/eslint-rules/no-semantic-fallback.js');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // H6 (2026-05-10): Semantic Contract Hardening — forbid `?? status` /
  // `|| verdict` / `?? outcome` patterns on live decision/reporting paths.
  // Doctrine D1: no semantic fallback.
  {
    files: [
      "server/agent/**/*.ts",
      "server/system-control/**/*.ts",
      "server/orchestrator/**/*.ts",
      "server/build-plan-layer/**/*.ts",
      "server/recovery-*/**/*.ts",
    ],
    plugins: {
      semantic: { rules: { "no-semantic-fallback": noSemanticFallback } },
    },
    rules: {
      "semantic/no-semantic-fallback": "error",
    },
  },
]);
