const { execSync } = require("child_process");
const path = require("path");

const aliases = [
  "--alias:@shared/schema=./shared/schema",
  "--alias:@shared/contracts=./shared/contracts",
  "--alias:@shared/perception-translator=./shared/perception-translator",
];

const cmd = [
  "npx esbuild server/index.ts",
  "--platform=node",
  "--packages=external",
  "--bundle",
  "--format=esm",
  "--outdir=server_dist",
  ...aliases,
].join(" ");

console.log("[server-build] Running:", cmd);
execSync(cmd, { stdio: "inherit", cwd: path.resolve(__dirname, "..") });
console.log("[server-build] Done.");
