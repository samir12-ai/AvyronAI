import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated as RNAnimated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useWatchtower, useActivityTimeline, useMonitoring } from '@/hooks/usePerception';

interface Props {
  campaignId: string;
  isDark: boolean;
}

interface Step {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  state: 'done' | 'active' | 'pending';
}

function buildSteps(
  competitorsWatched: number,
  competitorPosts7d: number,
  lastReviewAt: string | null,
  hasBossRun: boolean,
): Step[] {
  const scanDone = competitorsWatched > 0;
  const baselineDone = competitorPosts7d > 0 || hasBossRun;
  const reviewDone = !!lastReviewAt || hasBossRun;
  return [
    {
      key: 'scan',
      icon: 'scan-outline',
      title: 'Scanning competitors',
      detail: scanDone
        ? `Watching ${competitorsWatched} ${competitorsWatched === 1 ? 'competitor' : 'competitors'}`
        : 'Locating the right competitor profiles to watch',
      state: scanDone ? 'done' : 'active',
    },
    {
      key: 'baseline',
      icon: 'analytics-outline',
      title: 'Building baseline',
      detail: baselineDone
        ? competitorPosts7d > 0
          ? `${competitorPosts7d} competitor ${competitorPosts7d === 1 ? 'post' : 'posts'} analyzed`
          : 'Initial signals collected'
        : 'Reading recent posts, offers, and hooks',
      state: baselineDone ? 'done' : scanDone ? 'active' : 'pending',
    },
    {
      key: 'cycle',
      icon: 'sparkles-outline',
      title: 'Running first intelligence cycle',
      detail: reviewDone
        ? 'Your first strategic plan is ready'
        : 'Synthesizing your first plan from the evidence',
      state: reviewDone ? 'done' : baselineDone ? 'active' : 'pending',
    },
  ];
}

export default function InitializationExperience({ campaignId, isDark }: Props) {
  const { data: monitoring } = useMonitoring(campaignId);
  const { data: activity } = useActivityTimeline(campaignId, 168);
  const { data: watchtower } = useWatchtower(campaignId);

  const competitorsWatched = monitoring?.facts.competitorsWatched ?? 0;
  const competitorPosts7d = monitoring?.facts.competitorPostsAnalyzed7d ?? 0;
  const lastReviewAt = monitoring?.facts.lastReviewAt ?? null;
  const hasBossRun = (activity?.events ?? []).some(e => e.kind === 'boss_run');

  const steps = buildSteps(competitorsWatched, competitorPosts7d, lastReviewAt, hasBossRun);
  const activeIndex = steps.findIndex(s => s.state === 'active');

  const pulse = useRef(new RNAnimated.Value(0.4)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.4, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bg = isDark ? '#0F1419' : '#FFFFFF';
  const border = isDark ? '#1A2030' : '#E2E8E4';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const accent = '#8B5CF6';
  const success = '#10B981';
  const muted = isDark ? '#2A3340' : '#D6DCE0';

  const headline = watchtower?.lines.find(l => l.id === 'plan')?.line.headline
    ?? 'Setting up your intelligence';
  const detail = 'This usually takes a few minutes. You can keep using the app — we will let you know when your first plan is ready.';

  return (
    <View style={[styles.container, { backgroundColor: bg, borderColor: border }]} testID="initialization-experience">
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: accent + '20' }]}>
          <Ionicons name="rocket-outline" size={20} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: textPrimary }]} numberOfLines={1}>{headline}</Text>
          <Text style={[styles.subtitle, { color: textSec }]} numberOfLines={2}>{detail}</Text>
        </View>
      </View>

      <View style={styles.steps}>
        {steps.map((step, idx) => {
          const isActive = step.state === 'active';
          const isDone = step.state === 'done';
          const dotColor = isDone ? success : isActive ? accent : muted;
          return (
            <View key={step.key} style={styles.stepRow}>
              <View style={styles.stepGutter}>
                {isActive ? (
                  <RNAnimated.View style={[styles.activeDot, { backgroundColor: accent + '40', opacity: pulse }]} />
                ) : null}
                <View style={[styles.dot, { backgroundColor: dotColor }]}>
                  {isDone ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                </View>
                {idx < steps.length - 1 ? (
                  <View style={[styles.connector, { backgroundColor: isDone ? success : muted }]} />
                ) : null}
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepTitle, { color: isActive || isDone ? textPrimary : textSec }]}>
                  {step.title}
                </Text>
                <Text style={[styles.stepDetail, { color: textSec }]} numberOfLines={2}>{step.detail}</Text>
              </View>
              <Ionicons
                name={isDone ? 'checkmark-circle' : isActive ? 'sync' : 'ellipse-outline'}
                size={16}
                color={dotColor}
              />
            </View>
          );
        })}
      </View>

      {activeIndex >= 0 ? (
        <Text style={[styles.footer, { color: textSec }]}>
          {steps[activeIndex].title} — working on it now
        </Text>
      ) : (
        <Text style={[styles.footer, { color: success }]}>Initialization complete</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16 },
  steps: { gap: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  stepGutter: { width: 18, alignItems: 'center', paddingTop: 2 },
  dot: {
    width: 14, height: 14, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  activeDot: {
    position: 'absolute',
    width: 26, height: 26, borderRadius: 13,
    top: -4,
  },
  connector: { width: 2, flex: 1, minHeight: 18, marginTop: 2 },
  stepBody: { flex: 1, paddingBottom: 10 },
  stepTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  stepDetail: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 14 },
  footer: {
    fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 12,
    textAlign: 'center', letterSpacing: 0.3,
  },
});
