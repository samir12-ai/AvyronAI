import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';

interface OverviewData {
  inventory: {
    totalCompetitors: number;
    activeCompetitors: number;
    totalPosts: number;
    totalComments: number;
    totalSnapshots: number;
  };
  queue: {
    globalRunning: number;
    globalMaxConcurrent: number;
    queuedJobs: number;
    perAccountBudget: number;
    accountTrackers: Record<string, { count: number; resetIn: number }>;
  };
  recentJobs: Array<{
    id: string;
    accountId: string;
    campaignId: string;
    status: string;
    collectionMode: string | null;
    dataStatus: string | null;
    totalPostsFetched: number;
    totalCommentsFetched: number;
    competitorCount: number;
    createdAt: string;
    completedAt: string | null;
    error: string | null;
  }>;
}

interface CompetitorData {
  competitors: Array<{
    id: string;
    name: string;
    platform: string;
    profileLink: string;
    isActive: boolean;
    accountId: string;
    campaignId: string;
    postCount: number;
    createdAt: string;
  }>;
}

interface FreshnessData {
  freshness: Array<{
    accountId: string;
    campaignId: string;
    dataStatus: string | null;
    ageHours: number;
    isFresh: boolean;
    createdAt: string;
  }>;
}

interface CrawlerData {
  queue: {
    globalRunning: number;
    globalMaxConcurrent: number;
    queuedJobs: number;
    perAccountBudget: number;
  };
  running: Array<{
    id: string;
    accountId: string;
    campaignId: string;
    collectionMode: string | null;
    totalPostsFetched: number;
    totalCommentsFetched: number;
    competitorCount: number;
    createdAt: string;
  }>;
  queued: Array<{
    id: string;
    accountId: string;
    campaignId: string;
    createdAt: string;
  }>;
  last24h: {
    completed: number;
    failed: number;
  };
}

type AdminTab = 'overview' | 'competitors' | 'freshness' | 'crawler';

