import React from 'react';
import { View, Text, StyleSheet, useColorScheme, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

interface AdPreviewProps {
  headline: string;
  body: string;
  callToAction: string;
  platforms: string[];
}

const platformStyles: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; name: string }> = {
  Instagram: { icon: 'logo-instagram', color: '#E1306C', name: 'Instagram' },
  Facebook: { icon: 'logo-facebook', color: '#1877F2', name: 'Facebook' },
  Twitter: { icon: 'logo-twitter', color: '#1DA1F2', name: 'Twitter' },
  LinkedIn: { icon: 'logo-linkedin', color: '#0A66C2', name: 'LinkedIn' },
  'Meta Ads': { icon: 'logo-facebook', color: '#1877F2', name: 'Meta' },
  'Google Ads': { icon: 'logo-google', color: '#4285F4', name: 'Google' },
};

export function AdPreview({ headline, body, callToAction, platforms }: AdPreviewProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Text style={[styles.title, { color: colors.text }]}>Ad Preview</Text>
      
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.platformsRow}
      >
        {platforms.map(platform => {
          const style = platformStyles[platform] || { icon: 'globe', color: colors.primary, name: platform };
          return (
            <View key={platform} style={[styles.platformBadge, { backgroundColor: style.color + '20' }]}>
              <Ionicons name={style.icon} size={14} color={style.color} />
              <Text style={[styles.platformName, { color: style.color }]}>{style.name}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.preview, { backgroundColor: colors.inputBackground }]}>
        <View style={styles.previewHeader}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Ionicons name="business" size={16} color="#fff" />
          </View>
          <View>
            <Text style={[styles.brandName, { color: colors.text }]}>Your Brand</Text>
            <Text style={[styles.sponsored, { color: colors.textMuted }]}>Sponsored</Text>
          </View>
        </View>

        {headline ? (
          <Text style={[styles.headline, { color: colors.text }]}>{headline}</Text>
        ) : (
          <Text style={[styles.placeholder, { color: colors.textMuted }]}>Your headline will appear here...</Text>
        )}

        {body ? (
          <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={3}>{body}</Text>
        ) : (
          <Text style={[styles.placeholder, { color: colors.textMuted }]}>Your ad copy will appear here...</Text>
        )}

        <View style={[styles.ctaButton, { backgroundColor: colors.primary }]}>
          <Text style={styles.ctaText}>{callToAction || 'Learn More'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  platformsRow: {
    gap: 8,
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  platformName: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  preview: {
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  sponsored: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  headline: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
  },
  body: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  placeholder: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    fontStyle: 'italic',
  },
  ctaButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  ctaText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
