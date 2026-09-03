import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

interface Props {
  planData: any;
  intelligenceData?: AudiencePositioningViewModel | null;
}

export default function ChannelsBudgetSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const sections = planData?.sections || {};
  const dist = sections.contentDistribution || {};
  const budget = sections.budgetAllocation || {};
  const obj = sections.monthlyObjective || {};
  const kpi = sections.kpiStructure || {};
  const businessRep = sections.businessRepresentation;

  // Approved Strategic Channels
  const channelsList = Array.isArray(dist.channels) && dist.channels.length > 0
    ? dist.channels
    : (Array.isArray(planData?.approvedChannels) && planData.approvedChannels.length > 0
        ? planData.approvedChannels.map((c: string, idx: number) => ({ channel: c, role: idx === 0 ? 'Primary validation & awareness engine' : 'Secondary nurture & conversion channel', tier: idx === 0 ? 'PRIMARY' : 'SECONDARY' }))
        : [
            { channel: 'YouTube Organic', role: 'Top-of-funnel awareness, proof demonstration, and market positioning', tier: 'PRIMARY' },
            { channel: 'Email Marketing', role: 'Middle-of-funnel consideration, lead nurturing, and relationship building', tier: 'SECONDARY' }
          ]);

  // Budget Tier
  const isHold = obj.type === 'hold' || (planData?.planSource && planData.planSource.includes('degraded'));
  const budgetTier = isHold ? 'Hold / Scaling Restricted' : (obj.type === 'scale' ? 'Scale' : 'Test / Baseline Building');
  const budgetRationale = dist.rationale || businessRep?.contentDistribution?.rationale || 'Strategic focus concentrated on approved channels to drive qualified pipeline growth while scaling budget is held.';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. DISTRIBUTION & CHANNELS HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="share-2" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>CHANNELS & STRATEGIC ALLOCATION</Text>
          </View>
          <View style={[styles.statusPill, isHold && styles.statusPillHold]}>
            <View style={[styles.statusDot, isHold && styles.statusDotHold]} />
            <Text style={[styles.statusText, isHold && styles.statusTextHold]}>
              {budgetTier}
            </Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Strategic Distribution Strategy</Text>
        <Text style={styles.heroDescription}>"{budgetRationale}"</Text>

        {/* Approved Strategic Channels Grid */}
        <View style={styles.channelGrid}>
          {channelsList.map((chan: any, idx: number) => {
            const isPrimary = chan.tier === 'PRIMARY' || idx === 0;
            const channelName = chan.channel || chan.name || 'Approved Channel';
            const channelRole = chan.role || (isPrimary ? 'Primary awareness & proof engine' : 'Secondary nurture channel');
            const iconName = channelName.toLowerCase().includes('youtube') ? 'video' : (channelName.toLowerCase().includes('email') ? 'mail' : 'share-2');
            const accentColor = isPrimary ? '#A78BFA' : '#60A5FA';

            return (
              <View key={idx} style={[styles.channelCard, isPrimary && styles.channelCardPrimary]}>
                <View style={styles.channelCardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name={iconName as any} size={16} color={accentColor} />
                    <Text style={styles.channelName}>{channelName}</Text>
                  </View>
                  <View style={[styles.channelTierBadge, isPrimary ? styles.channelTierPrimary : styles.channelTierSecondary]}>
                    <Text style={[styles.channelTierText, { color: accentColor }]}>{isPrimary ? 'PRIMARY' : 'SECONDARY'}</Text>
                  </View>
                </View>
                <Text style={styles.channelRoleText}>{channelRole}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── 2. BUDGET GOVERNANCE & ALLOCATION ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="dollar-sign" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>BUDGET GOVERNANCE & RESOURCE CONTROL</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Avyron's Budget Governor ensures financial resources are only allocated when statistical proof thresholds are satisfied.
        </Text>

        <View style={styles.governanceBox}>
          <View style={styles.govRow}>
            <Text style={styles.govLabel}>GOVERNANCE TIER</Text>
            <View style={styles.govBadge}>
              <Text style={styles.govBadgeText}>{budgetTier}</Text>
            </View>
          </View>

          <View style={styles.govRow}>
            <Text style={styles.govLabel}>MONTHLY OBJECTIVE</Text>
            <Text style={styles.govValue}>{obj.objective || 'Organic Validation & Buyer Pipeline Building'}</Text>
          </View>

          {kpi.primaryKPI && (
            <View style={styles.govRow}>
              <Text style={styles.govLabel}>PRIMARY VALIDATION KPI</Text>
              <Text style={styles.govValue}>
                {kpi.primaryKPI.name || 'Prospect Engagement'} ({kpi.primaryKPI.cadence || 'weekly'})
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── 3. WEEKLY PLAYBOOK RHYTHM ── */}
      {businessRep?.executionBlueprintDnaLink?.weeklyDnaApplication && (
        <View style={styles.rhythmCard}>
          <View style={styles.rhythmHeader}>
            <Feather name="activity" size={14} color="#34D399" style={{ marginRight: 6 }} />
            <Text style={styles.rhythmTitle}>WEEKLY OPERATIONAL RHYTHM</Text>
          </View>
          <Text style={styles.rhythmText}>
            {businessRep.executionBlueprintDnaLink.weeklyDnaApplication}
          </Text>
        </View>
      )}

      {/* ── 4. EVIDENCE & LINEAGE DRAWER ── */}
      <View style={styles.drawerCard}>
        <Pressable
          style={styles.drawerToggle}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="database" size={14} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>View Budget Governor & Channel Lineage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>FINANCIAL GOVERNOR TIER</Text>
              <Text style={styles.evidenceValue}>
                Budget Governor Tier (#12) · Linked to statistical validation and data reliability indices.
              </Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>ALLOCATION AUTHORITY</Text>
              <Text style={styles.evidenceValue}>
                Channel Selection Tier (#13) · Directs spend and organic publishing volume by lane priority.
              </Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingBottom: 48 },
  heroCard: {
    backgroundColor: '#0B0F17',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
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
    backgroundColor: '#8B5CF618',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF635',
  },
  badgePrimaryText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B98130',
  },
  statusPillHold: {
    backgroundColor: '#F59E0B15',
    borderColor: '#F59E0B30',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusDotHold: {
    backgroundColor: '#F59E0B',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
  },
  statusTextHold: {
    color: '#FCD34D',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  channelGrid: {
    flexDirection: 'column',
    gap: 10,
  },
  channelCard: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  channelCardPrimary: {
    borderColor: '#8B5CF640',
    backgroundColor: '#8B5CF608',
  },
  channelCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  channelName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  channelTierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  channelTierPrimary: {
    backgroundColor: '#8B5CF618',
    borderColor: '#8B5CF635',
  },
  channelTierSecondary: {
    backgroundColor: '#60A5FA18',
    borderColor: '#60A5FA35',
  },
  channelTierText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  channelRoleText: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: '#0F1419',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F1F5F9',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 16,
  },
  governanceBox: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    gap: 12,
  },
  govRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  govLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  govValue: {
    fontSize: 12,
    color: '#F1F5F9',
    fontWeight: '600',
    textAlign: 'right',
  },
  govBadge: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  govBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  rhythmCard: {
    backgroundColor: '#064E3B18',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#10B98130',
    marginBottom: 16,
  },
  rhythmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  rhythmTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  rhythmText: {
    fontSize: 13,
    color: '#D1FAE5',
    lineHeight: 20,
  },
  drawerCard: {
    backgroundColor: '#11161F',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
    overflow: 'hidden',
  },
  drawerToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  drawerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  drawerBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderColor: '#1E2535',
    gap: 10,
    paddingTop: 12,
  },
  evidenceItem: {
    backgroundColor: '#161B22',
    padding: 10,
    borderRadius: 8,
  },
  evidenceLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  evidenceValue: {
    fontSize: 11,
    color: '#E2E8F0',
    lineHeight: 16,
  },
});