async function adminFetch(path: string) {
  const url = new URL(path, getApiUrl());
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

export default function MarketDatabaseAdmin() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorData | null>(null);
  const [freshness, setFreshness] = useState<FreshnessData | null>(null);
  const [crawler, setCrawler] = useState<CrawlerData | null>(null);

  const loadTab = useCallback(async (tab: AdminTab, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case 'overview': {
          const data = await adminFetch('/api/admin/market/overview');
          setOverview(data);
          break;
        }
        case 'competitors': {
          const data = await adminFetch('/api/admin/market/competitors');
          setCompetitors(data);
          break;
        }
        case 'freshness': {
          const data = await adminFetch('/api/admin/market/freshness');
          setFreshness(data);
          break;
        }
        case 'crawler': {
          const data = await adminFetch('/api/admin/market/crawler-status');
          setCrawler(data);
          break;
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleTabChange = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    loadTab(tab);
  }, [loadTab]);

  React.useEffect(() => {
    loadTab('overview');
  }, []);

  const tabConfig: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'overview', label: 'Overview', icon: 'grid-outline' },
    { key: 'competitors', label: 'Inventory', icon: 'people-outline' },
    { key: 'freshness', label: 'Freshness', icon: 'time-outline' },
    { key: 'crawler', label: 'Crawler', icon: 'bug-outline' },
  ];

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': case 'COMPLETE': return '#22C55E';
      case 'RUNNING': case 'ENRICHING': return '#F59E0B';
      case 'FAILED': return '#EF4444';
      case 'QUEUED': return '#8B5CF6';
      case 'LIVE': return '#3B82F6';
      default: return colors.textSecondary;
    }
  };

  const renderOverview = () => {
    if (!overview) return null;
    const { inventory, queue, recentJobs } = overview;

    return (
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Market Database Inventory</Text>
        <View style={styles.statsGrid}>
          {[
            { label: 'Competitors', value: inventory.totalCompetitors, sub: `${inventory.activeCompetitors} active`, icon: 'people' as const },
            { label: 'Posts', value: inventory.totalPosts, sub: 'collected', icon: 'document-text' as const },
            { label: 'Comments', value: inventory.totalComments, sub: 'sampled', icon: 'chatbubbles' as const },
            { label: 'Snapshots', value: inventory.totalSnapshots, sub: 'generated', icon: 'analytics' as const },
          ].map(stat => (
            <View key={stat.label} style={[styles.statCard, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
              <Ionicons name={stat.icon} size={20} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.text }]}>{stat.value.toLocaleString()}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
              <Text style={[styles.statSub, { color: colors.textSecondary }]}>{stat.sub}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Queue Status</Text>
        <View style={[styles.queueCard, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Running Jobs</Text>
            <Text style={[styles.queueValue, { color: queue.globalRunning > 0 ? '#F59E0B' : '#22C55E' }]}>
              {queue.globalRunning} / {queue.globalMaxConcurrent}
            </Text>
          </View>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Queued Jobs</Text>
            <Text style={[styles.queueValue, { color: queue.queuedJobs > 0 ? '#8B5CF6' : colors.text }]}>
              {queue.queuedJobs}
            </Text>
          </View>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Per-Account Budget</Text>
            <Text style={[styles.queueValue, { color: colors.text }]}>{queue.perAccountBudget}/hr</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Recent Crawl Jobs</Text>
        {recentJobs.slice(0, 10).map(job => (
          <View key={job.id} style={[styles.jobRow, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
            <View style={styles.jobHeader}>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(job.status) + '20' }]}>
                <Text style={[styles.statusText, { color: statusColor(job.status) }]}>{job.status}</Text>
              </View>
              {job.collectionMode && (
                <View style={[styles.modeBadge, { backgroundColor: isDark ? '#2A2A3E' : '#E8E8EE' }]}>
                  <Text style={[styles.modeText, { color: colors.textSecondary }]}>{job.collectionMode}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.jobId, { color: colors.textSecondary }]}>{job.id.substring(0, 20)}...</Text>
            <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>
              {job.competitorCount} competitors · {job.totalPostsFetched} posts · {job.totalCommentsFetched} comments
            </Text>
            {job.error && <Text style={[styles.jobError, { color: '#EF4444' }]}>{job.error}</Text>}
            <Text style={[styles.jobTime, { color: colors.textSecondary }]}>
              {new Date(job.createdAt).toLocaleString()}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderCompetitors = () => {
    if (!competitors) return null;
    return (
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Competitor Inventory ({competitors.competitors.length})
        </Text>
        {competitors.competitors.map(c => (
          <View key={c.id} style={[styles.competitorRow, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
            <View style={styles.competitorHeader}>
              <Text style={[styles.competitorName, { color: colors.text }]}>{c.name}</Text>
              <View style={[styles.statusBadge, { backgroundColor: c.isActive ? '#22C55E20' : '#EF444420' }]}>
                <Text style={{ color: c.isActive ? '#22C55E' : '#EF4444', fontSize: 11, fontWeight: '600' }}>
                  {c.isActive ? 'ACTIVE' : 'INACTIVE'}
                </Text>
              </View>
            </View>
            <Text style={[styles.competitorMeta, { color: colors.textSecondary }]}>
              {c.platform} · {c.postCount} posts stored
            </Text>
            <Text style={[styles.competitorLink, { color: colors.primary }]} numberOfLines={1}>
              {c.profileLink}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderFreshness = () => {
    if (!freshness) return null;
    const fresh = freshness.freshness.filter(f => f.isFresh).length;
    const stale = freshness.freshness.filter(f => !f.isFresh).length;

    return (
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Freshness</Text>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
            <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
            <Text style={[styles.statValue, { color: '#22C55E' }]}>{fresh}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Fresh</Text>
            <Text style={[styles.statSub, { color: colors.textSecondary }]}>{"<"} 24h</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
            <Ionicons name="alert-circle" size={20} color="#EF4444" />
            <Text style={[styles.statValue, { color: '#EF4444' }]}>{stale}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Stale</Text>
            <Text style={[styles.statSub, { color: colors.textSecondary }]}>{">"} 24h</Text>
          </View>
        </View>

        {freshness.freshness.map((entry, idx) => (
          <View key={idx} style={[styles.freshnessRow, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
            <View style={styles.freshnessHeader}>
              <Ionicons
                name={entry.isFresh ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={entry.isFresh ? '#22C55E' : '#EF4444'}
              />
              <Text style={[styles.freshnessAge, { color: entry.isFresh ? '#22C55E' : '#EF4444' }]}>
                {entry.ageHours}h ago
              </Text>
              {entry.dataStatus && (
                <View style={[styles.statusBadge, { backgroundColor: statusColor(entry.dataStatus) + '20' }]}>
                  <Text style={[styles.statusText, { color: statusColor(entry.dataStatus) }]}>{entry.dataStatus}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.freshnessId, { color: colors.textSecondary }]}>
              Campaign: {entry.campaignId?.substring(0, 16)}...
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderCrawler = () => {
    if (!crawler) return null;
    return (
      <View>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Crawler Engine</Text>
        <View style={[styles.queueCard, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Active Workers</Text>
            <Text style={[styles.queueValue, { color: crawler.queue.globalRunning > 0 ? '#F59E0B' : '#22C55E' }]}>
              {crawler.queue.globalRunning} / {crawler.queue.globalMaxConcurrent}
            </Text>
          </View>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Queued</Text>
            <Text style={[styles.queueValue, { color: colors.text }]}>{crawler.queue.queuedJobs}</Text>
          </View>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Completed (24h)</Text>
            <Text style={[styles.queueValue, { color: '#22C55E' }]}>{crawler.last24h.completed}</Text>
          </View>
          <View style={styles.queueRow}>
            <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>Failed (24h)</Text>
            <Text style={[styles.queueValue, { color: crawler.last24h.failed > 0 ? '#EF4444' : colors.text }]}>
              {crawler.last24h.failed}
            </Text>
          </View>
        </View>

        {crawler.running.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Running Jobs</Text>
            {crawler.running.map(job => (
              <View key={job.id} style={[styles.jobRow, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
                <View style={styles.jobHeader}>
                  <View style={[styles.statusBadge, { backgroundColor: '#F59E0B20' }]}>
                    <Text style={[styles.statusText, { color: '#F59E0B' }]}>RUNNING</Text>
                  </View>
                  {job.collectionMode && (
                    <View style={[styles.modeBadge, { backgroundColor: isDark ? '#2A2A3E' : '#E8E8EE' }]}>
                      <Text style={[styles.modeText, { color: colors.textSecondary }]}>{job.collectionMode}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>
                  {job.competitorCount} competitors · {job.totalPostsFetched} posts · {job.totalCommentsFetched} comments
                </Text>
              </View>
            ))}
          </>
        )}

        {crawler.queued.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>
              Queued Jobs ({crawler.queued.length})
            </Text>
            {crawler.queued.map(job => (
              <View key={job.id} style={[styles.jobRow, { backgroundColor: isDark ? '#1E1E2E' : '#F8FAFC' }]}>
                <View style={[styles.statusBadge, { backgroundColor: '#8B5CF620' }]}>
                  <Text style={[styles.statusText, { color: '#8B5CF6' }]}>QUEUED</Text>
                </View>
                <Text style={[styles.jobId, { color: colors.textSecondary }]}>{job.id.substring(0, 24)}...</Text>
                <Text style={[styles.jobTime, { color: colors.textSecondary }]}>
                  {new Date(job.createdAt).toLocaleString()}
                </Text>
              </View>
            ))}
          </>
        )}
      </View>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading market data...</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle" size={32} color="#EF4444" />
          <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text>
          <Pressable style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => loadTab(activeTab)}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'competitors': return renderCompetitors();
      case 'freshness': return renderFreshness();
      case 'crawler': return renderCrawler();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#121218' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <Ionicons name="server-outline" size={22} color={colors.primary} />
        <Text style={[styles.headerTitle, { color: colors.text }]}>Market Database</Text>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>Admin Only</Text>
      </View>

      <View style={[styles.tabBar, { backgroundColor: isDark ? '#1A1A28' : '#F1F5F9' }]}>
        {tabConfig.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && { backgroundColor: colors.primary + '20' }]}
            onPress={() => handleTabChange(tab.key)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? colors.primary : colors.textSecondary}
            />
            <Text style={[
              styles.tabLabel,
              { color: activeTab === tab.key ? colors.primary : colors.textSecondary },
            ]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadTab(activeTab, true)} />
        }
      >
        {renderContent()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 12, fontWeight: '500', marginLeft: 'auto' },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 12,
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 4,
    borderRadius: 8,
  },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 40 },
  centerContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flex: 1,
    minWidth: '45%' as any,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statSub: { fontSize: 10 },
  queueCard: { borderRadius: 12, padding: 14, gap: 10 },
  queueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  queueLabel: { fontSize: 13, fontWeight: '500' },
  queueValue: { fontSize: 15, fontWeight: '700' },
  jobRow: { borderRadius: 10, padding: 12, marginBottom: 8, gap: 4 },
  jobHeader: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modeText: { fontSize: 10, fontWeight: '600' },
  jobId: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  jobMeta: { fontSize: 12 },
  jobError: { fontSize: 11 },
  jobTime: { fontSize: 10 },
  competitorRow: { borderRadius: 10, padding: 12, marginBottom: 8, gap: 4 },
  competitorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  competitorName: { fontSize: 14, fontWeight: '700' },
  competitorMeta: { fontSize: 12 },
  competitorLink: { fontSize: 11 },
  freshnessRow: { borderRadius: 10, padding: 12, marginBottom: 8, gap: 4 },
  freshnessHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freshnessAge: { fontSize: 13, fontWeight: '700' },
  freshnessId: { fontSize: 11 },
});
