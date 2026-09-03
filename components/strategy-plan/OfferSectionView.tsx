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

export default function OfferSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const sections = planData?.sections || {};
  const rawOffer = sections.offer || sections.selectedOffer || sections.primaryOffer || planData?.offer;

  if (!rawOffer) {
    return (
      <View style={styles.emptyContainer}>
        <Feather name="gift" size={32} color="#8B5CF6" style={{ marginBottom: 12 }} />
        <Text style={styles.emptyTitle}>NO APPROVED OFFER IN PLAN</Text>
        <Text style={styles.emptySubtitle}>
          No active canonical offer snapshot found in the current strategy plan.
        </Text>
      </View>
    );
  }

  // Canonical Offer Field Mapping (Zero cross-engine fallback)
  const offerTitle = rawOffer.offerName || rawOffer.title || rawOffer.name || 'Approved Core Offer';
  const offerOutcome = rawOffer.outcomeLayer?.primaryOutcome || rawOffer.outcome || rawOffer.primaryPromise || rawOffer.coreOutcome || '';

  const whoItIsFor = rawOffer.identityReasoning?.identityPayoff ||
    (rawOffer.valueArchitecture?.identityShift
      ? `From: ${rawOffer.valueArchitecture.identityShift.fromIdentity} → To: ${rawOffer.valueArchitecture.identityShift.toIdentity}`
      : '') ||
    rawOffer.audienceFitExplanation ||
    '';

  const problemAddressed = rawOffer.problemStatement ||
    rawOffer.outcomeLayer?.transformationStatement ||
    '';

  const deliverables: string[] = React.useMemo(() => {
    if (Array.isArray(rawOffer.deliveryLayer?.deliverables) && rawOffer.deliveryLayer.deliverables.length > 0) {
      return rawOffer.deliveryLayer.deliverables.map((d: any) => typeof d === 'string' ? d : d.title || d.name || JSON.stringify(d));
    }
    if (Array.isArray(rawOffer.deliverables) && rawOffer.deliverables.length > 0) {
      return rawOffer.deliverables.map((d: any) => typeof d === 'string' ? d : d.title || d.name || JSON.stringify(d));
    }
    return [];
  }, [rawOffer]);

  const commercialValue = rawOffer.valueArchitecture?.primaryValueWedge ||
    rawOffer.identityReasoning?.commercialReasoning ||
    rawOffer.identityReasoning?.valueTranslation ||
    '';

  const proofRequirements: string[] = React.useMemo(() => {
    if (Array.isArray(rawOffer.proofLayer?.proofGrounding) && rawOffer.proofLayer.proofGrounding.length > 0) {
      return rawOffer.proofLayer.proofGrounding.map((p: any) => typeof p === 'string' ? p : p.groundingText || p.proofType || JSON.stringify(p));
    }
    if (Array.isArray(rawOffer.proofLayer?.alignedProofTypes) && rawOffer.proofLayer.alignedProofTypes.length > 0) {
      return rawOffer.proofLayer.alignedProofTypes.map((t: any) => typeof t === 'string' ? `Verified ${t.replace(/_/g, ' ')}` : String(t));
    }
    if (Array.isArray(rawOffer.proofPath) && rawOffer.proofPath.length > 0) {
      return rawOffer.proofPath.map((p: any) => typeof p === 'string' ? p : JSON.stringify(p));
    }
    if (Array.isArray(rawOffer.proofRequirements) && rawOffer.proofRequirements.length > 0) {
      return rawOffer.proofRequirements.map((p: any) => typeof p === 'string' ? p : p.proof || p.name || JSON.stringify(p));
    }
    return [];
  }, [rawOffer]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. APPROVED CORE OFFER HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="gift" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>APPROVED CORE OFFER</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Validated Structure</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{offerTitle}</Text>
        {offerOutcome ? (
          <Text style={styles.heroDescription}>"{offerOutcome}"</Text>
        ) : null}

        <View style={styles.metaRow}>
          {whoItIsFor ? (
            <View style={styles.metaCol}>
              <View style={styles.metaHeader}>
                <Feather name="users" size={12} color="#60A5FA" style={{ marginRight: 5 }} />
                <Text style={[styles.metaLabel, { color: '#60A5FA' }]}>WHO IT IS FOR</Text>
              </View>
              <Text style={styles.metaValue}>{whoItIsFor}</Text>
            </View>
          ) : null}

          {problemAddressed ? (
            <View style={styles.metaCol}>
              <View style={styles.metaHeader}>
                <Feather name="alert-circle" size={12} color="#F59E0B" style={{ marginRight: 5 }} />
                <Text style={[styles.metaLabel, { color: '#F59E0B' }]}>PROBLEM ADDRESSED</Text>
              </View>
              <Text style={styles.metaValue}>{problemAddressed}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── 2. WHAT THE BUYER RECEIVES (DELIVERABLES) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="check-square" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>DELIVERABLES & PACKAGING</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Concrete deliverables structured into the primary commercial offering.
        </Text>

        {deliverables.length > 0 ? (
          <View style={styles.deliverablesList}>
            {deliverables.map((item: string, idx: number) => (
              <View key={idx} style={styles.deliverableItem}>
                <View style={styles.checkWrap}>
                  <Feather name="check" size={13} color="#10B981" />
                </View>
                <Text style={styles.deliverableText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptySectionText}>No specific deliverables defined for this offer.</Text>
        )}
      </View>

      {/* ── 3. COMMERCIAL VALUE & VALUE WEDGE ── */}
      {commercialValue ? (
        <View style={styles.outcomeCard}>
          <View style={styles.outcomeHeader}>
            <Feather name="trending-up" size={14} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={styles.outcomeTitle}>COMMERCIAL VALUE & VALUE WEDGE</Text>
          </View>
          <Text style={styles.outcomeMain}>{commercialValue}</Text>
          <Text style={styles.outcomeDetail}>
            Offer-grounded commercial leverage and economic justification.
          </Text>
        </View>
      ) : null}

      {/* ── 4. PROOF REQUIREMENTS & EVIDENCE ALIGNMENT ── */}
      <View style={styles.proofCard}>
        <View style={styles.proofHeader}>
          <Feather name="shield" size={14} color="#FCD34D" style={{ marginRight: 6 }} />
          <Text style={styles.proofTitle}>PROOF REQUIREMENTS & EVIDENCE ALIGNMENT</Text>
        </View>
        <Text style={styles.proofSubtitle}>
          Required buyer-facing proof and evidence alignment:
        </Text>
        {proofRequirements.length > 0 ? (
          <View style={styles.proofList}>
            {proofRequirements.map((proof: string, idx: number) => (
              <View key={idx} style={styles.proofItem}>
                <Feather name="shield" size={12} color="#A78BFA" style={{ marginTop: 2, marginRight: 8 }} />
                <Text style={styles.proofText}>{proof}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyProofText}>No specific buyer proof constraints required for this offer structure.</Text>
        )}
      </View>

      {/* ── 5. EVIDENCE & LINEAGE DRAWER ── */}
      <View style={styles.drawerCard}>
        <Pressable
          style={styles.drawerToggle}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="database" size={14} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>View Offer Authority & Lineage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>OFFER ENGINE STATUS</Text>
              <Text style={styles.evidenceValue}>
                Engine priority tier OFFER (#6) approved and bound into active plan ID {planData?.id || 'active'}.
              </Text>
            </View>
            {rawOffer.valueArchitecture?.primaryValueWedge ? (
              <View style={styles.evidenceItem}>
                <Text style={styles.evidenceLabel}>PRIMARY VALUE WEDGE</Text>
                <Text style={styles.evidenceValue}>
                  {rawOffer.valueArchitecture.primaryValueWedge}
                </Text>
              </View>
            ) : null}
            {rawOffer.valueArchitecture?.identityShift?.identityCost ? (
              <View style={styles.evidenceItem}>
                <Text style={styles.evidenceLabel}>IDENTITY SHIFT COST</Text>
                <Text style={styles.evidenceValue}>
                  {rawOffer.valueArchitecture.identityShift.identityCost}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingBottom: 48 },
  emptyContainer: {
    backgroundColor: '#0B0F17',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
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
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaCol: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#161E2E',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  metaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '600',
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
  deliverablesList: {
    gap: 10,
  },
  deliverableItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#161E2E',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  checkWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#10B98120',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  deliverableText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 20,
    flex: 1,
  },
  emptySectionText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
  },
  outcomeCard: {
    backgroundColor: '#064E3B18',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#10B98130',
    marginBottom: 16,
  },
  outcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  outcomeTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  outcomeMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
    lineHeight: 20,
  },
  outcomeDetail: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
  proofCard: {
    backgroundColor: '#1E1B4B20',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#8B5CF630',
    marginBottom: 16,
  },
  proofHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  proofTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  proofSubtitle: {
    fontSize: 12,
    color: '#DDD6FE',
    lineHeight: 18,
    marginBottom: 12,
  },
  proofList: {
    gap: 8,
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  proofText: {
    fontSize: 12,
    color: '#E2E8F0',
    lineHeight: 18,
    flex: 1,
  },
  emptyProofText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
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
