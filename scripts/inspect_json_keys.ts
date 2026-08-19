import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    console.log(`\n================== ${f} (rows=${data.length}) ==================`);
    if (data.length > 0) {
      console.log("Keys in first row:", Object.keys(data[0]));
      console.log("First row sample:", JSON.stringify(data[0], null, 2).slice(0, 1000));
    }
  }
}

main();
