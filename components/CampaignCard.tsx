import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import type { Campaign } from '@/lib/types';
import * as Haptics from 'expo-haptics';

interface CampaignCardProps {
  campaign: Campaign;
  onPress: () => void;
  onToggle: () => void;
}

const statusColors: Record<string, string> = {
  active: '#22C55E',
  paused: '#F59E0B',
  completed: '#6B7280',
  draft: '#8B5CF6',
};

const platformIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Meta Ads': 'logo-facebook',
  'Google Ads': 'logo-google',
  Instagram: 'logo-instagram',
  Facebook: 'logo-facebook',
  Twitter: 'logo-twitter',
  LinkedIn: 'logo-linkedin',
};

export function CampaignCard({ campaign, onPress, onToggle }: CampaignCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const progress = campaign.budget > 0 ? (campaign.spent / campaign.budget) * 100 : 0;

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle();
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
        <View style={styles.titleContainer}>
          <Ionicons 
            name={platformIcons[campaign.platform] || 'megaphone'} 
            size={20} 
            color={colors.primary} 
          />
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {campaign.name}
          </Text>
        </View>
        <Pressable 
          onPress={handleToggle}
          style={[styles.statusButton, { backgroundColor: statusColors[campaign.status] + '20' }]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColors[campaign.status] }]} />
          <Text style={[styles.statusText, { color: statusColors[campaign.status] }]}>
            {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
          </Text>
        </Pressable>
      </View>

      <View style={styles.budgetContainer}>
        <View style={styles.budgetHeader}>
          <Text style={[styles.budgetLabel, { color: colors.textMuted }]}>Budget</Text>
          <Text style={[styles.budgetValue, { color: colors.text }]}>
            ${campaign.spent.toLocaleString()} / ${campaign.budget.toLocaleString()}
          </Text>
        </View>
        <View style={[styles.progressBar, { backgroundColor: colors.inputBackground }]}>
          <View 
            style={[
              styles.progressFill, 
              { 
                width: `${Math.min(progress, 100)}%`,
                backgroundColor: progress > 90 ? colors.warning : colors.primary,
              }
            ]} 
          />
        </View>
      </View>

      <View style={styles.metricsContainer}>
        <View style={styles.metric}>
          <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {campaign.reach.toLocaleString()}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Reach</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Ionicons name="heart-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {campaign.engagement.toLocaleString()}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Engagement</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Ionicons name="checkmark-circle-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.metricValue, { color: colors.text }]}>
            {campaign.conversions}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Conv.</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
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
  budgetContainer: {
    gap: 8,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  budgetValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#E5E7EB',
    opacity: 0.3,
  },
  metricValue: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
});
