import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { WatchtowerController } from '@/services/watchtower/watchtower-controller';
import { WatchtowerSectionState } from '@/types/watchtower';
import WatchtowerEventListItem from '@/components/watchtower/WatchtowerEventListItem';
import WatchtowerEventDetail from '@/components/watchtower/WatchtowerEventDetail';
import FilterDropdown from '@/components/watchtower/FilterDropdown';
import { Feather } from '@expo/vector-icons';
import { useAppShellController } from '@/hooks/useAppShellController';
import { formatWatchtowerDate } from '@/utils/watchtower-date-formatter';
import { GlobalHeader } from '@/components/GlobalHeader';

const TABS = ['All Changes', 'High Impact', 'Confirmed', 'Under Review', 'Archived'] as const;

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
        impact: selectedImpact,
      });
      if (!isMounted) return;
      setState(data);
      if (data.events?.length > 0) {
        if (!selectedEventId || !data.events.some((e) => e.identity.cardId === selectedEventId)) {
          setSelectedEventId(data.events[0].identity.cardId);
        }
      } else {
        setSelectedEventId(null);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [controller, activeTab, selectedCompetitor, selectedType, selectedImpact]);

  if (!state) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingPulse}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
        <Text style={styles.loadingTitle}>Scanning market signals</Text>
        <Text style={styles.loadingSubtitle}>Analyzing competitor activity across all channels…</Text>
      </View>
    );
  }

  const selectedEvent = state.events.find((e) => e.identity.cardId === selectedEventId) || null;
  const displayLastScan = state.lastScanTimestamp
    ? formatWatchtowerDate(state.lastScanTimestamp)
    : '—';

  const confirmedCount = state.tabCounts?.['Confirmed'] ?? 0;
  const highImpactCount = state.tabCounts?.['High Impact'] ?? 0;

  return (
    <View style={styles.root}>
      {/* 🚀 HEADER 🚀 */}
      <GlobalHeader title="WATCHTOWER" />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <Feather name="target" size={18} color="#7C3AED" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Intelligence War Room</Text>
            <Text style={styles.headerSub}>Monitoring competitor signals across content, offers, and positioning</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {/* Confirmed pill */}
          {confirmedCount > 0 && (
            <View style={styles.pillConfirmed}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>{confirmedCount} confirmed</Text>
            </View>
          )}
          {/* High impact pill */}
          {highImpactCount > 0 && (
            <View style={styles.pillHighImpact}>
              <Feather name="zap" size={11} color="#EF4444" />
              <Text style={styles.pillHighText}>{highImpactCount} high impact</Text>
            </View>
          )}

          {/* Last scan */}
          <View style={styles.scanBadge}>
            <Feather name="clock" size={12} color="#6B7280" />
            <Text style={styles.scanText}>Last scan: {displayLastScan}</Text>
          </View>

          {/* Bell */}
          <Pressable style={styles.iconBtn}>
            <Feather name="bell" size={16} color="#9CA3AF" />
            {(shellController.badges.watchtower ?? 0) > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{shellController.badges.watchtower}</Text>
              </View>
            )}
          </Pressable>

          {/* Avatar */}
          <Pressable style={styles.avatar} onPress={shellController.openAccountSwitcher}>
            <Text style={styles.avatarText}>{shellController.userProfile?.initials || '?'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── STAT STRIP ── */}
      <View style={styles.statStrip}>
        <StatChip icon="activity" label="All Changes" value={state.tabCounts?.['All Changes'] ?? 0} color="#8B5CF6" />
        <View style={styles.statDivider} />
        <StatChip icon="zap" label="High Impact" value={highImpactCount} color="#EF4444" />
        <View style={styles.statDivider} />
        <StatChip icon="check-circle" label="Confirmed" value={confirmedCount} color="#10B981" />
        <View style={styles.statDivider} />
        <StatChip icon="eye" label="First Obs." value={state.tabCounts?.['First Observation'] ?? 0} color="#3B82F6" />
        <View style={styles.statDivider} />
        <StatChip icon="archive" label="Archived" value={state.tabCounts?.['Archived'] ?? 0} color="#6B7280" />
      </View>

      {/* ── TOOLBAR (tabs + filters) ── */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll}>
          <View style={styles.tabsRow}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              const count = state.tabCounts?.[tab as keyof typeof state.tabCounts];
              return (
                <Pressable
                  key={tab}
                  style={[styles.tab, isActive && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                >
                  <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                    {tab}
                  </Text>
                  {count !== undefined && count > 0 && (
                    <View style={[styles.tabCount, isActive && styles.tabCountActive]}>
                      <Text style={[styles.tabCountText, isActive && styles.tabCountTextActive]}>
                        {count}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.filtersRow, { zIndex: 100 }]}>
          <FilterDropdown
            label="Competitor"
            selectedValue={selectedCompetitor}
            defaultOption="All Competitors"
            options={state.availableFilters?.competitors || []}
            onSelect={setSelectedCompetitor}
          />
          <FilterDropdown
            label="Type"
            selectedValue={selectedType}
            defaultOption="All Types"
            options={state.availableFilters?.categories || []}
            onSelect={setSelectedType}
          />
          <FilterDropdown
            label="Impact"
            selectedValue={selectedImpact}
            defaultOption="All Impact"
            options={state.availableFilters?.impacts || []}
            onSelect={setSelectedImpact}
          />
        </View>
      </View>

      {/* ── SPLIT PANEL ── */}
      <View style={styles.split}>
        {/* Left: Event Feed */}
        <View style={styles.feedCol}>
          {state.pageState === 'NO_SIGNALS' ? (
            <EmptyPane
              icon="shield"
              title="Market is quiet"
              body="No Watchtower events detected yet. Scanning continues automatically."
            />
          ) : state.pageState === 'ERROR' ? (
            <EmptyPane
              icon="alert-circle"
              title="Could not load signals"
              body={state.error || 'An error occurred fetching intelligence.'}
              tint="#EF4444"
            />
          ) : (activeTab === 'Confirmed' && state.events.length === 0) ? (
            <EmptyPane
              icon="check-circle"
              title="No confirmed changes yet"
              body={`${state.tabCounts?.['Under Review'] ?? state.tabCounts?.['First Observation'] ?? 0} strategic changes are currently under review awaiting scheduled second confirmation fetch.`}
              action={{
                label: 'View Under Review',
                onPress: () => setActiveTab('Under Review'),
              }}
            />
          ) : state.events.length === 0 ? (
            <EmptyPane
              icon="filter"
              title="No results for these filters"
              body="Try broadening the competitor, type, or impact filter."
              action={{
                label: 'Clear filters',
                onPress: () => {
                  setSelectedCompetitor('All Competitors');
                  setSelectedType('All Types');
                  setSelectedImpact('All Impact');
                },
              }}
            />
          ) : (
            <ScrollView
              style={styles.feedScroll}
              contentContainerStyle={styles.feedContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.feedMeta}>
                {state.events.length} event{state.events.length !== 1 ? 's' : ''} · {activeTab}
              </Text>
              {state.events.map((event) => (
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

        {/* Right: Detail Panel */}
        <View style={styles.detailCol}>
          {selectedEventId && selectedEvent ? (
            <WatchtowerEventDetail
              eventId={selectedEventId}
              campaignId={campaignId}
              onClose={() => setSelectedEventId(null)}
            />
          ) : (
            <EmptyDetail />
          )}
        </View>
      </View>
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatChip({
  icon, label, value, color,
}: {
  icon: string; label: string; value: number; color: string;
}) {
  return (
    <View style={statStyles.chip}>
      <Feather name={icon as any} size={13} color={color} style={{ marginRight: 6 }} />
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

function EmptyPane({
  icon, title, body, tint = '#4B5563', action,
}: {
  icon: string; title: string; body: string; tint?: string; action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={[emptyStyles.iconWrap, { backgroundColor: tint + '18', borderColor: tint + '30' }]}>
        <Feather name={icon as any} size={28} color={tint} />
      </View>
      <Text style={emptyStyles.title}>{title}</Text>
      <Text style={emptyStyles.body}>{body}</Text>
      {action && (
        <Pressable style={emptyStyles.btn} onPress={action.onPress}>
          <Text style={emptyStyles.btnText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

function EmptyDetail() {
  return (
    <View style={emptyStyles.detailWrap}>
      <View style={emptyStyles.detailIcon}>
        <Feather name="inbox" size={32} color="#374151" />
      </View>
      <Text style={emptyStyles.detailTitle}>Select a signal to investigate</Text>
      <Text style={emptyStyles.detailBody}>
        Click any event in the feed to open the full investigation workspace — evidence, timeline, and recommended actions.
      </Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0F13',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#070B12',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingPulse: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7C3AED18',
    borderWidth: 1,
    borderColor: '#7C3AED30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#6B7280',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#070B12',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#7C3AED18',
    borderWidth: 1,
    borderColor: '#7C3AED30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F9FAFB',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillConfirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B98118',
    borderWidth: 1,
    borderColor: '#10B98130',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
  },
  pillHighImpact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EF444418',
    borderWidth: 1,
    borderColor: '#EF444430',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pillHighText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  scanBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  scanText: {
    fontSize: 12,
    color: '#6B7280',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#070B12',
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4C1D95',
    borderWidth: 1.5,
    borderColor: '#7C3AED50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#0A0F18',
    gap: 0,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1E2535',
    marginHorizontal: 20,
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 28,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#070B12',
    zIndex: 100,
    elevation: 100,
  },
  tabsScroll: {
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 0,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: {
    borderColor: '#7C3AED',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#F9FAFB',
  },
  tabCount: {
    backgroundColor: '#1E2535',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tabCountActive: {
    backgroundColor: '#7C3AED30',
  },
  tabCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
  },
  tabCountTextActive: {
    color: '#A78BFA',
  },
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },

  // Split
  split: {
    flex: 1,
    flexDirection: 'row',
  },
  feedCol: {
    width: '40%',
    maxWidth: 480,
    borderRightWidth: 1,
    borderColor: '#111827',
  },
  feedScroll: {
    flex: 1,
  },
  feedContent: {
    padding: 16,
    paddingBottom: 60,
  },
  feedMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  detailCol: {
    flex: 1,
    backgroundColor: '#070B12',
  },
});

const statStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  value: {
    fontSize: 18,
    fontWeight: '800',
    marginRight: 6,
  },
  label: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
});

const emptyStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    minHeight: 300,
    gap: 12,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F9FAFB',
    textAlign: 'center',
  },
  body: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  btn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  btnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D1D5DB',
  },
  detailWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 14,
  },
  detailIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  detailTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  detailBody: {
    fontSize: 13,
    color: '#4B5563',
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 21,
  },
});
