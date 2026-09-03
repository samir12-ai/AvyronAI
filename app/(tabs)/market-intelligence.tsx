import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import { GlobalHeader } from '@/components/GlobalHeader';
import { useAppShellController } from '@/hooks/useAppShellController';
import { useCampaign } from '@/context/CampaignContext';
import { useMarketIntelligence, useCompetitorDossier } from '@/hooks/useMarketIntelligence';
import MarketOverviewView from '@/components/market-intelligence/MarketOverviewView';
import CompetitorLibraryView from '@/components/market-intelligence/CompetitorLibraryView';
import CompetitorDossierView from '@/components/market-intelligence/CompetitorDossierView';

export default function MarketIntelligenceScreen() {
  const [activeTab, setActiveTab] = useState<'overview' | 'library' | 'dossier'>('overview');
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);

  const shellController = useAppShellController();
  const { selectedCampaign, selectedCampaignId } = useCampaign();

  const campaignId =
    selectedCampaign?.selectedCampaignId ||
    selectedCampaignId ||
    shellController.activeWorkspace?.id ||
    'campaign_1773576062201_6t0oxi';

  // 1. Fetch Market Overview & Competitor Directory
  const {
    data: miBundle,
    isLoading: isBundleLoading,
    error: bundleError,
    refetch: refetchBundle,
  } = useMarketIntelligence(campaignId, selectedCompetitorId);

  // Set default selected competitor if none selected
  useEffect(() => {
    if (!selectedCompetitorId && miBundle?.competitors && miBundle.competitors.length > 0) {
      // Prefer HubSpot or first competitor
      const defaultComp = miBundle.competitors.find(c => c.name.toLowerCase().includes('hubspot')) || miBundle.competitors[0];
      setSelectedCompetitorId(defaultComp.competitorId);
    }
  }, [miBundle, selectedCompetitorId]);

  // 2. Fetch Active Competitor Dossier
  const {
    data: dossierData,
    isLoading: isDossierLoading,
    error: dossierError,
    refetch: refetchDossier,
  } = useCompetitorDossier(campaignId, selectedCompetitorId);

  const handleSelectCompetitor = (compId: string) => {
    setSelectedCompetitorId(compId);
    setActiveTab('dossier');
  };

  const handleRefresh = () => {
    refetchBundle();
    if (selectedCompetitorId) refetchDossier();
  };

  const selectedCompSummary = miBundle?.competitors.find(c => c.competitorId === selectedCompetitorId);

  return (
    <View style={styles.root}>
      <GlobalHeader title="MARKET INTELLIGENCE" />

      {/* ── SUB-HEADER & SEGMENTED SWITCHER ── */}
      <View style={styles.subHeader}>
        <View style={styles.subHeaderLeft}>
          <View style={styles.switcherContainer}>
            <Pressable
              style={[styles.switcherBtn, activeTab === 'overview' && styles.switcherBtnActive]}
              onPress={() => setActiveTab('overview')}
            >
              <Feather
                name="globe"
                size={14}
                color={activeTab === 'overview' ? '#FFFFFF' : '#9CA3AF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.switcherText, activeTab === 'overview' && styles.switcherTextActive]}>
                Market Overview
              </Text>
            </Pressable>

            <Pressable
              style={[styles.switcherBtn, activeTab === 'library' && styles.switcherBtnActive]}
              onPress={() => setActiveTab('library')}
            >
              <Feather
                name="book-open"
                size={14}
                color={activeTab === 'library' ? '#FFFFFF' : '#9CA3AF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.switcherText, activeTab === 'library' && styles.switcherTextActive]}>
                Competitor Library ({miBundle?.competitors.length || 0})
              </Text>
            </Pressable>

            <Pressable
              style={[styles.switcherBtn, activeTab === 'dossier' && styles.switcherBtnActive]}
              onPress={() => setActiveTab('dossier')}
            >
              <Feather
                name="file-text"
                size={14}
                color={activeTab === 'dossier' ? '#FFFFFF' : '#9CA3AF'}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.switcherText, activeTab === 'dossier' && styles.switcherTextActive]}>
                {selectedCompSummary ? `${selectedCompSummary.name} Dossier` : 'Competitor Dossier'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.subHeaderRight}>
          <Pressable style={styles.refreshBtn} onPress={handleRefresh}>
            <Feather name="rotate-cw" size={13} color="#9CA3AF" style={{ marginRight: 5 }} />
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {/* ── MAIN CONTENT BODY ── */}
      <View style={styles.body}>
        {isBundleLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingTitle}>Loading Market Intelligence</Text>
            <Text style={styles.loadingSubtitle}>Synthesizing competitor website architectures and social signals...</Text>
          </View>
        ) : bundleError || !miBundle ? (
          <View style={styles.emptyContainer}>
            <Feather name="alert-circle" size={32} color="#EF4444" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Could Not Load Market Intelligence</Text>
            <Text style={styles.emptySubtitle}>
              {bundleError?.message || 'No active competitor data found for this campaign.'}
            </Text>
            <Pressable style={styles.retryBtn} onPress={handleRefresh}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : activeTab === 'overview' ? (
          <MarketOverviewView
            overview={miBundle.overview}
            onSelectCompetitor={handleSelectCompetitor}
          />
        ) : activeTab === 'library' ? (
          <CompetitorLibraryView
            competitors={miBundle.competitors}
            selectedCompetitorId={selectedCompetitorId}
            onSelectCompetitor={handleSelectCompetitor}
          />
        ) : isDossierLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingTitle}>Loading Competitor Dossier</Text>
            <Text style={styles.loadingSubtitle}>Assembling capabilities, positioning, playbook and evidence...</Text>
          </View>
        ) : dossierError || !dossierData ? (
          <View style={styles.emptyContainer}>
            <Feather name="alert-triangle" size={32} color="#F59E0B" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Dossier Data Incomplete</Text>
            <Text style={styles.emptySubtitle}>
              {dossierError?.message || 'Could not retrieve full intelligence for this competitor.'}
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => setActiveTab('library')}>
              <Text style={styles.retryText}>Return to Library</Text>
            </Pressable>
          </View>
        ) : (
          <CompetitorDossierView
            dossier={dossierData}
            onBackToList={() => setActiveTab('library')}
          />
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
