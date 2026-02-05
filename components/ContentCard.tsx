import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import type { ContentItem } from '@/lib/types';
import * as Haptics from 'expo-haptics';

interface ContentCardProps {
  item: ContentItem;
  onPress: () => void;
  onDelete: () => void;
}

const platformIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Instagram: 'logo-instagram',
  Facebook: 'logo-facebook',
  Twitter: 'logo-twitter',
  LinkedIn: 'logo-linkedin',
  TikTok: 'musical-notes',
};

const statusColors: Record<string, string> = {
  draft: '#6B7280',
  scheduled: '#F59E0B',
  published: '#22C55E',
};

export function ContentCard({ item, onPress, onDelete }: ContentCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const handleDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete();
  };

  return (
    <Pressable 
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { 
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
          opacity: pressed ? 0.9 : 1,
        }
      ]}
    >
      <View style={styles.header}>
        <View style={styles.platformContainer}>
          <Ionicons 
            name={platformIcons[item.platform] || 'globe'} 
            size={18} 
            color={colors.primary} 
          />
          <Text style={[styles.platform, { color: colors.text }]}>{item.platform}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColors[item.status] + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColors[item.status] }]} />
          <Text style={[styles.statusText, { color: statusColors[item.status] }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>
      
      <Text style={[styles.content, { color: colors.text }]} numberOfLines={3}>
        {item.content}
      </Text>
      
      <View style={styles.footer}>
        <View style={styles.metaContainer}>
          <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.meta, { color: colors.textMuted }]}>
            {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
          </Text>
          {item.scheduledDate && (
            <>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} style={{ marginLeft: 12 }} />
              <Text style={[styles.meta, { color: colors.textMuted }]}>
                {item.scheduledDate}
              </Text>
            </>
          )}
        </View>
        <Pressable onPress={handleDelete} hitSlop={12}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  platformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  platform: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  content: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
