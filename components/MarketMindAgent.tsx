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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getApiUrl } from '@/lib/query-client';

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

type GoalDecomp = {
  goalLabel: string;
  goalType: string;
  goalTarget: number;
  timeHorizonDays: number;
  feasibility: string;
  feasibilityScore: number;
  confidenceScore: number;
};

type SimulationSummary = {
  confidenceScore: number;
  bottleneckAlerts: string[];
};

type TaskSummary = {
  total: number;
  pending: number;
  completed: number;
  blocked: number;
};

type AssumptionSummary = {
  total: number;
  highImpact: number;
  lowConfidence: number;
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
  goalDecomposition: GoalDecomp | null;
  simulation: SimulationSummary | null;
  executionTasksSummary: TaskSummary | null;
  assumptionsSummary: AssumptionSummary | null;
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
  const [askQuestion, setAskQuestion] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const pulseAnim = useRef(new RNAnimated.Value(0.4)).current;

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
        <View style={[st.dnaCard, { backgroundColor: isDark ? '#0F1419' : '#F8F7FF', borderColor: isDark ? '#2D2654' : '#E0D9F6' }]}>
          <View style={st.dnaHeader}>
            <Ionicons name="link-outline" size={14} color={P.purple} />
            <Text style={[st.dnaTitle, { color: textPrimary }]}>Content DNA</Text>
          </View>
          {[
            { label: 'CTA', value: brief.contentDnaSnapshot.ctaType },
            { label: 'HOOKS', value: brief.contentDnaSnapshot.hookStyle },
            { label: 'HOOK\nLENGTH', value: brief.contentDnaSnapshot.hookDuration },
            { label: 'NARRATIVE', value: brief.contentDnaSnapshot.narrativeStyle },
            { label: 'ANGLE', value: brief.contentDnaSnapshot.contentAngle },
            { label: 'TONE', value: brief.contentDnaSnapshot.toneStyle },
            { label: 'FORMAT', value: brief.contentDnaSnapshot.formatPriority },
          ].filter(d => d.value).map((d, i) => (
            <View key={i} style={st.dnaRow}>
              <Text style={[st.dnaRowLabel, { color: textMuted }]}>{d.label}</Text>
              <Text style={[st.dnaRowValue, { color: textPrimary }]}>{d.value}</Text>
            </View>
          ))}
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
  dnaCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  dnaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  dnaTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  dnaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
  },
  dnaRowLabel: {
    width: 80,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dnaRowValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
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
