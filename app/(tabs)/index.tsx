import React, { useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { MetricCard } from '@/components/MetricCard';
import { MiniChart } from '@/components/MiniChart';
import { QuickAction } from '@/components/QuickAction';
import { ContentCard } from '@/components/ContentCard';

function AIManagementSummary({ colors, isDark }: { colors: typeof Colors.light; isDark: boolean }) {
  const { scheduledPosts, metaConnection, contentItems } = useApp();
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const published = scheduledPosts.filter(p => p.status === 'published').length;
    const pending = scheduledPosts.filter(p => p.status === 'pending').length;
    const failed = scheduledPosts.filter(p => p.status === 'failed').length;
    const totalContent = contentItems.length;
    return { published, pending, failed, totalContent };
  }, [scheduledPosts, contentItems]);

  return (
    <Pressable 
      onPress={() => router.push('/(tabs)/ai-management')}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
    >
      <LinearGradient
        colors={isDark ? ['#1E293B', '#0F172A'] : ['#F0F4FF', '#E8EEFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.aiSummaryCard, { borderColor: isDark ? '#334155' : '#D1D9F0' }]}
      >
        <View style={styles.aiSummaryHeader}>
          <View style={styles.aiSummaryTitleRow}>
            <Ionicons name="hardware-chip" size={20} color={colors.primary} />
            <Text style={[styles.aiSummaryTitle, { color: colors.text }]}>
              {t('dashboard.aiManagementHub')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>

        <View style={styles.aiStatsRow}>
          <View style={styles.aiStatItem}>
            <View style={[styles.aiStatDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.aiStatValue, { color: colors.text }]}>{stats.published}</Text>
            <Text style={[styles.aiStatLabel, { color: colors.textSecondary }]}>
              {t('dashboard.published')}
            </Text>
          </View>
          <View style={[styles.aiStatDivider, { backgroundColor: isDark ? '#334155' : '#D1D9F0' }]} />
          <View style={styles.aiStatItem}>
            <View style={[styles.aiStatDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.aiStatValue, { color: colors.text }]}>{stats.pending}</Text>
            <Text style={[styles.aiStatLabel, { color: colors.textSecondary }]}>
              {t('dashboard.queued')}
            </Text>
          </View>
          <View style={[styles.aiStatDivider, { backgroundColor: isDark ? '#334155' : '#D1D9F0' }]} />
          <View style={styles.aiStatItem}>
            <View style={[styles.aiStatDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.aiStatValue, { color: colors.text }]}>{stats.totalContent}</Text>
            <Text style={[styles.aiStatLabel, { color: colors.textSecondary }]}>
              {t('dashboard.contentCreated')}
            </Text>
          </View>
        </View>

        <View style={[styles.metaStatusRow, { 
          backgroundColor: metaConnection.isConnected ? colors.success + '12' : colors.accent + '12',
          borderColor: metaConnection.isConnected ? colors.success + '25' : colors.accent + '25',
        }]}>
          <View style={[styles.metaStatusDot, { 
            backgroundColor: metaConnection.isConnected ? colors.success : colors.accent 
          }]} />
          <Text style={[styles.metaStatusText, { color: colors.textSecondary }]}>
            {metaConnection.isConnected 
              ? `Meta: ${metaConnection.pageName || 'Connected'}` 
              : t('dashboard.metaNotConnected')
            }
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

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

        <AIManagementSummary colors={colors} isDark={isDark} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('dashboard.quickActions')}</Text>
          <View style={styles.actionsGrid}>
            <QuickAction 
              icon="create-outline" 
              label={t('dashboard.createContent')} 
              onPress={() => router.push('/(tabs)/create')}
            />
            <QuickAction 
              icon="hardware-chip-outline" 
              label={t('dashboard.aiManage')} 
              onPress={() => router.push('/(tabs)/ai-management')}
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
  aiSummaryCard: {
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  aiSummaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiSummaryTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  aiStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  aiStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  aiStatDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  aiStatValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 2,
  },
  aiStatLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center' as const,
  },
  aiStatDivider: {
    width: 1,
    height: 36,
  },
  metaStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  metaStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaStatusText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
