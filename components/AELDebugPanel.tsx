import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';

interface AELDimension {
  label: string;
  key: string;
  icon: string;
}

const AEL_DIMENSIONS: AELDimension[] = [
  { label: 'Root Cause Candidates', key: 'root_cause_candidates', icon: 'search-outline' },
  { label: 'Pain Type Map', key: 'pain_type_map', icon: 'heart-dislike-outline' },
  { label: 'Trust Gap Map', key: 'trust_gap_map', icon: 'shield-outline' },
  { label: 'Mechanism Gap Hints', key: 'mechanism_gap_hints', icon: 'construct-outline' },
  { label: 'Proof Need Hints', key: 'proof_need_hints', icon: 'checkmark-circle-outline' },
  { label: 'Strategic Angle Candidates', key: 'strategic_angle_candidates', icon: 'compass-outline' },
  { label: 'Contradiction Flags', key: 'contradiction_flags', icon: 'warning-outline' },
  { label: 'Confidence Notes', key: 'confidence_notes', icon: 'analytics-outline' },
];

export default function AELDebugPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { activeCampaign } = useCampaign();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aelData, setAelData] = useState<any>(null);
  const [aelVersion, setAelVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  const fetchAEL = async () => {
    if (!activeCampaign) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/ael/status/' + activeCampaign.id, getApiUrl());
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.hasCachedPackage && data.package) {
        setAelData(data.package);
        setAelVersion(data.version || null);
      } else {
        const buildUrl = new URL('/api/ael/build', getApiUrl());
        const buildRes = await fetch(buildUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: activeCampaign.id,
            accountId: activeCampaign.accountId || 'default',
          }),
        });
        const buildData = await buildRes.json();
        if (buildData.success) {
          setAelData(buildData.package);
          setAelVersion(buildData.version || null);
        } else {
          setError(buildData.message || 'Failed to build AEL');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !aelData && !loading) {
      fetchAEL();
    }
  };

  const getDimensionData = (key: string) => {
    if (!aelData) return null;
    return aelData[key];
  };

  const getDimensionCount = (key: string) => {
    const data = getDimensionData(key);
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object') return Object.keys(data).length;
    return data ? 1 : 0;
  };

  const bg = isDark ? '#1a1a2e' : '#f8f9ff';
  const cardBg = isDark ? '#252542' : '#ffffff';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const mutedColor = isDark ? '#888' : '#999';
  const accentColor = '#7c5cfc';
  const borderColor = isDark ? '#333' : '#e0e0e0';

  return (
    <View style={[styles.container, { backgroundColor: bg, borderColor }]}>
      <Pressable onPress={toggleExpanded} style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="flask-outline" size={16} color={accentColor} />
          <Text style={[styles.headerText, { color: textColor }]}>AEL Debug</Text>
          {aelData && (
            <View style={[styles.badge, { backgroundColor: accentColor + '22' }]}>
              <Text style={[styles.badgeText, { color: accentColor }]}>
                v{aelVersion || 1}
              </Text>
            </View>
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={mutedColor}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={[styles.loadingText, { color: mutedColor }]}>Building analytical package...</Text>
            </View>
          )}

          {error && (
            <View style={[styles.errorRow, { backgroundColor: '#ff4d4f15' }]}>
              <Ionicons name="warning-outline" size={14} color="#ff4d4f" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {aelData && (
            <ScrollView style={styles.dimList} nestedScrollEnabled>
              {aelData.generatedAt && (
                <Text style={[styles.timestamp, { color: mutedColor }]}>
                  Generated: {new Date(aelData.generatedAt).toLocaleString()}
                </Text>
              )}
              {AEL_DIMENSIONS.map((dim) => {
                const count = getDimensionCount(dim.key);
                const isExpanded = expandedDim === dim.key;
                const data = getDimensionData(dim.key);

                return (
                  <View key={dim.key}>
                    <Pressable
                      onPress={() => setExpandedDim(isExpanded ? null : dim.key)}
                      style={[styles.dimRow, { backgroundColor: cardBg, borderColor }]}
                    >
                      <View style={styles.dimLeft}>
                        <Ionicons name={dim.icon as any} size={14} color={count > 0 ? accentColor : mutedColor} />
                        <Text style={[styles.dimLabel, { color: count > 0 ? textColor : mutedColor }]}>
                          {dim.label}
                        </Text>
                      </View>
                      <View style={styles.dimRight}>
                        <Text style={[styles.dimCount, { color: count > 0 ? accentColor : mutedColor }]}>
                          {count}
                        </Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={mutedColor}
                        />
                      </View>
                    </Pressable>
                    {isExpanded && data && (
                      <View style={[styles.dimDetail, { backgroundColor: isDark ? '#1e1e36' : '#f0f0ff', borderColor }]}>
                        <Text style={[styles.dimDetailText, { color: textColor }]}>
                          {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {!loading && !error && !aelData && (
            <Pressable onPress={fetchAEL} style={[styles.fetchBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.fetchBtnText}>Load AEL Data</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 12,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 6,
  },
  errorText: {
    color: '#ff4d4f',
    fontSize: 12,
  },
  dimList: {
    maxHeight: 400,
  },
  timestamp: {
    fontSize: 10,
    marginBottom: 6,
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 4,
  },
  dimLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  dimLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  dimRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dimCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  dimDetail: {
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 6,
    marginLeft: 20,
  },
  dimDetailText: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  fetchBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  fetchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
