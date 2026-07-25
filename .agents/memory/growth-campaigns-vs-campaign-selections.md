---
name: growth_campaigns vs campaign_selections tenant model
description: Why user campaigns don't live in growth_campaigns, and how to tenant-scope reads keyed by campaignId.
---

# growth_campaigns vs campaign_selections

Real user campaigns are created **only** in `campaign_selections` (id/pk is a UUID; the
human campaign id `campaign_<ts>_<rand>` is stored in `selected_campaign_id`, with
`account_id` for tenancy). `growth_campaigns` is legacy/audit-only — normal user flows
do **not** insert a row there, and engines tolerate the missing row via fallbacks.

**Gotcha:** the whole orchestrator keys off `eq(growthCampaigns.id, campaignId)`, yet
those rows usually don't exist for user campaigns. If you need to persist per-campaign
data that an engine will read by `campaignId` (e.g. the Phase-0 product_anchor), you must
UPSERT into `growth_campaigns` yourself at campaign-create time.

**Tenant safety:** `growth_campaigns` has **no `account_id` column**. Any read keyed
purely on `growthCampaigns.id` is cross-tenant-reachable (campaign ids are guessable-ish
timestamp+rand, and `/api/campaigns/select` accepts an arbitrary client-supplied id).
**How to apply:** scope such reads with an inner join to the caller's own
`campaign_selections` row: `innerJoin(campaignSelections, eq(campaignSelections.selectedCampaignId, growthCampaigns.id))`
+ `where(eq(campaignSelections.accountId, accountId))`. No matching ownership row → treat
the data as absent, never return another tenant's row.
