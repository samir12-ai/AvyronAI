import type { Express } from "express";

// SECURITY (2026-05-16): This file previously registered a parallel set of
// `/api/conversations*` routes that bypassed every auth and account-scoping
// guard used by the live chat router. They were never wired into
// `server/index.ts` (so the leak was latent), but kept here they were a
// single-line footgun away from a full cross-account data breach: any caller
// could list / read / delete / inject messages into any user's conversation.
//
// The canonical, account-scoped chat router lives at
// `server/replit_integrations/chat/routes.ts` and is mounted via
// `registerChatRoutes(app)` in `server/routes.ts`. All conversation endpoints
// MUST go through that router. Do NOT add HTTP routes back to this file
// without going through the same `resolveAccountId(req)` + per-row accountId
// filter pattern used in `chat/routes.ts`.
//
// The audio helpers (transcription / TTS / streaming primitives) still live
// in `./client` and are imported directly by `chat/routes.ts` where needed.
export function registerAudioRoutes(_app: Express): void {
  // Intentionally a no-op. See block comment above.
}
