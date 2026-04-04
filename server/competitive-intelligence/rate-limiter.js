const TOKEN_REFILL_INTERVAL_MS = 5000;
const MAX_BURST_TOKENS = 3;
const TOKEN_REFILL_JITTER_MS = 7000;
const buckets = new Map();
function getBucket(accountId, campaignId) {
    const key = `${accountId}:${campaignId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = {
            tokens: MAX_BURST_TOKENS,
            lastRefill: Date.now(),
            totalConsumed: 0,
            totalWaited: 0,
        };
        buckets.set(key, bucket);
    }
    return bucket;
}
function refillTokens(bucket) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const effectiveInterval = TOKEN_REFILL_INTERVAL_MS + Math.random() * TOKEN_REFILL_JITTER_MS;
    const tokensToAdd = Math.floor(elapsed / effectiveInterval);
    if (tokensToAdd > 0) {
        bucket.tokens = Math.min(MAX_BURST_TOKENS, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
    }
}
export async function acquireToken(accountId, campaignId, stageName) {
    const bucket = getBucket(accountId, campaignId);
    refillTokens(bucket);
    if (bucket.tokens > 0) {
        bucket.tokens--;
        bucket.totalConsumed++;
        console.log(`[RateLimiter] TOKEN_GRANTED | account=${accountId} | campaign=${campaignId} | stage=${stageName} | remaining=${bucket.tokens}/${MAX_BURST_TOKENS} | totalConsumed=${bucket.totalConsumed}`);
        return;
    }
    const waitMs = TOKEN_REFILL_INTERVAL_MS + Math.random() * TOKEN_REFILL_JITTER_MS;
    console.log(`[RateLimiter] TOKEN_WAIT | account=${accountId} | campaign=${campaignId} | stage=${stageName} | waitMs=${Math.round(waitMs)} | totalWaited=${bucket.totalWaited + 1}`);
    bucket.totalWaited++;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    bucket.tokens = Math.max(0, bucket.tokens);
    bucket.tokens = 0;
    bucket.totalConsumed++;
    bucket.lastRefill = Date.now();
    console.log(`[RateLimiter] TOKEN_GRANTED_AFTER_WAIT | account=${accountId} | campaign=${campaignId} | stage=${stageName} | remaining=0/${MAX_BURST_TOKENS} | totalConsumed=${bucket.totalConsumed}`);
}
export function getBucketState(accountId, campaignId) {
    const bucket = getBucket(accountId, campaignId);
    refillTokens(bucket);
    return {
        tokens: bucket.tokens,
        maxBurst: MAX_BURST_TOKENS,
        totalConsumed: bucket.totalConsumed,
        totalWaited: bucket.totalWaited,
        refillIntervalMs: TOKEN_REFILL_INTERVAL_MS,
    };
}
export function resetBucket(accountId, campaignId) {
    const key = `${accountId}:${campaignId}`;
    buckets.delete(key);
}
export function resetAllBuckets() {
    buckets.clear();
}
export { TOKEN_REFILL_INTERVAL_MS, MAX_BURST_TOKENS, TOKEN_REFILL_JITTER_MS };
