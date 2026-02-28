export interface BrandProfile {
  name: string;
  industry: string;
  tone: string;
  targetAudience: string;
  platforms: string[];
}

export interface PlatformConnection {
  id: string;
  name: string;
  isConnected: boolean;
  connectedAt?: string;
  accountName?: string;
}

export interface ContentItem {
  id: string;
  type: 'post' | 'ad' | 'caption' | 'story';
  platform: string;
  content: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: 'draft' | 'scheduled' | 'published';
  autoPublish?: boolean;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'draft';
  budget: number;
  spent: number;
  platform: string;
  platforms?: string[];
  startDate: string;
  endDate?: string;
  reach: number;
  engagement: number;
  conversions: number;
}

export interface Ad {
  id: string;
  campaignId: string;
  headline: string;
  body: string;
  callToAction: string;
  platforms: string[];
  status: 'active' | 'paused' | 'draft';
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  conversions: number;
  createdAt: string;
}

export interface AnalyticsData {
  totalReach: number;
  reachChange: number;
  totalEngagement: number;
  engagementChange: number;
  totalConversions: number;
  conversionsChange: number;
  totalSpent: number;
  spentChange: number;
}

export interface DailyMetric {
  date: string;
  reach: number;
  engagement: number;
  conversions: number;
}

export interface PostingSchedule {
  platform: string;
  enabled: boolean;
  times: string[];
  days: string[];
}

export interface MediaItem {
  id: string;
  type: 'video' | 'image' | 'poster';
  title: string;
  uri: string;
  thumbnail?: string;
  platform: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: 'draft' | 'scheduled' | 'published';
  createdAt: string;
  goal?: string;
  audience?: string;
  cta?: string;
  series?: string;
  offer?: string;
  serverPostId?: string;
  studioItemId?: string;
  autoCaption?: string;
}

export interface ScheduledPost {
  id: string;
  type: 'post' | 'reel' | 'story' | 'video';
  content: string;
  mediaId?: string;
  platform: string;
  scheduledDate: string;
  scheduledTime: string;
  status: 'pending' | 'published' | 'failed';
  createdAt: string;
}

export interface MetaConnection {
  isConnected: boolean;
  accessToken?: string;
  pageId?: string;
  pageName?: string;
  instagramAccountId?: string;
  connectedAt?: string;
  expiresAt?: string;
}
