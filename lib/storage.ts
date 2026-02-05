import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BrandProfile, ContentItem, Campaign } from './types';

const KEYS = {
  BRAND_PROFILE: 'marketmind_brand_profile',
  CONTENT_ITEMS: 'marketmind_content_items',
  CAMPAIGNS: 'marketmind_campaigns',
};

const defaultBrandProfile: BrandProfile = {
  name: '',
  industry: '',
  tone: 'Professional',
  targetAudience: '',
  platforms: ['Instagram', 'Facebook'],
};

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

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export { generateId };
