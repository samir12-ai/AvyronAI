import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BrandProfile, ContentItem, Campaign, Ad, PlatformConnection, PostingSchedule, MediaItem, ScheduledPost, MetaConnection } from './types';

const KEYS = {
  BRAND_PROFILE: 'marketmind_brand_profile',
  CONTENT_ITEMS: 'marketmind_content_items',
  CAMPAIGNS: 'marketmind_campaigns',
  ADS: 'marketmind_ads',
  PLATFORM_CONNECTIONS: 'marketmind_platform_connections',
  POSTING_SCHEDULES: 'marketmind_posting_schedules',
  MEDIA_ITEMS: 'marketmind_media_items',
  SCHEDULED_POSTS: 'marketmind_scheduled_posts',
  META_CONNECTION: 'marketmind_meta_connection',
};

const defaultBrandProfile: BrandProfile = {
  name: '',
  industry: '',
  tone: 'Professional',
  targetAudience: '',
  platforms: ['Instagram', 'Facebook'],
};

const defaultPlatformConnections: PlatformConnection[] = [
  { id: 'instagram', name: 'Instagram', isConnected: false },
  { id: 'facebook', name: 'Facebook', isConnected: false },
  { id: 'twitter', name: 'Twitter', isConnected: false },
  { id: 'linkedin', name: 'LinkedIn', isConnected: false },
  { id: 'tiktok', name: 'TikTok', isConnected: false },
];

const defaultPostingSchedules: PostingSchedule[] = [
  { platform: 'Instagram', enabled: false, times: ['09:00', '18:00'], days: ['Mon', 'Wed', 'Fri'] },
  { platform: 'Facebook', enabled: false, times: ['10:00', '15:00'], days: ['Mon', 'Tue', 'Thu'] },
  { platform: 'Twitter', enabled: false, times: ['08:00', '12:00', '17:00'], days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
  { platform: 'LinkedIn', enabled: false, times: ['09:00'], days: ['Tue', 'Thu'] },
];

export async function getBrandProfile(): Promise<BrandProfile> {
  try {
    const data = await AsyncStorage.getItem(KEYS.BRAND_PROFILE);
    return data ? JSON.parse(data) : defaultBrandProfile;
  } catch {
    return defaultBrandProfile;
  }
}

export async function saveBrandProfile(profile: BrandProfile): Promise<void> {
  await AsyncStorage.setItem(KEYS.BRAND_PROFILE, JSON.stringify(profile));
}

export async function getContentItems(): Promise<ContentItem[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.CONTENT_ITEMS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveContentItem(item: ContentItem): Promise<void> {
  const items = await getContentItems();
  const existingIndex = items.findIndex(i => i.id === item.id);
  if (existingIndex >= 0) {
    items[existingIndex] = item;
  } else {
    items.unshift(item);
  }
  await AsyncStorage.setItem(KEYS.CONTENT_ITEMS, JSON.stringify(items));
}

export async function deleteContentItem(id: string): Promise<void> {
  const items = await getContentItems();
  const filtered = items.filter(i => i.id !== id);
  await AsyncStorage.setItem(KEYS.CONTENT_ITEMS, JSON.stringify(filtered));
}

export async function getCampaigns(): Promise<Campaign[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.CAMPAIGNS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveCampaign(campaign: Campaign): Promise<void> {
  const campaigns = await getCampaigns();
  const existingIndex = campaigns.findIndex(c => c.id === campaign.id);
  if (existingIndex >= 0) {
    campaigns[existingIndex] = campaign;
  } else {
    campaigns.unshift(campaign);
  }
  await AsyncStorage.setItem(KEYS.CAMPAIGNS, JSON.stringify(campaigns));
}

export async function deleteCampaign(id: string): Promise<void> {
  const campaigns = await getCampaigns();
  const filtered = campaigns.filter(c => c.id !== id);
  await AsyncStorage.setItem(KEYS.CAMPAIGNS, JSON.stringify(filtered));
}

export async function getAds(): Promise<Ad[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.ADS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveAd(ad: Ad): Promise<void> {
  const ads = await getAds();
  const existingIndex = ads.findIndex(a => a.id === ad.id);
  if (existingIndex >= 0) {
    ads[existingIndex] = ad;
  } else {
    ads.unshift(ad);
  }
  await AsyncStorage.setItem(KEYS.ADS, JSON.stringify(ads));
}

export async function deleteAd(id: string): Promise<void> {
  const ads = await getAds();
  const filtered = ads.filter(a => a.id !== id);
  await AsyncStorage.setItem(KEYS.ADS, JSON.stringify(filtered));
}

export async function getPlatformConnections(): Promise<PlatformConnection[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.PLATFORM_CONNECTIONS);
    return data ? JSON.parse(data) : defaultPlatformConnections;
  } catch {
    return defaultPlatformConnections;
  }
}

export async function savePlatformConnections(connections: PlatformConnection[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.PLATFORM_CONNECTIONS, JSON.stringify(connections));
}

export async function getPostingSchedules(): Promise<PostingSchedule[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.POSTING_SCHEDULES);
    return data ? JSON.parse(data) : defaultPostingSchedules;
  } catch {
    return defaultPostingSchedules;
  }
}

export async function savePostingSchedules(schedules: PostingSchedule[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.POSTING_SCHEDULES, JSON.stringify(schedules));
}

export async function getMediaItems(): Promise<MediaItem[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.MEDIA_ITEMS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveMediaItem(item: MediaItem): Promise<void> {
  const items = await getMediaItems();
  const existingIndex = items.findIndex(i => i.id === item.id);
  if (existingIndex >= 0) {
    items[existingIndex] = item;
  } else {
    items.unshift(item);
  }
  await AsyncStorage.setItem(KEYS.MEDIA_ITEMS, JSON.stringify(items));
}

export async function deleteMediaItem(id: string): Promise<void> {
  const items = await getMediaItems();
  const filtered = items.filter(i => i.id !== id);
  await AsyncStorage.setItem(KEYS.MEDIA_ITEMS, JSON.stringify(filtered));
}

export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.SCHEDULED_POSTS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveScheduledPost(post: ScheduledPost): Promise<void> {
  const posts = await getScheduledPosts();
  const existingIndex = posts.findIndex(p => p.id === post.id);
  if (existingIndex >= 0) {
    posts[existingIndex] = post;
  } else {
    posts.unshift(post);
  }
  await AsyncStorage.setItem(KEYS.SCHEDULED_POSTS, JSON.stringify(posts));
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const posts = await getScheduledPosts();
  const filtered = posts.filter(p => p.id !== id);
  await AsyncStorage.setItem(KEYS.SCHEDULED_POSTS, JSON.stringify(filtered));
}

const defaultMetaConnection: MetaConnection = {
  isConnected: false,
};

export async function getMetaConnection(): Promise<MetaConnection> {
  try {
    const data = await AsyncStorage.getItem(KEYS.META_CONNECTION);
    return data ? JSON.parse(data) : defaultMetaConnection;
  } catch {
    return defaultMetaConnection;
  }
}

export async function saveMetaConnection(connection: MetaConnection): Promise<void> {
  await AsyncStorage.setItem(KEYS.META_CONNECTION, JSON.stringify(connection));
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export { generateId };
