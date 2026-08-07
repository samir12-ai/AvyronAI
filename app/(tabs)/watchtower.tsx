import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Image } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { WatchtowerController } from '@/services/watchtower/watchtower-controller';
import { WatchtowerSectionState, WatchtowerEvent } from '@/types/watchtower';
import WatchtowerEventListItem from '@/components/watchtower/WatchtowerEventListItem';
import WatchtowerEventDetail from '@/components/watchtower/WatchtowerEventDetail';
import FilterDropdown from '@/components/watchtower/FilterDropdown';
import { Feather } from '@expo/vector-icons';
import { useAppShellController } from '@/hooks/useAppShellController';
import { formatWatchtowerDate } from '@/utils/watchtower-date-formatter';

export default function WatchtowerPage() {
  const { user } = useAuth();
  const shellController = useAppShellController();
  const [state, setState] = useState<WatchtowerSectionState | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('All Changes');
  
  const [selectedCompetitor, setSelectedCompetitor] = useState<string>('All Competitors');
  const [selectedType, setSelectedType] = useState<string>('All Types');
  const [selectedImpact, setSelectedImpact] = useState<string>('All Impact');

  const campaignId = shellController.activeWorkspace?.id || 'campaign_1773576062201_6t0oxi';
  const controller = useMemo(() => new WatchtowerController(campaignId), [campaignId]);

  useEffect(() => {
    let isMounted = true;
    
    async function load() {
      const data = await controller.fetchWatchtowerState({
        tab: activeTab,
        competitor: selectedCompetitor,
        category: selectedType,
        impact: selectedImpact
      });
      
      if (!isMounted) return; // Prevent race conditions by dropping stale requests

      setState(data);
      
      // Selection Safety
      if (data.events && data.events.length > 0) {
        // Only select the first event if the currently selected one is no longer in the list
        if (!selectedEventId || !data.events.some(e => e.identity.cardId === selectedEventId)) {
          setSelectedEventId(data.events[0].identity.cardId);
        }
      } else {
        setSelectedEventId(null);
      }
    }
    
    load();
    
    return () => {
      isMounted = false; // Abort stale responses
    };
  }, [controller, activeTab, selectedCompetitor, selectedType, selectedImpact]);

  if (!state) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>Monitoring market signals...</Text>
      </View>
    );
  }

  const selectedEvent = state.events.find(e => e.identity.cardId === selectedEventId) || null;

  // Format time since last scan
  const displayLastScan = state.lastScanTimestamp 
    ? formatWatchtowerDate(state.lastScanTimestamp)
    : 'Scan unavailable';

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        
        {/* TOP HEADER */}
        <View style={styles.pageHeader}>
          <View style={styles.headerTopRow}>
            
            <View style={styles.titleCol}>
              <View style={styles.titleContainer}>
                <Feather name="target" size={28} color="#8B5CF6" style={{ marginRight: 14 }} /> 
                <Text style={styles.pageTitle}>Intelligence War Room</Text>
              </View>
              <Text style={styles.pageSubtitle} numberOfLines={1}>
                Monitoring market activity. Awaiting first observation and confirmation before strategic response.
              </Text>
            </View>

            <View style={styles.headerControls}>
              {/* Workspace Dropdown */}
              <Pressable style={styles.headerDropdown} onPress={shellController.openAccountSwitcher}>
                <Text style={styles.headerDropdownText}>{shellController.activeWorkspace?.name || 'Workspace'}</Text>
                <Feather name="chevron-down" size={16} color="#9CA3AF" />
              </Pressable>

              {/* Last Scan (Replaces static Date Range) */}
              <View style={styles.headerDate}>
                <Text style={styles.headerDateText}>Last scan: {displayLastScan}</Text>
                <Feather name="clock" size={14} color="#9CA3AF" style={{ marginLeft: 8 }} />
              </View>

              {/* Bell Notification */}
              <Pressable style={styles.headerBell}>
                <Feather name="bell" size={18} color="#D1D5DB" />
                {shellController.badges.watchtower > 0 && (
                  <View style={styles.headerBellBadge}>
                    <Text style={styles.headerBellBadgeText}>{shellController.badges.watchtower}</Text>
                  </View>
                )}
              </Pressable>

              {/* User Avatar */}
              <Pressable style={styles.headerAvatar} onPress={shellController.openAccountSwitcher}>
                <Text style={styles.headerAvatarText}>{shellController.userProfile?.initials || '?'}</Text>
              </Pressable>
            </View>

          </View>
        </View>

        {/* TOOLBAR */}
        <View style={styles.toolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.tabs}>
              {['All Changes', 'High Impact', 'Confirmed', 'First Observation', 'Archived'].map(tab => {
                const count = state.tabCounts[tab as keyof typeof state.tabCounts];
                const displayTab = count !== undefined ? `${tab} (${count})` : tab;
                return (
                  <Pressable 
                    key={tab} 
                    style={[styles.tabContainer, activeTab === tab && styles.activeTabContainer]}
                    onPress={() => setActiveTab(tab)}
                  >
                    <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                      {displayTab}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          
          <View style={[styles.filters, { zIndex: 10 }]}>
            <FilterDropdown 
              label="Competitor"
              selectedValue={selectedCompetitor}
              defaultOption="All Competitors"
              options={state.availableFilters.competitors || []}
              onSelect={setSelectedCompetitor}
            />

            <FilterDropdown 
              label="Type"
              selectedValue={selectedType}
              defaultOption="All Types"
              options={state.availableFilters.categories || []}
              onSelect={setSelectedType}
            />

            <FilterDropdown 
              label="Impact"
              selectedValue={selectedImpact}
              defaultOption="All Impact"
              options={state.availableFilters.impacts || []}
              onSelect={setSelectedImpact}
            />

            <Pressable style={[styles.filterBtn, styles.filterBtnIcon]}>
              <Feather name="filter" size={14} color="#9CA3AF" />
              <Text style={styles.filterBtnText}>Filters</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.splitView}>
          {/* Left Side: Event Feed */}
          <View style={styles.leftSidebar}>
            {state.pageState === 'NO_SIGNALS' ? (
              <View style={styles.emptyState}>
                <Feather name="shield" size={48} color="#374151" />
                <Text style={styles.emptyStateTitle}>Market is quiet</Text>
                <Text style={styles.emptyStateBody}>No Watchtower events detected yet.</Text>
              </View>
            ) : state.pageState === 'ERROR' ? (
              <View style={styles.emptyState}>
                <Feather name="alert-circle" size={48} color="#DC2626" />
                <Text style={styles.emptyStateTitle}>System Error</Text>
                <Text style={styles.emptyStateBody}>{state.error || 'Failed to load intelligence.'}</Text>
              </View>
            ) : state.events.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="filter" size={48} color="#374151" />
                <Text style={styles.emptyStateTitle}>No results found</Text>
                <Text style={styles.emptyStateBody}>No events match the selected filters.</Text>
                <Pressable 
                  style={{ marginTop: 16, backgroundColor: '#1E2535', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#374151' }}
                  onPress={() => {
                    setSelectedCompetitor('All Competitors');
                    setSelectedType('All Types');
                    setSelectedImpact('All Impact');
                  }}
                >
                  <Text style={{ color: '#D1D5DB', fontSize: 13, fontWeight: '500' }}>Clear Filters</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContainer}>
                {state.events.map(event => (
                  <WatchtowerEventListItem 
                    key={event.identity.cardId} 
                    event={event} 
                    isSelected={event.identity.cardId === selectedEventId}
                    onSelect={setSelectedEventId}
                  />
                ))}
              </ScrollView>
            )}
          </View>

          {/* Right Side: Detail Panel */}
          <View style={styles.rightMain}>
            {selectedEventId && selectedEvent ? (
              <WatchtowerEventDetail 
                eventId={selectedEventId}
                campaignId={campaignId}
                onClose={() => setSelectedEventId(null)}
              />
            ) : (
              <View style={styles.emptyDetailState}>
                <Feather name="folder" size={48} color="#374151" />
                <Text style={styles.emptyStateTitle}>Select a case file to investigate.</Text>
                <Text style={styles.emptyStateBody}>Click on any market event in the feed to open the Investigation Workspace.</Text>
              </View>
            )}
          </View>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F131A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F131A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: '#9CA3AF',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  pageHeader: {
    paddingHorizontal: 40,
    paddingTop: 40,
    paddingBottom: 32,
    backgroundColor: '#0F131A',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center', // changed from flex-start
    marginBottom: 32, // increased spacing
  },
  titleCol: {
    flex: 1,
    paddingRight: 32,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  pageTitle: {
    fontSize: 32, // increased
    fontWeight: '900', // increased
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  pageSubtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    flexShrink: 1,
    lineHeight: 22,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2535', // more premium
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24, // highly rounded
    borderWidth: 1,
    borderColor: '#2A3347',
    gap: 12,
  },
  headerDropdownText: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '600',
  },
  headerDate: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  headerDateText: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '500',
  },
  headerBell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerBellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#0F131A',
  },
  headerBellBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4C1D95',
    borderWidth: 1,
    borderColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  kpiRibbon: {
    flexDirection: 'row',
    gap: 20,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#161B22',
    padding: 24,
    borderRadius: 16, // softer radius
    borderWidth: 1,
    borderColor: '#1E2535',
    minHeight: 140, // increased height
    justifyContent: 'space-between',
    transitionProperty: 'transform, box-shadow, border-color', // Add transition properties for web
    transitionDuration: '180ms',
    transitionTimingFunction: 'ease-in-out',
  },
  kpiCardHovered: {
    transform: [{ translateY: -4 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    borderColor: '#2A3347',
    elevation: 8,
  },
  kpiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16, // more spacing
    gap: 12,
  },
  kpiIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiLabel: {
    fontSize: 14,
    color: '#9CA3AF', // muted typography
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 36, // much larger numbers
    fontWeight: '900',
    color: '#F9FAFB',
    marginBottom: 8,
  },
  kpiValueDim: {
    color: '#4B5563',
    fontSize: 24,
  },
  kpiSub: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  kpiTrendPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  trendUnavailableText: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderColor: '#1E2535',
    zIndex: 100, // Elevate toolbar above splitView
    elevation: 100,
  },
  tabs: {
    flexDirection: 'row',
    gap: 32,
  },
  tabContainer: {
    paddingBottom: 20,
    marginBottom: -1,
    borderBottomWidth: 3,
    borderColor: 'transparent',
  },
  activeTabContainer: {
    borderColor: '#8B5CF6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  filters: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F131A', // Darker inner color
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2535',
    gap: 8,
  },
  filterBtnIcon: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    minWidth: 160,
    backgroundColor: '#1E2535',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    maxHeight: 200,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dropdownScroll: {
    flex: 1,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2D3748',
  },
  dropdownItemText: {
    color: '#D1D5DB',
    fontSize: 13,
  },
  filterBtnText: {
    fontSize: 13,
    color: '#D1D5DB',
  },
  splitView: {
    flex: 1,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#1E2535',
    zIndex: 1,
    elevation: 1,
  },
  leftSidebar: {
    width: '45%',
    maxWidth: 550, // Limit width of feed
    borderRightWidth: 1,
    borderColor: '#1E2535',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 60,
  },
  listScroll: {
    flex: 1,
  },
  rightMain: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    minHeight: 400,
  },
  emptyDetailState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#0F131A',
    minHeight: 400,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F9FAFB',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateBody: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 22,
  },
  bottomPanels: {
    flexDirection: 'row',
    padding: 32,
    gap: 24,
  },
  bottomPanel: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    minHeight: 200,
  },
  bottomPanelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 16,
  },
  bottomPanelContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
