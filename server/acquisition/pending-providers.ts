/**
 * P-6.12 — Provider-pending acquisition slots.
 *
 * Bright Data is fully retired (2026-07-28). For surfaces where no Apify
 * actor has been selected/verified yet, acquisition is in an explicit
 * PROVIDER_PENDING state: config slots exist, calls fail fast with a
 * machine-readable status, and NOTHING silently fabricates data.
 *
 * When an actor is chosen, set the env slot and implement the actor call in
 * the corresponding provider module — persistence/dedup layers downstream
 * were preserved for exactly this.
 *
 * Pending surfaces:
 *   GOOGLE_BUSINESS_ACTOR_ID — Google Business profile data
 *   GOOGLE_REVIEWS_ACTOR_ID  — Google reviews (review text needs a SERP-class
 *                              source; Bright Data raw HTML was permanently off)
 *   GOOGLE_SEARCH_ACTOR_ID   — Google search/SERP results
 *   WEBSITE_SCRAPER_ACTOR_ID — competitor/user website + blog page fetch
 */

export type ProviderState = "ACTIVE" | "PROVIDER_PENDING" | "NOT_CONFIGURED";

export interface PendingProviderStatus {
  surface: string;
  state: ProviderState;
  envSlot: string;
  actorId: string | null;
  detail: string;
}

const SLOTS = {
  googleBusiness: "GOOGLE_BUSINESS_ACTOR_ID",
  googleReviews: "GOOGLE_REVIEWS_ACTOR_ID",
  googleSearch: "GOOGLE_SEARCH_ACTOR_ID",
  website: "WEBSITE_SCRAPER_ACTOR_ID",
} as const;

function slotStatus(surface: string, envSlot: string): PendingProviderStatus {
  const actorId = process.env[envSlot]?.trim() || null;
  return {
    surface,
    state: actorId ? "NOT_CONFIGURED" : "PROVIDER_PENDING",
    envSlot,
    actorId,
    detail: actorId
      ? `${envSlot} is set (${actorId}) but the actor integration is not implemented yet — implement + live-verify before use.`
      : `No actor selected. Set ${envSlot} and implement the actor call to activate this surface.`,
  };
}

export function getGoogleBusinessProviderStatus(): PendingProviderStatus {
  return slotStatus("google_business", SLOTS.googleBusiness);
}
export function getGoogleReviewsProviderStatus(): PendingProviderStatus {
  return slotStatus("google_reviews", SLOTS.googleReviews);
}
export function getGoogleSearchProviderStatus(): PendingProviderStatus {
  return slotStatus("google_search", SLOTS.googleSearch);
}
export function getWebsiteProviderStatus(): PendingProviderStatus {
  return slotStatus("website", SLOTS.website);
}

export function getAllPendingProviderStatuses(): PendingProviderStatus[] {
  return [
    getGoogleBusinessProviderStatus(),
    getGoogleReviewsProviderStatus(),
    getGoogleSearchProviderStatus(),
    getWebsiteProviderStatus(),
  ];
}
