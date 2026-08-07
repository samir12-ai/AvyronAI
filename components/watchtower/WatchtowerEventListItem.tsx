import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { WatchtowerEvent } from '@/types/watchtower';

interface Props {
  event: WatchtowerEvent;
  isSelected: boolean;
  onSelect: (eventId: string) => void;
}

const formatRelativeTime = (dateStr: string) => {
  if (!dateStr) return '';
  if (dateStr.includes('T') && dateStr.includes('Z')) {
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
    return '1mo+ ago';
  }
  return dateStr;
};

const formatCategory = (cat: string) => {
  if (!cat) return '';
  return cat
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

export default function WatchtowerEventListItem({ event, isSelected, onSelect }: Props) {
  const [isHovered, setIsHovered] = useState(false);

  const getImpactColor = (impact: string) => {
    const i = impact.toLowerCase();
    if (i.includes('high')) return '#DC2626'; // Red
    if (i.includes('medium')) return '#F59E0B'; // Orange
    if (i.includes('low')) return '#3B82F6'; // Blue
    return '#7C3AED';
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('confirmed')) return '#8B5CF6'; // Purple for badge
    if (s.includes('first')) return '#3B82F6'; // Blue for badge
    if (s.includes('archived')) return '#6B7280'; // Gray
    return '#8B5CF6'; 
  };

  const getIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('offer')) return 'speaker'; // megaphone
    if (t.includes('campaign')) return 'arrow-up';
    if (t.includes('messaging')) return 'message-square'; // quotes
    if (t.includes('content')) return 'play-circle';
    if (t.includes('promo')) return 'tag';
    if (t.includes('posting') || t.includes('cadence')) return 'activity';
    return 'alert-circle';
  };

  const impactColor = getImpactColor(event.displayImpact);
  const statusColor = getStatusColor(event.displayStatus);
  const iconName = getIcon(event.displayTitle);

  return (
    <Pressable 
      style={[
        styles.container, 
        isSelected && styles.containerSelected,
        isHovered && styles.containerHovered,
        Platform.OS === 'web' ? { transition: 'all 180ms ease' } as any : {}
      ]} 
      onPress={() => onSelect(event.identity.cardId)}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
    >
      <View style={[styles.leftBorderIndicator, { backgroundColor: impactColor }]} />
      
      <View style={styles.cardContent}>
        
        {/* Left Icon */}
        <View style={styles.iconCol}>
          <View style={[styles.iconBox, { backgroundColor: impactColor + '20', borderColor: impactColor + '40' }]}>
            <Feather name={iconName as any} size={24} color={impactColor} />
          </View>
        </View>

        {/* Main Body */}
        <View style={styles.mainCol}>
          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1}>{event.displayTitle}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: impactColor + '25', borderColor: impactColor + '40' }]}>
                <Text style={[styles.badgeText, { color: impactColor }]}>
                  {event.displayImpact.toUpperCase()}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: statusColor + '25', borderColor: statusColor + '40' }]}>
                <Text style={[styles.badgeText, { color: statusColor, textTransform: 'capitalize' }]}>
                  {event.displayStatus}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.description} numberOfLines={2}>
            {event.displayDescription || 'Detailed description unavailable.'}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.metaTextPrimary}>{formatCategory(event.displayCompetitorNames)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatRelativeTime(event.displayDate)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatCategory(event.displayCategory)}</Text>
          </View>
        </View>

        {/* Right Trend Area */}
        <View style={styles.rightCol}>
          <View style={styles.trendBox}>
            {event.hasTrendData ? (
              <>
                <Feather name="trending-up" size={16} color="#10B981" style={{ marginBottom: 4 }} />
                <Text style={styles.trendValue}>{event.trendValue}</Text>
                <Text style={styles.trendLabel}>{event.trendLabel}</Text>
              </>
            ) : (
              <Text style={styles.trendUnavailableText}></Text>
            )}
          </View>
          <View style={[
            styles.chevronBox,
            isHovered && styles.chevronBoxHovered,
            Platform.OS === 'web' ? { transition: 'all 180ms ease' } as any : {}
          ]}>
            <Feather 
              name="chevron-right" 
              size={20} 
              color={isHovered ? "#F9FAFB" : "#6B7280"} 
              style={[
                Platform.OS === 'web' ? { transition: 'transform 180ms ease' } as any : {},
                isHovered ? { transform: [{ translateX: 2 }] } : {}
              ]}
            />
          </View>
        </View>

      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
    position: 'relative',
    overflow: 'hidden',
  },
  containerSelected: {
    backgroundColor: '#1C212B',
    borderColor: '#2A3347',
  },
  containerHovered: {
    transform: [{ translateY: -2 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    borderColor: '#2A3347',
  },
  leftBorderIndicator: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  cardContent: {
    flexDirection: 'row',
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  iconCol: {
    marginRight: 24,
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  mainCol: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F9FAFB',
    letterSpacing: 0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 22,
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaTextPrimary: {
    fontSize: 13,
    color: '#D1D5DB',
    fontWeight: '600',
  },
  metaText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  metaDot: {
    fontSize: 13,
    color: '#4B5563',
    marginHorizontal: 8,
  },
  rightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
    minWidth: 80,
    justifyContent: 'flex-end',
  },
  trendBox: {
    alignItems: 'center',
    marginRight: 16,
  },
  trendValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  trendLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  trendUnavailableText: {
    fontSize: 11,
    color: '#4B5563',
    fontStyle: 'italic',
  },
  chevronBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  chevronBoxHovered: {
    borderColor: '#4B5563',
    backgroundColor: '#374151',
  }
});
