import { randomUUID } from "crypto";

export type AuthorityType = 
  | "AUDIENCE_PAIN"
  | "TARGET_COVERAGE"
  | "PRODUCT_FIT"
  | "CORE_STRATEGIC_PAIN"
  | "PRODUCT_TRUTH_FACT"
  | "MI3_COMPETITIVE_FACT"
  | "DIFFERENTIATION"
  | "POSITIONING";

export interface AuthorityEnvelope {
  authorityId: string;
  authorityType: AuthorityType;
  accountId: string;
  campaignId: string;
  jobId: string;
  sourceSnapshotId?: string;
  parentAuthorityIds: string[];
  createdAt: number;
}

export function createAuthorityId(): string {
  return randomUUID();
}
