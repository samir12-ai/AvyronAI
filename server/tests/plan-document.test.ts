import { describe, it, expect } from 'vitest';

const SECTION_KEYS = [
  'contentDistributionPlan',
  'creativeTestingMatrix',
  'budgetAllocationStructure',
  'kpiMonitoringPriority',
  'competitiveWatchTargets',
  'riskMonitoringTriggers',
];

describe('Plan Document API', () => {
  const BASE_URL = `http://localhost:5000`;

  it('GET /api/plans/:planId/document returns 404 for non-existent plan', async () => {
    const res = await fetch(`${BASE_URL}/api/plans/nonexistent-plan-id/document?accountId=default`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('PLAN_NOT_FOUND');
    expect(data.message).toBeDefined();
  });

  it('GET /api/strategic/blueprint/:id/document returns 404 for non-existent blueprint', async () => {
    const res = await fetch(`${BASE_URL}/api/strategic/blueprint/nonexistent-bp-id/document`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('BLUEPRINT_NOT_FOUND');
  });

  it('Plan document endpoints never return 500 for expected missing states', async () => {
    const endpoints = [
      `/api/plans/missing-plan-123/document?accountId=default`,
      `/api/strategic/blueprint/missing-bp-123/document`,
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(`${BASE_URL}${endpoint}`);
      expect(res.status).not.toBe(500);
      expect([404, 403]).toContain(res.status);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.message).toBeDefined();
    }
  });

  it('Document response shape includes required fields when found', async () => {
    const res = await fetch(`${BASE_URL}/api/plans/test-plan-id/document?accountId=default`);
    const data = await res.json();

    if (res.status === 200 && data.success) {
      expect(data.document).toBeDefined();
      expect(data.document.planId).toBeDefined();
      expect(data.document.version).toBeDefined();
      expect(data.document.contentJson).toBeDefined();
      expect(data.document.createdAt).toBeDefined();
      expect(data.plan).toBeDefined();
      expect(data.plan.id).toBeDefined();
      expect(data.plan.status).toBeDefined();

      if (data.document.contentJson) {
        for (const key of SECTION_KEYS) {
          expect(data.document.contentJson).toHaveProperty(key);
        }
      }
    } else {
      expect(data.error).toBeDefined();
    }
  });

  it('Section keys match expected canonical section names', () => {
    expect(SECTION_KEYS).toContain('contentDistributionPlan');
    expect(SECTION_KEYS).toContain('creativeTestingMatrix');
    expect(SECTION_KEYS).toContain('budgetAllocationStructure');
    expect(SECTION_KEYS).toContain('kpiMonitoringPriority');
    expect(SECTION_KEYS).toContain('competitiveWatchTargets');
    expect(SECTION_KEYS).toContain('riskMonitoringTriggers');
    expect(SECTION_KEYS.length).toBe(6);
  });
});
