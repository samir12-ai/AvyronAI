import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response, Router } from 'express';
import { registerPerceptionRoutes } from '../perception-routes';
import { db } from '../db';

// Mock DB
vi.mock('../db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    execute: vi.fn(),
  },
}));

vi.mock('@shared/schema', () => ({
  pipelineChangeEvents: {
    id: 'id',
    accountId: 'accountId',
    campaignId: 'campaignId',
    competitorId: 'competitorId',
  },
  ciCompetitors: {
    id: 'id',
  },
  ciCompetitorPosts: {},
  ciInsightArticles: {},
  sivSemanticWindows: {},
  bossRuns: {},
  ciScrapeRuns: {},
}));

vi.mock('../watchtower/translator', () => ({
  translateSignalKind: (kind: string) => kind === 'pricing_change' ? 'Pricing Strategy Shift' : 'Market Signal',
}));

describe('GET /api/perception/watchtower-events/:eventId', () => {
  let app: Router;
  let mockRes: Partial<Response>;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = Router();
    registerPerceptionRoutes(app as any);

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
  });

  const runRoute = async (eventId: string, campaignContext = { accountId: 'tenant-a', campaignId: 'campaign-1' }) => {
    // Find the registered route
    const layer = app.stack.find((r: any) => r.route && r.route.path === '/api/perception/watchtower-events/:eventId');
    if (!layer) throw new Error('Route not found');

    const req = {
      params: { eventId },
      campaignContext,
    } as unknown as Request;

    // The requireCampaign middleware is skipped because we mock the actual layer, or rather, the real app uses requireCampaign but we don't have supertest. 
    // Wait, the stack actually has multiple handlers for that route. The last one is our function.
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    await handler(req, mockRes as Response, () => {});
  };

  it('should return 404 if event is deleted or not found', async () => {
    (db as any).where.mockResolvedValueOnce([]); // No row
    
    await runRoute('event-123');
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ success: false, error: 'EVENT_NOT_FOUND' });
  });

  it('should return 404 on unauthorized cross-tenant access', async () => {
    (db as any).where.mockResolvedValueOnce([{
      event: { id: 'event-123', campaignId: 'campaign-2', accountId: 'tenant-b' },
      competitor: null
    }]);

    await runRoute('event-123');
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ success: false, error: 'EVENT_NOT_FOUND' });
  });

  it('should map the typed contract strictly', async () => {
    const mockDate = new Date('2026-08-01T12:00:00Z');
    
    (db as any).where.mockResolvedValueOnce([{
      event: { 
        id: 'evt-1', 
        campaignId: 'campaign-1', 
        accountId: 'tenant-a',
        competitorId: 'comp-1',
        kind: 'pricing_change',
        severity: 'major',
        status: 'confirmed',
        evidence: JSON.stringify({ notes: ['Price increased by 10%'] }),
        baselineSnapshotId: 'snap-1',
        currentSnapshotId: 'snap-2',
        validatedAt: mockDate,
        createdAt: mockDate,
        updatedAt: mockDate,
        schemaVersion: '1.0',
        engineVersion: '1.1',
        classifierVersion: '2.0',
        watchtowerVersion: '3.0'
      },
      competitor: {
        id: 'comp-1',
        name: 'Rival Corp'
      }
    }]);

    await runRoute('evt-1');
    
    expect(jsonMock).toHaveBeenCalled();
    const payload = jsonMock.mock.calls[0][0];
    expect(payload.success).toBe(true);
    
    const data = payload.data;
    
    expect(data.identity.eventId).toBe('evt-1');
    expect(data.identity.reasoningRunId).toBeNull();
    expect(data.event.semanticKind).toBe('pricing_change');
    expect(data.event.status).toBe('confirmed');
    expect(data.presentation.impactLabel).toBe('High Impact');
    expect(data.observation.whatChanged).toBe('Price increased by 10%');
    expect(data.observation.whyItMatters).toBeNull();
    expect(data.competitors[0].competitorName).toBe('Rival Corp');
    expect(data.lineage.complete).toBe(true);
    expect(data.lineage.missingFields.length).toBe(0);
    expect(data.event.detectedAt).toBe(mockDate.toISOString());
  });

  it('should return missing evidence state when evidence is empty', async () => {
    (db as any).where.mockResolvedValueOnce([{
      event: { 
        id: 'evt-2', 
        campaignId: 'campaign-1', 
        accountId: 'tenant-a',
        evidence: null,
      },
      competitor: null
    }]);

    await runRoute('evt-2');
    
    expect(jsonMock).toHaveBeenCalled();
    const data = jsonMock.mock.calls[0][0].data;
    expect(data.lineage.complete).toBe(false);
    expect(data.lineage.missingFields).toContain('evidence');
    expect(data.observation.whatChanged).toBeNull();
  });
});
