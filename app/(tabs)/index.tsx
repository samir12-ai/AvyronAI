import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { MetricCard } from '@/components/MetricCard';
import { MiniChart } from '@/components/MiniChart';
import { QuickAction } from '@/components/QuickAction';
import { ContentCard } from '@/components/ContentCard';

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { analytics, weeklyMetrics, contentItems, removeContentItem, isLoading, refreshData } = useApp();

  const recentContent = contentItems.slice(0, 3);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refreshData} />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>{t('dashboard.welcomeBack')}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{t('dashboard.title')}</Text>
        </View>

        <View style={styles.metricsGrid}>
          <View style={styles.metricsRow}>
            <MetricCard
              title={t('dashboard.totalReach')}
              value={formatNumber(analytics.totalReach)}
              change={analytics.reachChange}
              icon="eye-outline"
              isGradient
            />
            <MetricCard
              title={t('dashboard.engagement')}
              value={formatNumber(analytics.totalEngagement)}
              change={analytics.engagementChange}
              icon="heart-outline"
            />
          </View>
          <View style={styles.metricsRow}>
            <MetricCard
              title={t('dashboard.conversions')}
              value={formatNumber(analytics.totalConversions)}
              change={analytics.conversionsChange}
              icon="checkmark-circle-outline"
            />
            <MetricCard
              title={t('dashboard.adSpend')}
              value={'$' + formatNumber(analytics.totalSpent)}
              change={analytics.spentChange}
              icon="card-outline"
            />
          </View>
        </View>

        <MiniChart 
          data={weeklyMetrics} 
          metric="reach" 
          title={t('dashboard.weeklyPerformance')} 
        />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('dashboard.quickActions')}</Text>
          <View style={styles.actionsGrid}>
            <QuickAction 
              icon="create-outline" 
              label={t('dashboard.createContent')} 
              onPress={() => router.push('/(tabs)/create')}
            />
            <QuickAction 
              icon="megaphone-outline" 
              label={t('dashboard.newCampaign')} 
              onPress={() => router.push('/(tabs)/campaigns')}
              color={Colors.light.accent}
            />
            <QuickAction 
              icon="calendar-outline" 
              label={t('dashboard.schedule')} 
              onPress={() => router.push('/(tabs)/calendar')}
              color={Colors.light.accentOrange}
            />
          </View>
        </View>

        {recentContent.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('dashboard.recentContent')}</Text>
              <Text 
                style={[styles.seeAll, { color: colors.primary }]}
                onPress={() => router.push('/(tabs)/calendar')}
              >
                {t('dashboard.seeAll')}
              </Text>
            </View>
            <View style={styles.contentList}>
              {recentContent.map(item => (
                <ContentCard 
                  key={item.id}
                  item={item}
                  onPress={() => {}}
                  onDelete={() => removeContentItem(item.id)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
  },
  metricsGrid: {
    gap: 12,
    marginBottom: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  seeAll: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  contentList: {
    gap: 12,
  },
});
