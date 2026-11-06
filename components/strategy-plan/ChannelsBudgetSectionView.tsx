import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl, authFetch, safeApiJson } from '@/lib/query-client';

interface Props {
  planData: any;
  intelligenceData?: AudiencePositioningViewModel | null;
}

export default function ChannelsBudgetSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  const { selectedCampaignId } = useCampaign();

  const sections = planData?.sections || {};
  const dist = sections.contentDistribution || {};
  const rawBudget = sections.budgetAllocation;
  const budget = Array.isArray(rawBudget) ? { allocations: rawBudget } : (rawBudget || {});
  const obj = sections.monthlyObjective || {};
  const kpi = sections.kpiStructure || {};
  const businessRep = sections.businessRepresentation;

  const [recommendation, setRecommendation] = useState<any>(
    sections.budgetGovernor || sections.budgetRecommendation || null
  );

  useEffect(() => {
    if (sections.budgetGovernor || (Array.isArray(rawBudget) && rawBudget.length > 0) || budget?.authorityHierarchy || Array.isArray(budget?.channels)) {
      setRecommendation(sections.budgetGovernor || sections.budgetRecommendation || budget || null);
      return;
    }
    if (!selectedCampaignId) return;
    let isMounted = true;
    (async () => {
      try {
        const url = new URL('/api/strategy/budget-governor/latest', getApiUrl());
        url.searchParams.set('campaignId', selectedCampaignId);
        const res = await authFetch(url.toString());
        const json = await safeApiJson(res);
        if (isMounted && json.success && json.snapshot?.result) {
          const r = typeof json.snapshot.result === 'string'
            ? JSON.parse(json.snapshot.result)
            : json.snapshot.result;
          setRecommendation(r);
        }
      } catch (e) {
        // Fall back gracefully
      }
    })();
    return () => { isMounted = false; };
  }, [selectedCampaignId, sections.budgetGovernor, sections.budgetRecommendation, rawBudget, budget]);

  // Approved Strategic Channels
  const channelsList = Array.isArray(dist.channels) && dist.channels.length > 0
    ? dist.channels
    : (Array.isArray(rawBudget) && rawBudget.length > 0
        ? rawBudget.map((b: any, idx: number) => ({
            channel: b.channelName || b.channel || b.platform || `Channel ${idx + 1}`,
            role: b.rationale || (idx === 0 ? 'Primary validation & awareness engine' : 'Secondary nurture & conversion channel'),
            tier: idx === 0 ? 'PRIMARY' : 'SECONDARY',
          }))
        : (Array.isArray(planData?.approvedChannels) && planData.approvedChannels.length > 0
            ? planData.approvedChannels.map((c: string, idx: number) => ({ channel: c, role: idx === 0 ? 'Primary validation & awareness engine' : 'Secondary nurture & conversion channel', tier: idx === 0 ? 'PRIMARY' : 'SECONDARY' }))
            : []));

  const currency = budget?.currency || recommendation?.currency || 'USD';
  const rawAllocArray: any[] =
    (Array.isArray(budget.channels) && budget.channels.length > 0 ? budget.channels : null) ||
    (Array.isArray(rawBudget) && rawBudget.length > 0 ? rawBudget : null) ||
    (Array.isArray(recommendation?.channelAllocations) && recommendation.channelAllocations.length > 0 ? recommendation.channelAllocations : null) ||
    (Array.isArray(recommendation?.allocations) && recommendation.allocations.length > 0 ? recommendation.allocations : null) ||
    (Array.isArray(budget.allocations) && budget.allocations.length > 0 ? budget.allocations : null) ||
    (Array.isArray(budget.breakdown) && budget.breakdown.length > 0 ? budget.breakdown : []);

  const allocations: Array<{
    channel: string;
    platform?: string;
    mode?: string;
    costCategory?: string;
    sharePercentage: number;
    allocatedAmount: number;
    rationale: string;
    readinessStatus?: string;
    prerequisiteSummary?: string | null;
  }> = rawAllocArray.length > 0
    ? rawAllocArray.map((b: any) => {
        const ch = b.channelName || b.channel || b.category || b.platform || 'Channel';
        const pct = Number(b.percentage ?? b.sharePercentage ?? b.allocationPercentage ?? 0);
        const amt = Number(b.monthlyAmount ?? b.monthlyBudget ?? b.allocatedAmount ?? b.amount ?? 0);
        const mode = String(b.mode || (b.isOrganic === true || ch.toLowerCase().includes('organic') ? 'ORGANIC' : b.isOrganic === false || ch.toLowerCase().includes('paid') ? 'PAID' : '')).toUpperCase();
        return {
          channel: ch,
          platform: b.platform || ch.replace(/\s+(organic|paid)$/i, ''),
          mode: mode || undefined,
          costCategory: b.costCategory || (mode === 'ORGANIC' ? 'Organic Sweat Equity ($0 Paid Media Spend)' : mode === 'PAID' ? 'Conditional Full-Budget Paid Media Allocation' : undefined),
          sharePercentage: pct,
          allocatedAmount: amt,
          rationale: b.why || b.rationale || b.purpose || b.proposedUse || 'Strategic channel allocation',
          readinessStatus: b.readinessStatus,
          prerequisiteSummary: b.prerequisiteSummary,
        };
      })
    : channelsList.map((c: any, idx: number) => ({
        channel: c.channel || c.name || `Channel ${idx + 1}`,
        sharePercentage: idx === 0 ? 60 : 40,
        allocatedAmount: 0,
        rationale: c.role || 'Organic validation and initial audience testing',
      }));

  const computedTotalBudget =
    budget?.monthlyBudgetEnvelope?.amount ??
    budget?.totalMonthlyBudget ??
    recommendation?.totalMonthlyBudget ??
    budget.totalBudget ??
    (allocations.reduce((sum, a) => sum + (Number(a.allocatedAmount) || 0), 0) || null);

  const totalBudget = computedTotalBudget != null
    ? (typeof computedTotalBudget === 'number' ? `${currency} ${computedTotalBudget.toLocaleString()}` : String(computedTotalBudget))
    : 'Not specified';

  const statusLabel =
    budget?.holdPolicy?.spendAction
      ? `SPEND ACTION: ${String(budget.holdPolicy.spendAction).toUpperCase()} (${String(budget.holdPolicy.spendPace || 'cautious').toUpperCase()})`
      : (recommendation?.governanceMode || recommendation?.status || 'STAGE_GATED');
  const budgetRationale = dist.rationale || businessRep?.contentDistribution?.rationale || 'Strategic focus concentrated on approved channels to drive qualified pipeline growth.';
  const authorityHierarchy = budget?.authorityHierarchy || null;
  const holdPolicy = budget?.holdPolicy || null;
  const channelPrerequisites: any[] = Array.isArray(budget?.channelPrerequisites) ? budget.channelPrerequisites : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. DISTRIBUTION & CHANNELS HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="share-2" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>CHANNELS & STRATEGIC ALLOCATION</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Strategic Distribution Strategy</Text>
        <Text style={styles.heroDescription}>"{budgetRationale}"</Text>

        {/* Approved Strategic Channels Grid */}
        <View style={styles.channelGrid}>
          {channelsList.map((chan: any, idx: number) => {
            const tierRaw = String(chan.tier || (idx === 0 ? 'PRIMARY' : 'SECONDARY')).toUpperCase();
            const isPrimary = tierRaw === 'PRIMARY';
            const isSupporting = tierRaw === 'SUPPORTING';
            const channelName = chan.channel || chan.name || 'Approved Channel';
            const channelRole = chan.role || (isPrimary ? 'Primary awareness & proof engine' : isSupporting ? 'Supporting middle-of-funnel nurture' : 'Secondary nurture channel');
            const iconName = channelName.toLowerCase().includes('youtube') ? 'video' : (channelName.toLowerCase().includes('email') ? 'mail' : 'share-2');
            const accentColor = isPrimary ? '#A78BFA' : isSupporting ? '#34D399' : '#60A5FA';

            return (
              <View key={idx} style={[styles.channelCard, isPrimary && styles.channelCardPrimary]}>
                <View style={styles.channelCardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name={iconName as any} size={16} color={accentColor} />
                    <Text style={styles.channelName}>{channelName}</Text>
                  </View>
                  <View style={[styles.channelTierBadge, isPrimary ? styles.channelTierPrimary : styles.channelTierSecondary]}>
                    <Text style={[styles.channelTierText, { color: accentColor }]}>{tierRaw}</Text>
                  </View>
                </View>
                <Text style={styles.channelRoleText}>{channelRole}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── 2. BUDGET ALLOCATION & CHANNEL DISTRIBUTION ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="dollar-sign" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>BUDGET AUTHORITY & 6-FIGURE RECONCILIATION</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Budget Governor owns the final conditional channel allocation and spend governance; Channel Selection provides preliminary channel recommendations and interlock prerequisites.
        </Text>

        <View style={styles.budgetSummaryRow}>
          <View>
            <Text style={styles.budgetSummaryLabel}>MONTHLY BUDGET ENVELOPE (USER-CONFIRMED)</Text>
            <Text style={styles.budgetSummaryValue}>{totalBudget}</Text>
          </View>
          {statusLabel && (
            <View style={styles.budgetStatusPill}>
              <Text style={styles.budgetStatusText}>{statusLabel}</Text>
            </View>
          )}
        </View>

        {/* 6 Distinct Budget Figures Grid */}
        {budget?.monthlyBudgetEnvelope && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, marginBottom: 8 }}>
            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(15, 23, 42, 0.75)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#334155' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5 }}>1. MONTHLY BUDGET ENVELOPE</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#F8FAFC', marginTop: 4 }}>
                {currency} {Number(budget.monthlyBudgetEnvelope.amount || 0).toLocaleString()}
              </Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{budget.monthlyBudgetEnvelope.summary}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(15, 23, 42, 0.75)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#334155' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.5 }}>2. FINAL PLANNED CHANNEL ALLOCATION</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#C4B5FD', marginTop: 4 }}>
                {currency} {Number(budget.finalPlannedChannelAllocation?.totalConditionalAllocation || 0).toLocaleString()} ({budget.finalPlannedChannelAllocation?.allocationBasis === 'ORGANIC_RESOURCE_WEIGHTING_EQUIVALENT' ? 'Organic Weighting' : 'Conditional Full-Budget'})
              </Text>
              <Text style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>{budget.finalPlannedChannelAllocation?.summary}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#34D399', letterSpacing: 0.5 }}>3. INITIAL TESTING ALLOWANCE (INSIDE ENVELOPE)</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#6EE7B7', marginTop: 4 }}>
                {currency} {Number(budget.initialTestingAllowance?.amount || 0).toLocaleString()} ({budget.initialTestingAllowance?.percentageOfEnvelope ?? 20}%)
              </Text>
              <Text style={{ fontSize: 11, color: '#D1FAE5', marginTop: 2 }}>{budget.initialTestingAllowance?.summary}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(245, 158, 11, 0.08)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#FBBF24', letterSpacing: 0.5 }}>4. UNRELEASED RESERVE (HELD UNDER HOLD)</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#FDE68A', marginTop: 4 }}>
                {currency} {Number(budget.unreleasedReserve?.amount || 0).toLocaleString()} ({budget.unreleasedReserve?.percentageOfEnvelope ?? 80}%)
              </Text>
              <Text style={{ fontSize: 11, color: '#FEF3C7', marginTop: 2 }}>{budget.unreleasedReserve?.summary}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(15, 23, 42, 0.75)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#334155' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#38BDF8', letterSpacing: 0.5 }}>5. ACTUAL SPEND TELEMETRY</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#7DD3FC', marginTop: 4 }}>
                {budget.actualSpend?.amount != null ? `${currency} ${Number(budget.actualSpend.amount).toLocaleString()}` : 'UNKNOWN (Unconnected)'}
              </Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{budget.actualSpend?.summary}</Text>
            </View>

            <View style={{ flex: 1, minWidth: 200, backgroundColor: 'rgba(15, 23, 42, 0.75)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#334155' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#60A5FA', letterSpacing: 0.5 }}>6. MONETARY PRODUCTION VS. ORGANIC EFFORT</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#93C5FD', marginTop: 4 }}>
                {currency} {Number(budget.productionAndOrganicEffort?.monetaryProductionCosts || 0).toLocaleString()} Monetary Production
              </Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{budget.productionAndOrganicEffort?.summary}</Text>
            </View>
          </View>
        )}

        {/* Preliminary (Channel Selection) vs Final (Budget Governor) Authority Card */}
        {authorityHierarchy && (
          <View style={[styles.budgetRationaleBox, { marginTop: 10, borderColor: 'rgba(139, 92, 246, 0.35)', backgroundColor: 'rgba(139, 92, 246, 0.08)' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#C4B5FD', marginBottom: 6, letterSpacing: 0.5 }}>
              AUTHORITY HIERARCHY: CHANNEL SELECTION (PRELIMINARY) → BUDGET GOVERNOR (FINAL AUTHORITY · {authorityHierarchy.status})
            </Text>
            <Text style={[styles.budgetRationaleText, { fontStyle: 'normal', marginBottom: 6 }]}>
              {authorityHierarchy.refinementExplanation}
            </Text>
            {Array.isArray(authorityHierarchy.preliminaryChannelRecommendation) && authorityHierarchy.preliminaryChannelRecommendation.length > 0 && (
              <Text style={[styles.budgetRationaleText, { fontStyle: 'normal', fontSize: 11, color: '#94A3B8' }]}>
                <Text style={{ fontWeight: '700', color: '#CBD5E1' }}>Preliminary Recommendation (Channel Selection): </Text>
                {authorityHierarchy.preliminaryChannelRecommendation.map((p: any) => `${p.channelName}: ${p.sharePercentage}% (${currency} ${Number(p.monthlyAmount || 0).toLocaleString()})`).join(' · ')}
              </Text>
            )}
          </View>
        )}

        {/* Hold Policy Governance Card */}
        {holdPolicy && (
          <View style={[styles.budgetRationaleBox, { marginTop: 10, borderColor: 'rgba(245, 158, 11, 0.3)', backgroundColor: 'rgba(245, 158, 11, 0.06)' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#FBBF24', marginBottom: 6, letterSpacing: 0.5 }}>
              HOLD POLICY GOVERNANCE (SPEND ACTION = {String(holdPolicy.spendAction || 'HOLD').toUpperCase()})
            </Text>
            {Array.isArray(holdPolicy.whatHoldPrevents) && holdPolicy.whatHoldPrevents.length > 0 && (
              <View style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#FCA5A5', marginBottom: 2 }}>What Hold Prevents:</Text>
                {holdPolicy.whatHoldPrevents.map((item: string, i: number) => (
                  <Text key={i} style={{ fontSize: 11, color: '#E2E8F0', lineHeight: 16 }}>• {item}</Text>
                ))}
              </View>
            )}
            {Array.isArray(holdPolicy.whatHoldPermits) && holdPolicy.whatHoldPermits.length > 0 && (
              <View style={{ marginBottom: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#6EE7B7', marginBottom: 2 }}>What Hold Permits:</Text>
                {holdPolicy.whatHoldPermits.map((item: string, i: number) => (
                  <Text key={i} style={{ fontSize: 11, color: '#E2E8F0', lineHeight: 16 }}>• {item}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Channel Readiness & Retargeting Prerequisites */}
        {channelPrerequisites.some((cp: any) => cp.readinessStatus === 'PREREQUISITE_GATED') && (
          <View style={[styles.budgetRationaleBox, { marginTop: 10, borderColor: 'rgba(56, 189, 248, 0.35)', backgroundColor: 'rgba(56, 189, 248, 0.08)' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#38BDF8', marginBottom: 6, letterSpacing: 0.5 }}>
              RETARGETING & CHANNEL PREREQUISITE GATES
            </Text>
            {channelPrerequisites.map((cp: any, idx: number) => (
              <View key={idx} style={{ marginBottom: idx < channelPrerequisites.length - 1 ? 6 : 0 }}>
                <Text style={{ fontSize: 11, color: '#F8FAFC', lineHeight: 16 }}>
                  <Text style={{ fontWeight: '700', color: cp.readinessStatus === 'PREREQUISITE_GATED' ? '#FBBF24' : '#34D399' }}>
                    [{cp.readinessStatus}] {cp.channelName}:{' '}
                  </Text>
                  {cp.prerequisiteSummary}
                </Text>
              </View>
            ))}
          </View>
        )}

        {recommendation?.overallRationale ? (
          <View style={styles.budgetRationaleBox}>
            <Text style={styles.budgetRationaleText}>"{recommendation.overallRationale}"</Text>
          </View>
        ) : null}

        {budget?.testingAndScalingGuidance ? (
          <View style={[styles.budgetRationaleBox, { marginTop: 10, borderColor: 'rgba(52, 211, 153, 0.25)', backgroundColor: 'rgba(16, 185, 129, 0.06)' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#34D399', marginBottom: 6, letterSpacing: 0.5 }}>
              INITIAL VALIDATION TESTING VS. PAID SCALING GOVERNANCE
            </Text>
            {budget.testingAndScalingGuidance.initialTestingPlan ? (
              <Text style={[styles.budgetRationaleText, { fontStyle: 'normal', marginBottom: 6 }]}>
                <Text style={{ fontWeight: '700', color: '#F3F4F6' }}>Initial Testing Plan: </Text>
                {budget.testingAndScalingGuidance.initialTestingPlan}
              </Text>
            ) : null}
            {budget.testingAndScalingGuidance.scalingHoldCondition ? (
              <Text style={[styles.budgetRationaleText, { fontStyle: 'normal', marginBottom: 6 }]}>
                <Text style={{ fontWeight: '700', color: '#FBBF24' }}>Scaling Condition: </Text>
                {budget.testingAndScalingGuidance.scalingHoldCondition}
              </Text>
            ) : null}
            {budget.testingAndScalingGuidance.paidMediaAllocationSummary ? (
              <Text style={[styles.budgetRationaleText, { fontStyle: 'normal', marginBottom: 4 }]}>
                <Text style={{ fontWeight: '700', color: '#A78BFA' }}>Paid Media Allocation: </Text>
                {budget.testingAndScalingGuidance.paidMediaAllocationSummary}
              </Text>
            ) : null}
            {budget.testingAndScalingGuidance.organicProductionAllocationSummary ? (
              <Text style={[styles.budgetRationaleText, { fontStyle: 'normal' }]}>
                <Text style={{ fontWeight: '700', color: '#60A5FA' }}>Organic & Production Effort: </Text>
                {budget.testingAndScalingGuidance.organicProductionAllocationSummary}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Allocations Table */}
        <View style={styles.tableCard}>
          {/* Table Header */}
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { flex: 2.2 }]}>PLATFORM & MODE</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'center' }]}>SHARE</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: 'right' }]}>MONTHLY</Text>
            <Text style={[styles.tableHeaderCell, { flex: 3, paddingLeft: 8 }]}>WHY</Text>
          </View>

          {/* Table Rows */}
          {allocations.map((alloc, idx) => (
            <View
              key={idx}
              style={[
                styles.tableDataRow,
                idx === allocations.length - 1 && { borderBottomWidth: 0 },
                idx % 2 === 1 && styles.tableDataRowAlt,
              ]}
            >
              <View style={{ flex: 2.2 }}>
                <Text style={[styles.tableCellText, { fontWeight: '700', color: '#F3F4F6' }]}>
                  {alloc.channel}
                </Text>
                {(alloc.mode || alloc.costCategory) ? (
                  <Text style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                    {[alloc.mode, alloc.costCategory].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {alloc.readinessStatus ? (
                  <Text style={{ fontSize: 10, fontWeight: '700', color: alloc.readinessStatus === 'PREREQUISITE_GATED' ? '#FBBF24' : '#34D399', marginTop: 2 }}>
                    [{alloc.readinessStatus}]
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.tableCellText, { flex: 1, textAlign: 'center', color: '#A78BFA', fontWeight: '600' }]}>
                {typeof alloc.sharePercentage === 'number' ? `${alloc.sharePercentage.toFixed(1)}%` : `${alloc.sharePercentage}%`}
              </Text>
              <Text style={[styles.tableCellText, { flex: 1.5, textAlign: 'right', fontWeight: '600', color: '#34D399' }]}>
                {alloc.allocatedAmount ? `${currency} ${alloc.allocatedAmount.toLocaleString()}` : `${currency} 0`}
              </Text>
              <Text style={[styles.tableCellText, { flex: 3, paddingLeft: 8, fontSize: 11, color: '#9CA3AF', lineHeight: 15 }]}>
                {alloc.rationale}
              </Text>
            </View>
          ))}
        </View>

        {/* Mandatory Disclaimer */}
        <View style={styles.disclaimerBox}>
          <Feather name="info" size={14} color="#60A5FA" style={{ marginRight: 6, marginTop: 1 }} />
          <Text style={styles.disclaimerText}>
            Recommended allocation only — no money is spent automatically.
          </Text>
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
            <Text style={styles.drawerTitle}>View Channel & Budget Lineage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>CHANNEL SELECTION TIER</Text>
              <Text style={styles.evidenceValue}>
                Channel Selection Tier (#13) · Selects approved high-fit platforms based on audience and positioning.
              </Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>BUDGET RECOMMENDER TIER</Text>
              <Text style={styles.evidenceValue}>
                Budget Recommender Tier (#14) · Distributes monthly budget across selected channels with platform-specific rationales.
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
  budgetSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#161E2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 12,
  },
  budgetSummaryLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  budgetSummaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  budgetStatusPill: {
    backgroundColor: '#10B98120',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10B98140',
  },
  budgetStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.5,
  },
  budgetRationaleBox: {
    backgroundColor: '#161E2E80',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 12,
  },
  budgetRationaleText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  tableCard: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
    overflow: 'hidden',
    marginBottom: 12,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  tableHeaderCell: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F293780',
  },
  tableDataRowAlt: {
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  tableCellText: {
    fontSize: 12,
  },
  disclaimerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0C1B2E',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#7DD3FC',
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
