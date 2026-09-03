import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import type { CompetitorSummaryItemViewModel } from '@/types/market-intelligence';

interface Props {
  competitors: CompetitorSummaryItemViewModel[];
  selectedCompetitorId?: string | null;
  onSelectCompetitor: (competitorId: string) => void;
}

export default function CompetitorLibraryView({
  competitors,
  selectedCompetitorId,
  onSelectCompetitor,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCompetitors = competitors.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.oneLineSummary.toLowerCase().includes(q) ||
      c.primaryPositioning.toLowerCase().includes(q)
    );
  });

  return (
    <View style={styles.container}>
      {/* ── SEARCH & FILTER HEADER ── */}
      <View style={styles.searchBar}>
        <Feather name="search" size={15} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search competitors by name, category, or positioning..."
          placeholderTextColor="#6B7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')}>
            <Feather name="x" size={14} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      {/* ── DIRECTORY LIST ── */}
      <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.countRow}>
          <Text style={styles.countText}>
            Showing {filteredCompetitors.length} of {competitors.length} Monitored Competitors
          </Text>
        </View>

        <View style={styles.gridContainer}>
          {filteredCompetitors.map((c) => {
            const isSelected = selectedCompetitorId === c.competitorId;
            return (
              <Pressable
                key={c.competitorId}
                style={[styles.compCard, isSelected && styles.compCardSelected]}
                onPress={() => onSelectCompetitor(c.competitorId)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.compName}>{c.name}</Text>
                    <View style={styles.categoryPill}>
                      <Text style={styles.categoryPillText}>{c.category}</Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={16} color={isSelected ? '#A78BFA' : '#6B7280'} />
                </View>

                <Text style={styles.oneLineSummary} numberOfLines={2}>
                  {c.oneLineSummary}
                </Text>

                <View style={styles.positioningSnippet}>
                  <Text style={styles.posLabel}>POSITIONING:</Text>
                  <Text style={styles.posText} numberOfLines={2}>
                    "{c.primaryPositioning}"
                  </Text>
                </View>

                <View style={styles.cardFooter}>
                  <View style={styles.badgeRow}>
                    <View style={styles.capBadge}>
                      <Feather name="layers" size={11} color="#A78BFA" style={{ marginRight: 4 }} />
                      <Text style={styles.capBadgeText}>{c.capabilitiesCount} Capabilities</Text>
                    </View>

                    {c.recentChangesCount > 0 && (
                      <View style={styles.changeBadge}>
                        <Feather name="activity" size={11} color="#F59E0B" style={{ marginRight: 4 }} />
                        <Text style={styles.changeBadgeText}>{c.recentChangesCount} Recent Shifts</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.freshnessText}>{c.freshnessLabel}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ShellTheme.colors.appBackground,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    padding: 0,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    padding: 24,
    paddingTop: 8,
    maxWidth: 1040,
    alignSelf: 'center',
    width: '100%',
  },
  countRow: {
    marginBottom: 12,
  },
  countText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  gridContainer: {
    gap: 12,
  },
  compCard: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 18,
  },
  compCardSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#181C26',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  compName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  categoryPill: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryPillText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  oneLineSummary: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 18,
    marginBottom: 10,
  },
  positioningSnippet: {
    backgroundColor: '#11161F',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 12,
  },
  posLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  posText: {
    fontSize: 12,
    color: '#E5E7EB',
    fontStyle: 'italic',
    lineHeight: 17,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  capBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF615',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  capBadgeText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '600',
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B15',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  changeBadgeText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '600',
  },
  freshnessText: {
    fontSize: 11,
    color: '#6B7280',
  },
});
