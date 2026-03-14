import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated as RNAnimated,
  TextInput,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getApiUrl, apiRequest } from '@/lib/query-client';

const P = {
  mint: '#8B5CF6',
  purple: '#A78BFA',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  green: '#34D399',
  orange: '#FFB347',
  silver: '#8892A4',
  darkBg: '#080C10',
  darkCard: '#0F1419',
  darkCardBorder: '#1A2030',
  darkSurface: '#151B24',
  lightCard: '#FFFFFF',
  lightCardBorder: '#E2E8E4',
  lightSurface: '#EDF2EE',
  textDarkPrimary: '#E8EDF2',
  textDarkSec: '#8892A4',
  textDarkMuted: '#4A5568',
  textLightPrimary: '#1A2332',
  textLightSec: '#546478',
  textLightMuted: '#8A96A8',
};

type DnaSnapshot = {
  ctaType?: string;
  hookStyle?: string;
  hookDuration?: string;
  narrativeStyle?: string;
  contentAngle?: string;
  formatPriority?: string;
  toneStyle?: string;
};

type AgentBrief = {
  campaignStatus: string;
  insight: string;
  priorityAction: string;
  planProgress: { completed: number; total: number; remaining: number; percent: number } | null;
  engineCount: number;
  enginesActive: string[];
  engineSummaries: Record<string, string>;
  planSections: string[];
  hasPlan: boolean;
  planStatus: string | null;
  hasMetrics: boolean;
  mode: string;
  metrics: { cpa: number; roas: number; spend: number; revenue: number } | null;
  contentDnaSnapshot: DnaSnapshot | null;
};

type Props = {
  campaignId: string | null;
  isDark: boolean;
};

export type MarketMindAgentRef = {
  refresh: () => Promise<void>;
};

