export function validateAuthorityLineage(
  jobContext: { jobId: string; campaignId: string; accountId: string },
  artifacts: {
    audienceSnapshotId?: string | null;
    audienceCampaignId?: string | null;
    audienceAccountId?: string | null;
    audienceJobId?: string | null;
    targetCoverageParentSnapshotId?: string | null; 
  }
) {
  if (!artifacts.audienceSnapshotId) return;
  if (artifacts.audienceCampaignId && artifacts.audienceCampaignId !== jobContext.campaignId) {
    throw new Error(`AUTHORITY_LINEAGE_MISMATCH: Audience campaign ${artifacts.audienceCampaignId} != job campaign ${jobContext.campaignId}`);
  }
  if (artifacts.audienceAccountId && artifacts.audienceAccountId !== jobContext.accountId) {
    throw new Error(`AUTHORITY_LINEAGE_MISMATCH: Audience account ${artifacts.audienceAccountId} != job account ${jobContext.accountId}`);
  }
  if (artifacts.audienceJobId && artifacts.audienceJobId !== jobContext.jobId) {
    throw new Error(`AUTHORITY_LINEAGE_MISMATCH: Audience job ${artifacts.audienceJobId} != job ${jobContext.jobId}`);
  }
  if (artifacts.targetCoverageParentSnapshotId && artifacts.targetCoverageParentSnapshotId !== artifacts.audienceSnapshotId) {
    throw new Error(`AUTHORITY_LINEAGE_MISMATCH: Target Coverage references audience ${artifacts.targetCoverageParentSnapshotId}, but current audience is ${artifacts.audienceSnapshotId}`);
  }
}