import { WatchtowerEvent } from '../types/watchtower';

export class WatchtowerPresentationMapper {
  
  static mapToViewModel(rawEvent: any): WatchtowerEvent {
    // Determine direction from raw event, if available, otherwise null
    const direction = rawEvent.direction || (rawEvent.identity ? rawEvent.identity.direction : null);
    
    return {
      identity: rawEvent.identity,
      title: rawEvent.title,
      impact: rawEvent.impact,
      status: rawEvent.status,
      competitors: rawEvent.competitors || [],
      timeDetected: rawEvent.timeDetected,
      category: rawEvent.category,
      whatHappened: rawEvent.whatHappened,
      whyItMatters: rawEvent.whyItMatters,
      recommendedResponse: rawEvent.recommendedResponse,
      evidenceText: rawEvent.evidenceText,
      
      displayTitle: this.translateTitle(rawEvent.kind || rawEvent.category, direction),
      displayCategory: this.translateCategory(rawEvent.category || rawEvent.kind),
      displayImpact: this.translateImpact(rawEvent.impact),
      displayStatus: this.translateStatus(rawEvent.status),
      displayDescription: rawEvent.whatHappened || this.generateFallbackDescription(rawEvent.kind, rawEvent.competitors),
      displayCompetitorNames: this.formatCompetitors(rawEvent.competitors || []),
      displayDate: this.formatRelativeDate(rawEvent.timeDetected),
      
      hasTrendData: false, // Explicitly false as per requirements unless real backend data exists
      trendValue: null,
      trendLabel: null,
    };
  }

  private static translateTitle(kind: string, direction: string | null): string {
    const k = (kind || '').toLowerCase();
    
    let directionText = 'shift';
    if (direction === 'increased') directionText = 'increase';
    if (direction === 'decreased') directionText = 'decrease';

    if (k.includes('posting_cadence') || k.includes('posting_frequency')) {
      return `Posting Cadence ${this.toTitleCase(directionText)}`;
    }
    if (k.includes('offer_positioning')) {
      return `Offer Positioning ${this.toTitleCase(directionText)}`;
    }
    if (k.includes('messaging_angle') || k.includes('messaging')) {
      return `Messaging Angle ${this.toTitleCase(directionText)}`;
    }
    if (k.includes('campaign') || k.includes('ugc')) {
      return `New UGC Campaign Detected`;
    }
    if (k.includes('promo')) {
      return `New Promo Detected`;
    }
    if (k.includes('content_format')) {
      return `Content Format ${this.toTitleCase(directionText)}`;
    }
    
    // Fallback: Title Case and remove underscores
    return this.toTitleCase(k.replace(/_/g, ' ')) + ` ${directionText}`;
  }

  static translateCategory(category: string): string {
    const c = (category || '').toLowerCase();
    if (c.includes('offer') || c.includes('positioning')) {
      return c.includes('promo') ? 'Offer / Promotion' : 'Offer / Positioning';
    }
    if (c.includes('campaign') || c.includes('ugc')) return 'Campaign / UGC';
    if (c.includes('message') || c.includes('messaging') || c.includes('angle')) return 'Messaging / Positioning';
    if (c.includes('content') || c.includes('format') || c.includes('video')) return 'Content / Video';
    if (c.includes('cadence') || c.includes('posting')) return 'Posting Cadence';
    return this.toTitleCase(c.replace(/_/g, ' '));
  }

  private static translateImpact(impact: string): string {
    const i = (impact || '').toLowerCase();
    if (i.includes('high')) return 'High Impact';
    if (i.includes('medium')) return 'Medium Impact';
    if (i.includes('low')) return 'Low Impact';
    return 'Impact Undetermined';
  }

  private static translateStatus(status: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('first') || s.includes('candidate')) return 'First Observation';
    if (s.includes('confirmed')) return 'Confirmed';
    if (s.includes('archived')) return 'Archived';
    if (s.includes('dismissed')) return 'Dismissed';
    if (s.includes('superseded')) return 'Superseded';
    return 'Unknown Status';
  }

  private static generateFallbackDescription(kind: string, competitors: string[]): string | null {
    return null;
  }

  private static formatCompetitors(competitors: string[]): string {
    if (!competitors || competitors.length === 0) return 'Competitor unavailable';
    if (competitors.length === 1) return competitors[0];
    const displayed = competitors.slice(0, 3).join(', ');
    const remaining = competitors.length - 3;
    if (remaining > 0) return `${displayed} +${remaining} more`;
    return displayed;
  }

  private static formatRelativeDate(dateStr: string): string {
    if (!dateStr) return 'Unknown Date';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Fallback to raw if unparseable
    const today = new Date();
    const diffMs = today.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();

    const timeString = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (isToday) return `${diffHours} hr ago`;
    if (isYesterday) return `Yesterday, ${timeString}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  public static toTitleCase(str: string): string {
    return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
}
