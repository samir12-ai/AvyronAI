import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import { GlobalHeader } from '@/components/GlobalHeader';
import { useAppShellController } from '@/hooks/useAppShellController';
import { useCampaign } from '@/context/CampaignContext';
import { useAudiencePositioning } from '@/hooks/useAudiencePositioning';
import AudienceIntelligenceView from '@/components/audience-positioning/AudienceIntelligenceView';
import PositioningIntelligenceView from '@/components/audience-positioning/PositioningIntelligenceView';

export default function AudiencePositioningScreen() {
  const [activeSection, setActiveSection] = useState<'audience' | 'positioning'>('audience');
  const shellController = useAppShellController();
  const { selectedCampaign, selectedCampaignId } = useCampaign();

  const campaignId = selectedCampaign?.selectedCampaignId || selectedCampaignId || shellController.activeWorkspace?.id || 'campaign_1773576062201_6t0oxi';
  const { data, isLoading, error, refetch } = useAudiencePositioning(campaignId);

  return (
    <View style={styles.root}>
      <GlobalHeader title="AUDIENCE & POSITIONING" />

      {/* ── SUB-HEADER & SEGMENTED SWITCHER ── */}
      <View style={styles.subHeader}>
        <View style={styles.subHeaderLeft}>
          <View style={styles.switcherContainer}>
            <Pressable
              style={[styles.switcherBtn, activeSection === 'audience' && styles.switcherBtnActive]}
              onPress={() => setActiveSection('audience')}
            >
              <Feather
                name="users"
                size={14}
                color={activeSection === 'audience' ? '#FFFFFF' : '#9CA3AF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.switcherText, activeSection === 'audience' && styles.switcherTextActive]}>
                Audience Intelligence
              </Text>
            </Pressable>

            <Pressable
              style={[styles.switcherBtn, activeSection === 'positioning' && styles.switcherBtnActive]}
              onPress={() => setActiveSection('positioning')}
            >
              <Feather
                name="compass"
                size={14}
                color={activeSection === 'positioning' ? '#FFFFFF' : '#9CA3AF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.switcherText, activeSection === 'positioning' && styles.switcherTextActive]}>
                Positioning Intelligence
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.subHeaderRight}>
          <Pressable
            style={styles.refreshBtn}
            onPress={() => refetch()}
          >
            <Feather name="rotate-cw" size={13} color="#9CA3AF" style={{ marginRight: 5 }} />
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {/* ── MAIN CONTENT BODY ── */}
      <View style={styles.body}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingTitle}>Loading Strategic Intelligence</Text>
            <Text style={styles.loadingSubtitle}>Assembling verified buyer pains and positioning journey...</Text>
          </View>
        ) : error || !data ? (
          <View style={styles.emptyContainer}>
            <Feather name="alert-circle" size={32} color="#EF4444" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Could Not Load Intelligence</Text>
            <Text style={styles.emptySubtitle}>
              {error?.message || 'No active strategic data found for this campaign.'}
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : activeSection === 'audience' ? (
          <AudienceIntelligenceView data={data} />
        ) : (
          <PositioningIntelligenceView data={data} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: ShellTheme.colors.appBackground,
  },
  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2535',
    backgroundColor: '#11161F',
    flexWrap: 'wrap',
    gap: 12,
  },
  subHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switcherContainer: {
    flexDirection: 'row',
    backgroundColor: '#161B22',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  switcherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  switcherBtnActive: {
    backgroundColor: '#8B5CF6',
  },
  switcherText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  switcherTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  subHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  refreshText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  body: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 6,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 400,
  },
  retryBtn: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
