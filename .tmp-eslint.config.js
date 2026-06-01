const { defineConfig } = require('eslint/config');
const noSemanticFallback = require('./.local/eslint-rules/no-semantic-fallback.js');

module.exports = defineConfig([
  {
    files: ["server/audience-engine/engine.ts", "server/offer-engine/engine.ts", "server/positioning-engine/engine.ts"],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      semantic: { rules: { "no-semantic-fallback": noSemanticFallback } },
    },
    rules: {
      "semantic/no-semantic-fallback": "error",
    },
  },
]);
