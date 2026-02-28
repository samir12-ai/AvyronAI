export const CANONICAL_MEDIA_TYPES = ['VIDEO', 'REEL', 'IMAGE', 'CAROUSEL', 'POST', 'STORY'] as const;
export type CanonicalMediaType = (typeof CANONICAL_MEDIA_TYPES)[number];

const NORMALIZE_MAP: Record<string, CanonicalMediaType> = {
  video: 'VIDEO',
  videos: 'VIDEO',
  reel: 'REEL',
  reels: 'REEL',
  image: 'IMAGE',
  images: 'IMAGE',
  photo: 'IMAGE',
  poster: 'IMAGE',
  carousel: 'CAROUSEL',
  post: 'POST',
  caption: 'POST',
  story: 'STORY',
  stories: 'STORY',
};

export function normalizeMediaType(input: string | null | undefined): CanonicalMediaType {
  if (!input || typeof input !== 'string') {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[normalizeMediaType] empty/null input, defaulting to IMAGE');
    return 'IMAGE';
  }
  const key = input.trim().toLowerCase();
  const mapped = NORMALIZE_MAP[key];
  if (mapped) return mapped;
  const upper = key.toUpperCase() as CanonicalMediaType;
  if (CANONICAL_MEDIA_TYPES.includes(upper)) return upper;
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[normalizeMediaType] unknown value "${input}", defaulting to IMAGE`);
  return 'IMAGE';
}

export type FulfillmentBranch = 'VIDEO' | 'DESIGNER' | 'WRITER';

export function getBranchForMediaType(mediaType: string | null | undefined): FulfillmentBranch {
  const normalized = normalizeMediaType(mediaType);
  switch (normalized) {
    case 'VIDEO':
    case 'REEL':
      return 'VIDEO';
    case 'IMAGE':
    case 'CAROUSEL':
      return 'DESIGNER';
    case 'POST':
    case 'STORY':
      return 'WRITER';
    default:
      return 'WRITER';
  }
}

export type CreateFlowTarget = 'content' | 'designer' | 'video';

interface RouteMapping {
  tab: CreateFlowTarget;
  contentType: string;
  label: string;
}

export function createRouteForContentType(contentType: string): RouteMapping {
  const normalized = normalizeMediaType(contentType);
  switch (normalized) {
    case 'VIDEO':
    case 'REEL':
      return { tab: 'content', contentType: 'reel', label: 'Reels Creation' };
    case 'IMAGE':
    case 'CAROUSEL':
      return { tab: 'designer', contentType: 'post', label: 'AI Designer' };
    case 'POST':
    case 'STORY':
      return { tab: 'content', contentType: 'post', label: 'AI Writer' };
    default:
      return { tab: 'content', contentType: 'post', label: 'AI Writer' };
  }
}
