import * as fs from "fs";
import * as path from "path";

const SERVER_ROOT = path.resolve(__dirname);

function findStaleJsArtifacts(dir: string): string[] {
  const stale: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return stale;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      stale.push(...findStaleJsArtifacts(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const tsCounterpart = fullPath.slice(0, -3) + ".ts";
      if (fs.existsSync(tsCounterpart)) {
        stale.push(fullPath);
      }
    }
  }
  return stale;
}

export function runStartupArtifactGuard(): void {
  const stale = findStaleJsArtifacts(SERVER_ROOT);

  if (stale.length === 0) {
    console.log("[ArtifactGuard] Startup check passed — no stale .js artifacts detected alongside .ts sources");
    return;
  }

  console.warn(`[ArtifactGuard] WARNING: Found ${stale.length} stale .js artifact(s) co-located with .ts sources — auto-deleting to enforce single source of truth:`);

  let deleted = 0;
  let failed = 0;

  for (const filePath of stale) {
    const rel = path.relative(SERVER_ROOT, filePath);
    try {
      fs.unlinkSync(filePath);
      console.warn(`[ArtifactGuard]   DELETED: server/${rel}`);
      deleted++;
    } catch (err: any) {
      console.error(`[ArtifactGuard]   FAILED to delete server/${rel}: ${err.message}`);
      failed++;
    }
  }

  console.warn(`[ArtifactGuard] Cleanup complete — deleted=${deleted} | failed=${failed} | total_found=${stale.length}`);

  if (failed > 0) {
    throw new Error(
      `[ArtifactGuard] CRITICAL: ${failed} stale .js artifact(s) could not be deleted. ` +
      `These files shadow their .ts counterparts and will cause incorrect module resolution under concurrent load. ` +
      `Delete them manually before starting the server.`
    );
  }
}
