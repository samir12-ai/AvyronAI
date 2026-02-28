import { describe, it, expect } from 'vitest';
import {
  normalizeMediaType,
  createRouteForContentType,
  CANONICAL_MEDIA_TYPES,
} from '../../lib/media-types';

describe('normalizeMediaType', () => {
  it('never returns undefined or null for any input', () => {
    const inputs = ['Video', 'video', 'REEL', 'reels', 'Image', 'poster', '', 'unknown', 'CAROUSEL', 'POST', 'STORY'];
    for (const input of inputs) {
      const result = normalizeMediaType(input);
      expect(result).not.toBeNull();
      expect(result).not.toBeUndefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(CANONICAL_MEDIA_TYPES).toContain(result);
    }
  });

  it('handles null and undefined', () => {
    expect(normalizeMediaType(null)).toBe('IMAGE');
    expect(normalizeMediaType(undefined)).toBe('IMAGE');
    expect(normalizeMediaType('')).toBe('IMAGE');
  });

  it('normalizes video variants to VIDEO', () => {
    expect(normalizeMediaType('video')).toBe('VIDEO');
    expect(normalizeMediaType('Video')).toBe('VIDEO');
    expect(normalizeMediaType('VIDEO')).toBe('VIDEO');
    expect(normalizeMediaType('videos')).toBe('VIDEO');
  });

  it('normalizes reel variants to REEL', () => {
    expect(normalizeMediaType('reel')).toBe('REEL');
    expect(normalizeMediaType('Reels')).toBe('REEL');
    expect(normalizeMediaType('REEL')).toBe('REEL');
    expect(normalizeMediaType('reels')).toBe('REEL');
  });

  it('normalizes image variants to IMAGE', () => {
    expect(normalizeMediaType('image')).toBe('IMAGE');
    expect(normalizeMediaType('Image')).toBe('IMAGE');
    expect(normalizeMediaType('poster')).toBe('IMAGE');
    expect(normalizeMediaType('photo')).toBe('IMAGE');
  });

  it('normalizes post/story/carousel', () => {
    expect(normalizeMediaType('post')).toBe('POST');
    expect(normalizeMediaType('POST')).toBe('POST');
    expect(normalizeMediaType('caption')).toBe('POST');
    expect(normalizeMediaType('story')).toBe('STORY');
    expect(normalizeMediaType('STORY')).toBe('STORY');
    expect(normalizeMediaType('stories')).toBe('STORY');
    expect(normalizeMediaType('carousel')).toBe('CAROUSEL');
    expect(normalizeMediaType('CAROUSEL')).toBe('CAROUSEL');
  });

  it('defaults unknown to IMAGE', () => {
    expect(normalizeMediaType('xyz')).toBe('IMAGE');
    expect(normalizeMediaType('banana')).toBe('IMAGE');
  });

  it('handles whitespace-padded and mixed-case inputs', () => {
    expect(normalizeMediaType(' Video ')).toBe('VIDEO');
    expect(normalizeMediaType('  REEL  ')).toBe('REEL');
    expect(normalizeMediaType(' image')).toBe('IMAGE');
    expect(normalizeMediaType('POST ')).toBe('POST');
  });

  it('always returns a canonical value from CANONICAL_MEDIA_TYPES', () => {
    const edgeCases = ['', null, undefined, 'garbage', 'mp4', 'jpeg', 'png', 'gif', 'audio', 'doc'];
    for (const input of edgeCases) {
      const result = normalizeMediaType(input as any);
      expect(CANONICAL_MEDIA_TYPES).toContain(result);
    }
  });

  it('normalizes plural forms correctly', () => {
    expect(normalizeMediaType('images')).toBe('IMAGE');
    expect(normalizeMediaType('videos')).toBe('VIDEO');
    expect(normalizeMediaType('reels')).toBe('REEL');
    expect(normalizeMediaType('stories')).toBe('STORY');
  });
});

describe('createRouteForContentType', () => {
  it('returns valid route data for every supported contentType', () => {
    const supportedTypes = ['VIDEO', 'REEL', 'IMAGE', 'CAROUSEL', 'POST', 'STORY'];
    const validTabs = ['content', 'designer', 'video'];
    for (const ct of supportedTypes) {
      const route = createRouteForContentType(ct);
      expect(route).toBeDefined();
      expect(validTabs).toContain(route.tab);
      expect(route.contentType).toBeDefined();
      expect(route.contentType.length).toBeGreaterThan(0);
      expect(route.label).toBeDefined();
      expect(route.label.length).toBeGreaterThan(0);
    }
  });

  it('VIDEO and REEL route to Reels Creation (content tab, reel contentType)', () => {
    const videoRoute = createRouteForContentType('VIDEO');
    expect(videoRoute.tab).toBe('content');
    expect(videoRoute.contentType).toBe('reel');
    expect(videoRoute.label).toBe('Reels Creation');

    const reelRoute = createRouteForContentType('REEL');
    expect(reelRoute.tab).toBe('content');
    expect(reelRoute.contentType).toBe('reel');

    expect(createRouteForContentType('video').tab).toBe('content');
    expect(createRouteForContentType('reel').tab).toBe('content');
    expect(createRouteForContentType('reels').tab).toBe('content');
  });

  it('IMAGE and CAROUSEL route to AI Designer (designer tab)', () => {
    expect(createRouteForContentType('IMAGE').tab).toBe('designer');
    expect(createRouteForContentType('CAROUSEL').tab).toBe('designer');
    expect(createRouteForContentType('image').tab).toBe('designer');
    expect(createRouteForContentType('poster').tab).toBe('designer');
  });

  it('POST and STORY route to AI Writer (content tab, post contentType)', () => {
    const postRoute = createRouteForContentType('POST');
    expect(postRoute.tab).toBe('content');
    expect(postRoute.contentType).toBe('post');
    expect(postRoute.label).toBe('AI Writer');

    const storyRoute = createRouteForContentType('STORY');
    expect(storyRoute.tab).toBe('content');
    expect(storyRoute.contentType).toBe('post');
  });

  it('case-insensitive matching for all types', () => {
    const variants = ['video', 'Video', 'VIDEO', 'reel', 'Reels', 'REEL', 'image', 'Image', 'carousel', 'post', 'story'];
    for (const v of variants) {
      const route = createRouteForContentType(v);
      expect(route).toBeDefined();
      expect(route.tab).toBeDefined();
    }
  });
});
