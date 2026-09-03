import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import type { MarketOverviewViewModel } from '@/types/market-intelligence';

interface Props {
  overview: MarketOverviewViewModel;
  onSelectCompetitor: (competitorId: string) => void;
}

export default function MarketOverviewView({ overview, onSelectCompetitor }: Props) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. MARKET OVERVIEW HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="globe" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>MARKET INTELLIGENCE</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{overview.freshness.label}</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{overview.headline}</Text>
        <Text style={styles.heroSummary}>{overview.marketSummary}</Text>

        <View style={styles.heroFooter}>
          <View style={styles.footerItem}>
            <Feather name="shield" size={14} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Market State:</Text>
            <Text style={styles.footerValue}>{overview.marketState.replace(/_/g, ' ')}</Text>
          </View>
          <View style={styles.footerDivider} />
          <View style={styles.footerItem}>
            <Feather name="users" size={14} color="#8B5CF6" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Competitors Analyzed:</Text>
            <Text style={styles.footerValue}>{overview.totalCompetitorsAnalyzed} Monitored</Text>
          </View>
          <View style={styles.footerDivider} />
          <View style={styles.footerItem}>
            <Feather name="check-circle" size={14} color="#3B82F6" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Confidence:</Text>
            <Text style={styles.footerValue}>{overview.confidence.level} ({Math.round(overview.confidence.score * 100)}%)</Text>
          </View>
        </View>
      </View>

      {/* ── 2. KEY MARKET PATTERNS ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="trending-up" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>KEY MARKET PATTERNS ACROSS COMPETITORS</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Synthesized behavioral and positioning patterns observed across active competitor websites and content streams.
        </Text>

        <View style={styles.patternsList}>
          {overview.keyPatterns.map((pat) => (
            <View key={pat.id} style={styles.patternCard}>
              <View style={styles.patternHeader}>
                <Text style={styles.patternName}>{pat.patternName}</Text>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryBadgeText}>{pat.category.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.patternBlock}>
                <Text style={styles.patternBlockLabel}>WHAT WE ARE SEEING</Text>
                <Text style={styles.patternBlockText}>{pat.whatWeAreSeeing}</Text>
              </View>

              <View style={styles.whoBlock}>
                <Text style={styles.patternBlockLabel}>SEEN ACROSS COMPETITORS</Text>
                <View style={styles.competitorsRow}>
                  {pat.whoIsDoingIt.map((c) => (
                    <Pressable
                      key={c.competitorId}
                      style={styles.compPill}
                      onPress={() => onSelectCompetitor(c.competitorId)}
                    >
                      <Text style={styles.compPillText}>{c.competitorName}</Text>
                      <Feather name="arrow-up-right" size={11} color="#A78BFA" style={{ marginLeft: 4 }} />
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.patternBlock}>
                <Text style={[styles.patternBlockLabel, { color: '#10B981' }]}>WHY IT MATTERS FOR YOUR STRATEGY</Text>
                <Text style={styles.patternBlockText}>{pat.whyItMatters}</Text>
              </View>

              <View style={styles.evidenceFoot}>
                <Feather name="file-text" size={12} color="#6B7280" style={{ marginRight: 6 }} />
                <Text style={styles.evidenceFootText}>{pat.evidenceSummary}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 3. STRATEGIC OPENINGS & WHAT TO WATCH ── */}
      <View style={styles.openingsGrid}>
        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="compass" size={15} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#10B981' }]}>POSSIBLE STRATEGIC OPENINGS</Text>
          </View>
          {overview.opportunities.map((opp, idx) => (
            <View key={idx} style={styles.openingItem}>
              <Feather name="check" size={13} color="#10B981" style={{ marginTop: 3, marginRight: 8 }} />
              <Text style={styles.openingText}>{opp}</Text>
            </View>
          ))}
        </View>

        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="alert-triangle" size={15} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#F59E0B' }]}>WHAT TO WATCH IN THIS MARKET</Text>
          </View>
          {overview.threats.map((thr, idx) => (
            <View key={idx} style={styles.openingItem}>
              <Feather name="eye" size={13} color="#F59E0B" style={{ marginTop: 3, marginRight: 8 }} />
              <Text style={styles.openingText}>{thr}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ShellTheme.colors.appBackground,
  },
  contentContainer: {
    padding: 24,
    maxWidth: 1040,
    alignSelf: 'center',
    width: '100%',
  },
  heroCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF620',
    borderColor: '#8B5CF640',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePrimaryText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  statusText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    lineHeight: 32,
  },
  heroSummary: {
    fontSize: 15,
    color: '#D1D5DB',
    lineHeight: 22,
    marginBottom: 18,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    gap: 12,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    marginRight: 4,
  },
  footerValue: {
    fontSize: 13,
    color: '#E5E7EB',
    fontWeight: '600',
  },
  footerDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#374151',
  },
  sectionCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 20,
  },
  patternsList: {
    gap: 16,
  },
  patternCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  patternHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  patternName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 10,
  },
  categoryBadge: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  categoryBadgeText: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
  },
  patternBlock: {
    marginBottom: 12,
  },
  patternBlockLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  patternBlockText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 19,
  },
  whoBlock: {
    marginBottom: 12,
  },
  competitorsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  compPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  compPillText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  evidenceFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    marginTop: 4,
  },
  evidenceFootText: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  openingsGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  openingCol: {
    flex: 1,
    minWidth: 300,
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 20,
  },
  openingColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  openingColTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  openingItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  openingText: {
    fontSize: 13,
    color: '#D1D5DB',
    flex: 1,
    lineHeight: 18,
  },
});