export const MarketMindAgent = forwardRef<MarketMindAgentRef, Props>(function MarketMindAgent({ campaignId, isDark }, ref) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [askQuestion, setAskQuestion] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const pulseAnim = useRef(new RNAnimated.Value(0.4)).current;
  const expandAnim = useRef(new RNAnimated.Value(0)).current;

  const baseUrl = getApiUrl();

  const textPrimary = isDark ? P.textDarkPrimary : P.textLightPrimary;
  const textSecondary = isDark ? P.textDarkSec : P.textLightSec;
  const textMuted = isDark ? P.textDarkMuted : P.textLightMuted;
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;
  const surfaceBg = isDark ? P.darkSurface : P.lightSurface;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const requestIdRef = useRef(0);

  const fetchBrief = useCallback(async () => {
    if (!campaignId) {
      setState('ready');
      setBrief(null);
      return;
    }
    const thisRequest = ++requestIdRef.current;
    setState('loading');
    try {
      const res = await fetch(
        new URL(`/api/dashboard/agent-brief?accountId=default&campaignId=${campaignId}`, baseUrl).toString()
      );
      if (thisRequest !== requestIdRef.current) return;
      if (!res.ok) { setState('error'); return; }
      const data = await res.json();
      if (thisRequest !== requestIdRef.current) return;
      if (!data.success) { setState('error'); return; }
      setBrief(data);
      setState('ready');
    } catch {
      if (thisRequest === requestIdRef.current) setState('error');
    }
  }, [baseUrl, campaignId]);

  useImperativeHandle(ref, () => ({ refresh: fetchBrief }), [fetchBrief]);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  const handleAsk = useCallback(async () => {
    if (!question.trim() || !campaignId || answering) return;
    Keyboard.dismiss();
    setAnswering(true);
    setAnswer('');
    try {
      const res = await fetch(
        new URL(`/api/dashboard/agent-explain?accountId=default&campaignId=${campaignId}`, baseUrl).toString(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: question.trim() }),
        }
      );
      const data = await res.json();
      setAnswer(data.answer || 'Unable to generate an answer right now.');
    } catch {
      setAnswer('Failed to connect. Please try again.');
    } finally {
      setAnswering(false);
    }
  }, [question, campaignId, baseUrl, answering]);

  const toggleExpand = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !expanded;
    setExpanded(next);
    RNAnimated.timing(expandAnim, { toValue: next ? 1 : 0, duration: 250, useNativeDriver: false }).start();
  };

  const engineIcon = (name: string): keyof typeof Ionicons.glyphMap => {
    const map: Record<string, keyof typeof Ionicons.glyphMap> = {
      'Market Intelligence': 'globe-outline',
      'Audience': 'people-outline',
      'Positioning': 'navigate-outline',
      'Differentiation': 'diamond-outline',
      'Offer': 'pricetag-outline',
      'Funnel': 'funnel-outline',
      'Awareness': 'megaphone-outline',
      'Persuasion': 'chatbubbles-outline',
    };
    return map[name] || 'flash-outline';
  };

  if (state === 'loading') {
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.headerRow}>
          <View style={st.headerLeft}>
            <RNAnimated.View style={[st.agentDot, { backgroundColor: P.mint, opacity: pulseAnim }]} />
            <Text style={[st.title, { color: textPrimary }]}>MarketMind Agent</Text>
          </View>
        </View>
        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={P.mint} />
          <Text style={[st.subText, { color: textMuted, marginTop: 8 }]}>Analyzing campaign intelligence...</Text>
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: P.coral + '30' }]}>
        <View style={st.headerRow}>
          <View style={st.headerLeft}>
            <View style={[st.agentDot, { backgroundColor: P.coral }]} />
            <Text style={[st.title, { color: P.coral }]}>MarketMind Agent</Text>
          </View>
        </View>
        <Text style={[st.subText, { color: textMuted }]}>Failed to load agent intelligence</Text>
        <Pressable onPress={fetchBrief} style={[st.retryBtn, { backgroundColor: P.coral + '15' }]}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: P.coral }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!campaignId || !brief) {
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.headerRow}>
          <View style={st.headerLeft}>
            <View style={[st.agentDot, { backgroundColor: P.silver }]} />
            <Text style={[st.title, { color: textMuted }]}>MarketMind Agent</Text>
          </View>
        </View>
        <Text style={[st.subText, { color: textMuted }]}>
          {campaignId ? 'Awaiting campaign data...' : 'Select a campaign to activate the agent'}
        </Text>
      </View>
    );
  }

  const progress = brief.planProgress;

  return (
    <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={st.headerRow}>
        <View style={st.headerLeft}>
          <RNAnimated.View style={[st.agentDot, { backgroundColor: P.mint, opacity: pulseAnim }]} />
          <View>
            <Text style={[st.title, { color: textPrimary }]}>MarketMind Agent</Text>
            <Text style={[st.statusLine, { color: textMuted }]}>{brief.campaignStatus}</Text>
          </View>
        </View>
        <View style={st.headerRight}>
          <View style={[st.engineBadge, { backgroundColor: P.mint + '15' }]}>
            <Ionicons name="flash" size={10} color={P.mint} />
            <Text style={[st.engineBadgeText, { color: P.mint }]}>{brief.engineCount}</Text>
          </View>
        </View>
      </View>

      <View style={[st.insightBox, { backgroundColor: isDark ? P.mint + '08' : P.mint + '06', borderColor: P.mint + '18' }]}>
        <Ionicons name="bulb-outline" size={14} color={P.mint} style={{ marginTop: 1 }} />
        <Text style={[st.insightText, { color: textSecondary }]}>{brief.insight}</Text>
      </View>

      <View style={[st.actionBox, { backgroundColor: isDark ? '#0F1A15' : '#F0FFF4', borderColor: isDark ? '#1A3025' : '#C6F6D5' }]}>
        <Ionicons name="arrow-forward-circle" size={14} color={P.green} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={[st.actionLabel, { color: P.green }]}>Priority Action</Text>
          <Text style={[st.actionText, { color: textSecondary }]}>{brief.priorityAction}</Text>
        </View>
      </View>

      {progress && (
        <View style={st.progressSection}>
          <View style={st.progressHeader}>
            <Text style={[st.progressLabel, { color: textMuted }]}>Content Progress</Text>
            <Text style={[st.progressValue, { color: textPrimary }]}>{progress.completed}/{progress.total}</Text>
          </View>
          <View style={[st.progressBar, { backgroundColor: isDark ? '#1A2030' : '#E8ECE9' }]}>
            <View style={[st.progressFill, { width: `${Math.min(progress.percent, 100)}%`, backgroundColor: P.mint }]} />
          </View>
          <Text style={[st.progressSub, { color: textMuted }]}>{progress.percent}% complete · {progress.remaining} remaining</Text>
        </View>
      )}

      {brief.contentDnaSnapshot && (
        <View style={[st.dnaBox, { backgroundColor: isDark ? P.mint + '06' : P.mint + '04', borderColor: P.mint + '15' }]}>
          <View style={st.dnaHeader}>
            <Ionicons name="code-working-outline" size={13} color={P.mint} />
            <Text style={[st.dnaTitle, { color: textPrimary }]}>Content DNA</Text>
          </View>
          <View style={st.dnaGrid}>
            {brief.contentDnaSnapshot.ctaType && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>CTA</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.ctaType}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.hookStyle && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Hooks</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.hookStyle}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.hookDuration && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Hook length</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.hookDuration}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.narrativeStyle && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Narrative</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.narrativeStyle}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.contentAngle && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Angle</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.contentAngle}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.toneStyle && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Tone</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.toneStyle}</Text>
              </View>
            )}
            {brief.contentDnaSnapshot.formatPriority && (
              <View style={st.dnaItem}>
                <Text style={[st.dnaLabel, { color: textMuted }]}>Format</Text>
                <Text style={[st.dnaValue, { color: textSecondary }]} numberOfLines={1}>{brief.contentDnaSnapshot.formatPriority}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      <View style={st.shortcutsRow}>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/studio'); }}
          style={[st.shortcutBtn, { backgroundColor: isDark ? '#1A1530' : '#F3EEFF' }]}
        >
          <Ionicons name="create-outline" size={14} color={P.mint} />
          <Text style={[st.shortcutText, { color: P.mint }]}>Create</Text>
        </Pressable>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/calendar'); }}
          style={[st.shortcutBtn, { backgroundColor: isDark ? '#0F1A15' : '#F0FFF4' }]}
        >
          <Ionicons name="calendar-outline" size={14} color={P.green} />
          <Text style={[st.shortcutText, { color: P.green }]}>Calendar</Text>
        </Pressable>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/ai-management'); }}
          style={[st.shortcutBtn, { backgroundColor: isDark ? '#1A1520' : '#FFF5F5' }]}
        >
          <Feather name="sliders" size={14} color={P.blue} />
          <Text style={[st.shortcutText, { color: P.blue }]}>Engines</Text>
        </Pressable>
      </View>

      <Pressable onPress={toggleExpand} style={[st.expandBtn, { borderTopColor: isDark ? '#1A2030' : '#F0F3F1' }]}>
        <Text style={[st.expandText, { color: textSecondary }]}>
          {expanded ? 'Hide Details' : `Engine Intelligence (${brief.engineCount} active)`}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={textMuted} />
      </Pressable>

      {expanded && (
        <View style={st.detailsSection}>
          {brief.enginesActive.length > 0 && (
            <View style={st.enginesGrid}>
              {brief.enginesActive.map((eng) => (
                <View key={eng} style={[st.engineItem, { backgroundColor: surfaceBg }]}>
                  <Ionicons name={engineIcon(eng)} size={13} color={P.mint} />
                  <View style={{ flex: 1 }}>
                    <Text style={[st.engineName, { color: textPrimary }]}>{eng}</Text>
                    {brief.engineSummaries[eng.charAt(0).toLowerCase() + eng.slice(1).replace(/\s/g, '')] && (
                      <Text style={[st.engineDetail, { color: textMuted }]} numberOfLines={2}>
                        {brief.engineSummaries[eng.charAt(0).toLowerCase() + eng.slice(1).replace(/\s/g, '')]}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {brief.planSections.length > 0 && (
            <View style={st.planSectionsBox}>
              <Text style={[st.sectionLabel, { color: textMuted }]}>Plan Sections</Text>
              <View style={st.sectionTags}>
                {brief.planSections.map((sec) => (
                  <View key={sec} style={[st.sectionTag, { backgroundColor: P.purple + '12' }]}>
                    <Text style={[st.sectionTagText, { color: P.purple }]}>{sec}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {brief.metrics && (
            <View style={[st.metricsRow, { borderTopColor: isDark ? '#1A2030' : '#F0F3F1' }]}>
              <View style={st.metricItem}>
                <Text style={[st.metricValue, { color: textPrimary }]}>${brief.metrics.cpa}</Text>
                <Text style={[st.metricLabel, { color: textMuted }]}>CPA</Text>
              </View>
              <View style={st.metricItem}>
                <Text style={[st.metricValue, { color: textPrimary }]}>{brief.metrics.roas}x</Text>
                <Text style={[st.metricLabel, { color: textMuted }]}>ROAS</Text>
              </View>
              <View style={st.metricItem}>
                <Text style={[st.metricValue, { color: textPrimary }]}>${(brief.metrics.spend / 1000).toFixed(1)}k</Text>
                <Text style={[st.metricLabel, { color: textMuted }]}>Spend</Text>
              </View>
              <View style={st.metricItem}>
                <Text style={[st.metricValue, { color: textPrimary }]}>${(brief.metrics.revenue / 1000).toFixed(1)}k</Text>
                <Text style={[st.metricLabel, { color: textMuted }]}>Revenue</Text>
              </View>
            </View>
          )}

          <Pressable
            onPress={() => { setAskQuestion(!askQuestion); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[st.askBtn, { backgroundColor: P.mint + '12', borderColor: P.mint + '25' }]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={P.mint} />
            <Text style={[st.askBtnText, { color: P.mint }]}>Ask the Agent</Text>
          </Pressable>

          {askQuestion && (
            <View style={st.askSection}>
              <View style={[st.inputRow, { backgroundColor: surfaceBg, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <TextInput
                  style={[st.input, { color: textPrimary }]}
                  placeholder="e.g. Why was this positioning chosen?"
                  placeholderTextColor={textMuted}
                  value={question}
                  onChangeText={setQuestion}
                  onSubmitEditing={handleAsk}
                  returnKeyType="send"
                />
                <Pressable
                  onPress={handleAsk}
                  disabled={answering || !question.trim()}
                  style={[st.sendBtn, { backgroundColor: P.mint, opacity: (answering || !question.trim()) ? 0.4 : 1 }]}
                >
                  {answering ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="arrow-up" size={14} color="#fff" />
                  )}
                </Pressable>
              </View>
              {answer ? (
                <View style={[st.answerBox, { backgroundColor: isDark ? P.mint + '08' : P.mint + '06', borderColor: P.mint + '15' }]}>
                  <Text style={[st.answerText, { color: textSecondary }]}>{answer}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      )}
    </View>
  );
});

const st = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  statusLine: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  subText: {
    fontSize: 12,
    lineHeight: 17,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  engineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  engineBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  insightBox: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  insightText: {
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  actionBox: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  actionText: {
    fontSize: 13,
    lineHeight: 18,
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  progressValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%' as any,
    borderRadius: 2,
  },
  progressSub: {
    fontSize: 10,
    fontWeight: '500',
  },
  dnaBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  dnaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  dnaTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  dnaGrid: {
    gap: 6,
  },
  dnaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dnaLabel: {
    fontSize: 10,
    fontWeight: '600',
    width: 72,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  dnaValue: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  shortcutsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  shortcutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
  },
  shortcutText: {
    fontSize: 12,
    fontWeight: '600',
  },
  expandBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  expandText: {
    fontSize: 12,
    fontWeight: '500',
  },
  detailsSection: {
    marginTop: 12,
  },
  enginesGrid: {
    gap: 6,
    marginBottom: 12,
  },
  engineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  engineName: {
    fontSize: 12,
    fontWeight: '600',
  },
  engineDetail: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  planSectionsBox: {
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 6,
  },
  sectionTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sectionTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginBottom: 12,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  askBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  askSection: {
    marginTop: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    fontSize: 13,
    paddingVertical: Platform.OS === 'web' ? 8 : 6,
  },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBox: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  answerText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
