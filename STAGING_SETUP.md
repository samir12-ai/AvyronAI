# MarketMind AI — Staging Environment Setup Guide

## Overview

This guide walks through creating a fully isolated staging environment for testing subscription flows, billing states, and feature access — with zero risk to production data or users.

---

## Step 1: Create the Staging Replit Project

1. Open this Replit project
2. Click the three-dot menu → **Fork** (or duplicate the project)
3. Name it something like `marketmind-staging`
4. This gives you a completely separate project with:
   - Its own isolated database (provisioned automatically)
   - Its own deployment URL
   - Its own environment variables

---

## Step 2: Set Environment Variables in Staging

In the staging project, go to **Secrets** and set these values (different from production):

| Variable | Production Value | Staging Value |
|----------|-----------------|---------------|
| `JWT_SECRET` | Your production secret | Any different random string |
| `STRIPE_WEBHOOK_SECRET` | Live webhook secret | Stripe test webhook secret |
| `DATABASE_URL` | Auto-set by Replit | Auto-set by Replit (different DB) |

All other env vars (OpenAI, Gemini, etc.) can be the same as production — they don't affect billing isolation.

---

## Step 3: Set Up Stripe Test Mode

1. Log into [dashboard.stripe.com](https://dashboard.stripe.com)
2. Toggle **Test mode** (top-right switch)
3. Go to **Developers → Webhooks** → Add endpoint pointing to your staging URL:
   ```
   https://your-staging-url.replit.app/api/stripe/webhook
   ```
4. Copy the **test webhook signing secret** → paste into staging `STRIPE_WEBHOOK_SECRET`
5. Use Stripe's **test card numbers** (e.g., `4242 4242 4242 4242`) for all payments in staging

---

## Step 4: Add Your Staging Account as Admin

In `server/auth.ts`, the `ADMIN_ACCOUNT_IDS` set controls who can access the staging admin API:

```typescript
const ADMIN_ACCOUNT_IDS = new Set([
  "a2d87878-a1e9-41ea-a8a5-90beff569673",  // existing admin
]);
```

After registering in the staging environment, your new account ID will appear in the database.
Query it and add it to `ADMIN_ACCOUNT_IDS` in the staging project's `server/auth.ts`.

---

## Step 5: Using the Staging Admin API

All endpoints require a valid JWT from your admin account (`Authorization: Bearer <token>`).

### List all users and their subscription state
```
GET /api/admin/staging/users
```
Returns all users with `resolvedStatus`, `trialDaysRemaining`, `videoCredits`, etc.

---

### Simulate a subscription scenario for a user
```
POST /api/admin/staging/users/:userId/simulate/:scenario
```

Available scenarios:

| Scenario | What it sets |
|----------|-------------|
| `trial_active` | Fresh 7-day trial starting now |
| `trial_expiring` | Trial with 1 day remaining |
| `trial_expired` | Trial ended 1 minute ago (triggers paywall) |
| `active_growth` | Active paid subscription, Growth plan, 2 video credits |
| `active_ultra` | Active paid subscription, Ultra plan, 5 video credits |
| `downgraded` | Expired subscription, no credits |

**Example:**
```bash
curl -X POST https://your-staging-url/api/admin/staging/users/USER_ID/simulate/trial_expired \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

### Manually set specific fields
```
POST /api/admin/staging/users/:userId/set-subscription
```
Body (any combination):
```json
{
  "subscriptionStatus": "active",
  "planType": "paid",
  "videoCredits": 3,
  "trialEnd": "2026-04-15T00:00:00Z"
}
```
`subscriptionStatus` must be one of: `trial`, `active`, `expired`

---

### Adjust video credits
```
POST /api/admin/staging/users/:userId/add-credits
```
Body:
```json
{ "amount": 5 }
```
Use negative numbers to deduct credits (floors at 0).

---

## Typical Testing Workflow

1. **Register a test account** in the staging app
2. **Call `/api/admin/staging/users`** to get the user's ID
3. **Simulate a scenario** (`trial_expired`, `active_ultra`, etc.)
4. **Reload the app** — the frontend reads subscription state fresh on each load
5. **Verify the correct gates and paywalls** appear
6. **Reset** by simulating another scenario and testing again

---

## What Is and Isn't Shared with Production

| Resource | Shared? |
|----------|---------|
| Database | No — staging has its own separate DB |
| User accounts | No — completely isolated |
| Stripe charges | No — test mode uses fake cards |
| AI API calls (OpenAI/Gemini) | Yes — same keys, real usage |
| App code | Yes — same codebase (staged version) |

---

## Notes

- The staging admin API (`/api/admin/staging/*`) is protected by `adminMiddleware` and only accessible to account IDs listed in `ADMIN_ACCOUNT_IDS`
- All changes made via the staging admin API are real database writes — they persist until you simulate a different scenario
- The staging admin API is present in production code but harmless there — it is only accessible to admin account IDs, and those IDs are explicitly hardcoded
