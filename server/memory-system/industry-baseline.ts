import type { IndustryBaseline } from "./types";

function parseBudget(budgetStr: string | null | undefined): number {
  if (!budgetStr) return 0;
  return parseInt(budgetStr.replace(/[^0-9]/g, "")) || 0;
}

function volumeMultiplierFromBudget(budget: number): number {
  if (budget >= 5000) return 1.5;
  if (budget >= 2000) return 1.2;
  if (budget <= 500)  return 0.7;
  return 1.0;
}

function classifyBusinessType(businessType: string): { isVisual: boolean; isService: boolean } {
  const lower = (businessType || "").toLowerCase();
  const isVisual  = ["photography", "fashion", "beauty", "food", "restaurant", "fitness", "travel", "real estate", "interior design", "art", "design"].some(t => lower.includes(t));
  const isService = ["consulting", "coaching", "legal", "accounting", "saas", "tech", "software", "agency", "clinic", "medical", "dental"].some(t => lower.includes(t));
  return { isVisual, isService };
}

export function deriveIndustryBaseline(
  objective: string | null | undefined,
  businessType: string | null | undefined,
  monthlyBudget: string | null | undefined,
): IndustryBaseline {
  const obj = (objective || "AWARENESS").toUpperCase();
  const { isVisual, isService } = classifyBusinessType(businessType || "");
  const budget = parseBudget(monthlyBudget);
  const vm = volumeMultiplierFromBudget(budget);

  let base = { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };

  switch (obj) {
    case "AWARENESS":
      base = isVisual
        ? { reelsPerWeek: 4, postsPerWeek: 1, storiesPerDay: 2, carouselsPerWeek: 1, videosPerWeek: 1 }
        : { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };
      break;
    case "LEADS":
      base = isService
        ? { reelsPerWeek: 2, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 }
        : { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
    case "SALES":
    case "REVENUE":
      base = isVisual
        ? { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 2, carouselsPerWeek: 2, videosPerWeek: 1 }
        : { reelsPerWeek: 2, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 };
      break;
    case "AUTHORITY":
      base = isService
        ? { reelsPerWeek: 1, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 3, videosPerWeek: 1 }
        : { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
    case "FOLLOWERS":
      base = { reelsPerWeek: 5, postsPerWeek: 1, storiesPerDay: 2, carouselsPerWeek: 1, videosPerWeek: 0 };
      break;
    default:
      base = { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 };
  }

  return {
    reelsPerWeek:     Math.max(1, Math.round(base.reelsPerWeek * vm)),
    postsPerWeek:     Math.max(1, Math.round(base.postsPerWeek * vm)),
    storiesPerDay:    Math.max(0, Math.round(base.storiesPerDay * vm)),
    carouselsPerWeek: Math.max(0, Math.round(base.carouselsPerWeek * vm)),
    videosPerWeek:    Math.max(0, Math.round(base.videosPerWeek * vm)),
    objective:        obj,
    businessType:     businessType || "general",
    confidenceScore:  0.3,
    source:           "derived",
  };
}
