import { ProxyAgent } from "undici";
import * as crypto from "crypto";
const QUARANTINE_THRESHOLD = 2;
const QUARANTINE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_QUARANTINE_MS = 30 * 60 * 1000;
const MAX_QUARANTINE_MS = 120 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_RETRIES_PER_STAGE = 3;
const RETRY_DELAYS = [[10000, 25000], [30000, 60000]];
export function getProxyConfig() {
    const host = process.env.BRIGHT_DATA_PROXY_HOST;
    const port = process.env.BRIGHT_DATA_PROXY_PORT;
    const username = process.env.BRIGHT_DATA_PROXY_USERNAME;
    const password = process.env.BRIGHT_DATA_PROXY_PASSWORD;
    if (!host || !port || !username || !password)
        return null;
    return { host, port, username, password };
}
function computeIpHash(sessionId) {
    return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}
function jitteredDelay(min, max) {
    const ms = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, ms));
}
const pools = new Map();
const MAX_TELEMETRY_PER_ACCOUNT = 500;
function getOrCreatePool(accountId) {
    let pool = pools.get(accountId);
    if (!pool) {
        pool = { sessions: new Map(), telemetry: [], stickyBindings: new Map() };
        pools.set(accountId, pool);
    }
    return pool;
}
function createSession(accountId) {
    const proxy = getProxyConfig();
    if (!proxy)
        return null;
    const shortAccount = accountId.substring(0, 8);
    const ts = (Date.now() % 1000000).toString(36);
    const rand = Math.random().toString(36).substr(2, 4);
    const sessionId = `s${shortAccount}${ts}${rand}`;
    const isWebUnlocker = proxy.port === "33335";
    const sessionUsername = isWebUnlocker ? proxy.username : `${proxy.username}-session-${sessionId}`;
    const sessionUrl = `http://${sessionUsername}:${proxy.password}@${proxy.host}:${proxy.port}`;
    const session = {
        sessionId,
        ipHash: computeIpHash(sessionId),
        dispatcher: new ProxyAgent({ uri: sessionUrl, requestTls: { rejectUnauthorized: false } }),
        sessionUsername,
        sessionPassword: proxy.password,
        proxyHost: proxy.host,
        proxyPort: proxy.port,
        createdAt: Date.now(),
        successCount: 0,
        blockCount: 0,
        lastBlockAt: null,
        previousBlockAt: null,
        cooldownUntil: null,
        isQuarantined: false,
    };
    const pool = getOrCreatePool(accountId);
    pool.sessions.set(sessionId, session);
    return session;
}
function selectHealthySession(accountId, excludeIds = new Set()) {
    const pool = getOrCreatePool(accountId);
    const now = Date.now();
    for (const [id, session] of pool.sessions) {
        if (excludeIds.has(id))
            continue;
        if (session.isQuarantined) {
            if (session.cooldownUntil && now >= session.cooldownUntil) {
                session.isQuarantined = false;
                session.cooldownUntil = null;
                session.blockCount = 0;
                console.log(`[ProxyPool] Session ${id} quarantine expired for account ${accountId}`);
            }
            else {
                continue;
            }
        }
        if (now - session.createdAt > SESSION_TTL_MS) {
            pool.sessions.delete(id);
            continue;
        }
        return session;
    }
    return null;
}
function quarantineSession(accountId, sessionId) {
    const pool = getOrCreatePool(accountId);
    const session = pool.sessions.get(sessionId);
    if (!session)
        return;
    session.isQuarantined = true;
    const escalation = Math.min(session.blockCount, 4);
    session.cooldownUntil = Date.now() + Math.min(DEFAULT_QUARANTINE_MS * escalation, MAX_QUARANTINE_MS);
    console.log(`[ProxyPool] QUARANTINE | account=${accountId} | session=${sessionId} | ipHash=${session.ipHash} | blocks=${session.blockCount} | cooldownUntil=${new Date(session.cooldownUntil).toISOString()}`);
}
function recordBlock(accountId, sessionId) {
    const pool = getOrCreatePool(accountId);
    const session = pool.sessions.get(sessionId);
    if (!session)
        return;
    session.previousBlockAt = session.lastBlockAt;
    session.blockCount++;
    session.lastBlockAt = Date.now();
    if (session.blockCount >= QUARANTINE_THRESHOLD && session.previousBlockAt !== null) {
        const timeBetweenBlocks = session.lastBlockAt - session.previousBlockAt;
        if (timeBetweenBlocks <= QUARANTINE_WINDOW_MS) {
            quarantineSession(accountId, sessionId);
        }
    }
}
function recordSuccess(accountId, sessionId) {
    const pool = getOrCreatePool(accountId);
    const session = pool.sessions.get(sessionId);
    if (session)
        session.successCount++;
}
function addTelemetry(accountId, entry) {
    const pool = getOrCreatePool(accountId);
    pool.telemetry.push(entry);
    if (pool.telemetry.length > MAX_TELEMETRY_PER_ACCOUNT) {
        pool.telemetry = pool.telemetry.slice(-MAX_TELEMETRY_PER_ACCOUNT);
    }
}
export function classifyBlock(httpStatus, errorMessage) {
    const msg = (errorMessage || "").toLowerCase();
    if (msg.includes("proxy") || msg.includes("tunnel") || msg.includes("connect"))
        return "PROXY_BLOCKED";
    if (httpStatus === 429 || msg.includes("rate limit") || msg.includes("wait a few minutes"))
        return "RATE_LIMIT";
    if (httpStatus === 401 || msg.includes("require_login") || msg.includes("auth"))
        return "AUTH_REQUIRED";
    if (msg.includes("checkpoint") || msg.includes("challenge"))
        return "CHECKPOINT";
    if (httpStatus === 403 || msg.includes("blocked") || msg.includes("forbidden"))
        return "PROXY_BLOCKED";
    return "OTHER";
}
export function acquireStickySession(accountId, campaignId, competitorHash) {
    const pool = getOrCreatePool(accountId);
    const bindingKey = `${accountId}:${campaignId}:${competitorHash}`;
    const existingSessionId = pool.stickyBindings.get(bindingKey);
    if (existingSessionId) {
        const existingSession = pool.sessions.get(existingSessionId);
        if (existingSession && !existingSession.isQuarantined && Date.now() - existingSession.createdAt < SESSION_TTL_MS) {
            return {
                accountId, campaignId, competitorHash,
                session: existingSession,
                attemptNumber: 1,
                usedSessionIds: new Set([existingSessionId]),
            };
        }
        pool.stickyBindings.delete(bindingKey);
    }
    const session = createSession(accountId);
    if (!session)
        return null;
    pool.stickyBindings.set(bindingKey, session.sessionId);
    return {
        accountId, campaignId, competitorHash,
        session,
        attemptNumber: 1,
        usedSessionIds: new Set([session.sessionId]),
    };
}
export function rotateSessionOnBlock(ctx, blockClass) {
    const allowedRotation = blockClass === "PROXY_BLOCKED" || blockClass === "RATE_LIMIT";
    if (!allowedRotation) {
        console.log(`[ProxyPool] ROTATION_DENIED | blockClass=${blockClass} | Only PROXY_BLOCKED and RATE_LIMIT allow rotation`);
        return null;
    }
    recordBlock(ctx.accountId, ctx.session.sessionId);
    if (ctx.attemptNumber >= MAX_RETRIES_PER_STAGE) {
        console.log(`[ProxyPool] MAX_RETRIES_REACHED | account=${ctx.accountId} | competitor=${ctx.competitorHash} | attempts=${ctx.attemptNumber}`);
        return null;
    }
    const newSession = createSession(ctx.accountId);
    if (!newSession)
        return null;
    const pool = getOrCreatePool(ctx.accountId);
    const bindingKey = `${ctx.accountId}:${ctx.campaignId}:${ctx.competitorHash}`;
    pool.stickyBindings.set(bindingKey, newSession.sessionId);
    const newUsed = new Set(ctx.usedSessionIds);
    newUsed.add(newSession.sessionId);
    console.log(`[ProxyPool] SESSION_ROTATED | account=${ctx.accountId} | oldSession=${ctx.session.sessionId} | newSession=${newSession.sessionId} | attempt=${ctx.attemptNumber + 1} | blockClass=${blockClass}`);
    return {
        ...ctx,
        session: newSession,
        attemptNumber: ctx.attemptNumber + 1,
        usedSessionIds: newUsed,
    };
}
export function releaseStickySession(ctx) {
    const pool = getOrCreatePool(ctx.accountId);
    const bindingKey = `${ctx.accountId}:${ctx.campaignId}:${ctx.competitorHash}`;
    pool.stickyBindings.delete(bindingKey);
}
export function logProxyTelemetry(ctx, stageName, httpStatus, blockClass, durationMs, success) {
    const entry = {
        timestamp: Date.now(),
        accountId: ctx.accountId,
        campaignId: ctx.campaignId,
        competitorHash: ctx.competitorHash,
        proxySessionId: ctx.session.sessionId,
        ipHash: ctx.session.ipHash,
        stageName,
        attemptNumber: ctx.attemptNumber,
        httpStatus,
        blockClass,
        durationMs,
        success,
    };
    addTelemetry(ctx.accountId, entry);
    if (success) {
        recordSuccess(ctx.accountId, ctx.session.sessionId);
    }
    console.log(`[ProxyTelemetry] account=${ctx.accountId} | campaign=${ctx.campaignId} | competitor=${ctx.competitorHash} | session=${ctx.session.sessionId} | ipHash=${ctx.session.ipHash} | stage=${stageName} | attempt=${ctx.attemptNumber} | http=${httpStatus ?? "N/A"} | block=${blockClass ?? "NONE"} | duration=${durationMs}ms | success=${success}`);
}
export async function getRetryDelay(attemptNumber) {
    const idx = Math.min(attemptNumber - 2, RETRY_DELAYS.length - 1);
    if (idx < 0)
        return;
    const [min, max] = RETRY_DELAYS[idx];
    await jitteredDelay(min, max);
}
export function getPoolDiagnostics(accountId) {
    const pool = getOrCreatePool(accountId);
    const now = Date.now();
    let active = 0;
    let quarantined = 0;
    for (const session of pool.sessions.values()) {
        if (session.isQuarantined) {
            quarantined++;
            continue;
        }
        if (now - session.createdAt < SESSION_TTL_MS)
            active++;
    }
    const recentWindow = 10 * 60 * 1000;
    const recentEntries = pool.telemetry.filter(e => now - e.timestamp < recentWindow);
    return {
        totalSessions: pool.sessions.size,
        activeSessions: active,
        quarantinedSessions: quarantined,
        totalTelemetryEntries: pool.telemetry.length,
        recentBlocks: recentEntries.filter(e => !e.success).length,
        recentSuccesses: recentEntries.filter(e => e.success).length,
        stickyBindings: pool.stickyBindings.size,
    };
}
export function getTelemetryForJob(accountId, competitorHash) {
    const pool = pools.get(accountId);
    if (!pool)
        return [];
    if (competitorHash)
        return pool.telemetry.filter(e => e.competitorHash === competitorHash);
    return [...pool.telemetry];
}
export function clearPool(accountId) {
    pools.delete(accountId);
}
export function isSessionQuarantined(accountId, sessionId) {
    const pool = pools.get(accountId);
    if (!pool)
        return false;
    const session = pool.sessions.get(sessionId);
    if (!session)
        return false;
    return session.isQuarantined && (!session.cooldownUntil || Date.now() < session.cooldownUntil);
}
export function getActivePoolCount() {
    return pools.size;
}
export { MAX_RETRIES_PER_STAGE, SESSION_TTL_MS, QUARANTINE_THRESHOLD, QUARANTINE_WINDOW_MS, DEFAULT_QUARANTINE_MS };
