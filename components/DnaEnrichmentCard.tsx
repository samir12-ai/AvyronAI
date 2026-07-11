import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useDnaEnrichment, type DnaEnrichmentPendingItem } from '@/hooks/usePerception';

interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
}

// Plain-English label for each engine — the customer surface MUST NOT expose the
// canonical engine tag (positioning_claim / offer) directly.
function engineLabel(kind: DnaEnrichmentPendingItem['engineKind']): string {
  switch (kind) {
    case 'positioning_claim':
      return 'Positioning';
    case 'offer':
      return 'Offer';
  }
}

const ACCENT = '#FFB347';

function EnrichmentRow({
  item,
  campaignId,
  isDark,
  onResolved,
}: {
  item: DnaEnrichmentPendingItem;
  campaignId: string;
  isDark: boolean;
  onResolved: () => void;
}) {
  const [value, setValue] = useState(item.candidateDifferentiator ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const inputBg = isDark ? '#0B0F14' : '#F4F7F5';
  const inputBorder = isDark ? '#232B3A' : '#D5DEDA';

  const refs = (item.groundingRefs ?? []).filter((r) => r && r.trim().length > 0);
  const canSubmit = value.trim().length > 0 && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('POST', '/api/dna-enrichment/resolve', {
        campaignId,
        engineKind: item.engineKind,
        differentiatingFeature: value.trim(),
      });
      onResolved();
    } catch (e: any) {
      // Loud, visible failure — no silent catch. Surface a short message.
      const msg = typeof e?.message === 'string' ? e.message : 'Could not save. Try again.';
      setError(msg.length > 160 ? msg.slice(0, 157) + '…' : msg);
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.row, { borderColor: inputBorder }]}>
      <View style={styles.rowHeader}>
        <View style={[styles.badge, { backgroundColor: ACCENT + '22' }]}>
          <Text style={[styles.badgeText, { color: ACCENT }]}>{engineLabel(item.engineKind)}</Text>
        </View>
      </View>

      <Text style={[styles.prompt, { color: textPrimary }]}>
        {item.suggestionText && item.suggestionText.trim().length > 0
          ? item.suggestionText
          : 'What makes this product genuinely different from competitors? Add one specific, provable difference so your strategy stops reading as generic.'}
      </Text>

      {refs.length > 0 ? (
        <View style={styles.refsRow}>
          <Feather name="link" size={11} color={textSec} />
          <Text style={[styles.refsText, { color: textSec }]}>Grounded in your evidence: {refs.join(', ')}</Text>
        </View>
      ) : null}

      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary }]}
        value={value}
        onChangeText={(t) => {
          setValue(t);
          if (error) setError(null);
        }}
        placeholder="One specific, provable differentiator"
        placeholderTextColor={textSec}
        multiline
        editable={!submitting}
        testID={`dna-enrichment-input-${item.engineKind}`}
      />

      {error ? (
        <View style={styles.errorRow}>
          <Feather name="alert-triangle" size={12} color="#FF6B6B" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={handleConfirm}
        disabled={!canSubmit}
        style={[styles.button, { backgroundColor: canSubmit ? ACCENT : ACCENT + '55' }]}
        testID={`dna-enrichment-confirm-${item.engineKind}`}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#1A2332" />
        ) : (
          <Text style={styles.buttonText}>Confirm differentiator</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function DnaEnrichmentCard({ campaignId, isDark = true }: Props) {
  const { data, isLoading } = useDnaEnrichment(campaignId);
  const queryClient = useQueryClient();

  // Hide entirely when there is nothing to ask — keeps the dashboard clean.
  if (isLoading) return null;
  if (!data || data.requests.length === 0) return null;
  if (!campaignId) return null;

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textSec = isDark ? '#8892A4' : '#546478';

  const onResolved = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/dna-enrichment/pending', campaignId] });
  };

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="zap" size={14} color={ACCENT} />
          <Text style={[styles.title, { color: textSec }]}>SHARPEN YOUR EDGE</Text>
        </View>
        <Text style={[styles.subtitle, { color: textSec }]}>
          {data.requests.length === 1 ? '1 to confirm' : `${data.requests.length} to confirm`}
        </Text>
      </View>
      <Text style={[styles.intro, { color: textSec }]}>
        Your strategy is reading as generic because we don&apos;t yet have a proprietary differentiator on file. Confirm one below and the
        engine will rebuild a sharper strategy on the next run.
      </Text>
      <View style={styles.stack}>
        {data.requests.map((item) => (
          <EnrichmentRow
            key={item.engineKind}
            item={item}
            campaignId={campaignId}
            isDark={isDark}
            onResolved={onResolved}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  subtitle: { fontSize: 11, fontWeight: '500' },
  intro: { fontSize: 12, lineHeight: 17, marginBottom: 12 },
  stack: { gap: 12 },
  row: { borderRadius: 10, borderWidth: 1, padding: 12 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  prompt: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  refsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  refsText: { fontSize: 11, lineHeight: 15, flex: 1 },
  input: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 10, fontSize: 13, marginTop: 10, minHeight: 64, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  errorText: { fontSize: 11, color: '#FF6B6B', flex: 1, lineHeight: 15 },
  button: { borderRadius: 8, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonText: { fontSize: 13, fontWeight: '700', color: '#1A2332', letterSpacing: 0.3 },
});
