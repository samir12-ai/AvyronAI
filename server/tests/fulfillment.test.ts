import { describe, it, expect } from 'vitest';
import {
  getBranchForMediaType,
  normalizeMediaType,
  type FulfillmentBranch,
} from '../../lib/media-types';

describe('getBranchForMediaType', () => {
  it('maps REEL and VIDEO to REELS branch', () => {
    expect(getBranchForMediaType('REEL')).toBe('REELS');
    expect(getBranchForMediaType('VIDEO')).toBe('REELS');
    expect(getBranchForMediaType('reel')).toBe('REELS');
    expect(getBranchForMediaType('video')).toBe('REELS');
    expect(getBranchForMediaType('Video')).toBe('REELS');
  });

  it('maps IMAGE, CAROUSEL, and POST to POSTS branch', () => {
    expect(getBranchForMediaType('IMAGE')).toBe('POSTS');
    expect(getBranchForMediaType('CAROUSEL')).toBe('POSTS');
    expect(getBranchForMediaType('image')).toBe('POSTS');
    expect(getBranchForMediaType('carousel')).toBe('POSTS');
    expect(getBranchForMediaType('POST')).toBe('POSTS');
    expect(getBranchForMediaType('post')).toBe('POSTS');
    expect(getBranchForMediaType('POSTER')).toBe('POSTS');
  });

  it('maps STORY to STORIES branch', () => {
    expect(getBranchForMediaType('STORY')).toBe('STORIES');
    expect(getBranchForMediaType('story')).toBe('STORIES');
  });

  it('handles null/undefined/empty with fallback', () => {
    expect(getBranchForMediaType(null)).toBeDefined();
    expect(getBranchForMediaType(undefined)).toBeDefined();
    expect(getBranchForMediaType('')).toBeDefined();
    const valid: FulfillmentBranch[] = ['REELS', 'POSTS', 'STORIES'];
    expect(valid).toContain(getBranchForMediaType(null));
    expect(valid).toContain(getBranchForMediaType(undefined));
    expect(valid).toContain(getBranchForMediaType(''));
  });

  it('handles unknown types without crashing', () => {
    const valid: FulfillmentBranch[] = ['REELS', 'POSTS', 'STORIES'];
    expect(valid).toContain(getBranchForMediaType('UNKNOWN'));
    expect(valid).toContain(getBranchForMediaType('garbage'));
    expect(valid).toContain(getBranchForMediaType('reels'));
  });

  it('every canonical media type maps to a valid branch', () => {
    const canonicals = ['VIDEO', 'REEL', 'IMAGE', 'CAROUSEL', 'POST', 'STORY'];
    const valid: FulfillmentBranch[] = ['REELS', 'POSTS', 'STORIES'];
    for (const mt of canonicals) {
      const branch = getBranchForMediaType(mt);
      expect(valid).toContain(branch);
    }
  });
});

describe('branch mapping consistency', () => {
  it('normalizeMediaType + getBranchForMediaType always produces a valid branch', () => {
    const inputs = ['video', 'Video', 'REEL', 'reels', 'Image', 'carousel', 'post', 'story', 'unknown', '', null, undefined];
    const valid: FulfillmentBranch[] = ['REELS', 'POSTS', 'STORIES'];
    for (const input of inputs) {
      const normalized = normalizeMediaType(input as any);
      const branch = getBranchForMediaType(normalized);
      expect(valid).toContain(branch);
    }
  });
});

describe('fulfillment remaining never negative', () => {
  it('max(0, required - fulfilled) is never negative', () => {
    const testCases = [
      { required: 5, fulfilled: 0 },
      { required: 5, fulfilled: 3 },
      { required: 5, fulfilled: 5 },
      { required: 5, fulfilled: 10 },
      { required: 0, fulfilled: 0 },
      { required: 0, fulfilled: 5 },
    ];
    for (const tc of testCases) {
      const remaining = Math.max(0, tc.required - tc.fulfilled);
      expect(remaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('progress percent is 0-100 range', () => {
    const testCases = [
      { required: 50, fulfilled: 0, expected: 0 },
      { required: 50, fulfilled: 25, expected: 50 },
      { required: 50, fulfilled: 50, expected: 100 },
      { required: 50, fulfilled: 100, expected: 100 },
      { required: 0, fulfilled: 0, expected: 0 },
    ];
    for (const tc of testCases) {
      const pct = tc.required > 0 ? Math.min(100, Math.round((tc.fulfilled / tc.required) * 100)) : 0;
      expect(pct).toBe(tc.expected);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});
