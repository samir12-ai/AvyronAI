import * as crypto from "crypto";
export function computeCompetitorHash(competitors) {
    const ids = competitors.map(c => c.id).sort();
    return crypto.createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 16);
}
export function parseJsonSafe(json, fallback) {
    if (!json)
        return fallback;
    try {
        return JSON.parse(json);
    }
    catch {
        return fallback;
    }
}
