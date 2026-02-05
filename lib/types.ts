export interface BrandProfile {
  name: string;
  industry: string;
  tone: string;
  targetAudience: string;
  platforms: string[];
}

export interface ContentItem {
  id: string;
  type: 'post' | 'ad' | 'caption' | 'story';
  platform: string;
  content: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: 'draft' | 'scheduled' | 'published';
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'draft';
  budget: number;
  spent: number;
  platform: string;
  startDate: string;
  endDate?: string;
  reach: number;
  engagement: number;
  conversions: number;
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
