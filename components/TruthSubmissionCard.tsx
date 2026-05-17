import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/query-client';
import { useBlockedReasons } from '@/hooks/usePerception';

interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
  forceOpen?: boolean;             // parent override (e.g. user clicked the action item)
  onSubmitted?: () => void;
  onClose?: () => void;            // parent override to collapse after submit
}

// Lifecycle C-package — the only user-input lane that gates weekly review.
// 4 integer fields, server-derived window, no client-side window picker.
// Auto-shows when the open eval window is within 36h of close AND no truth
// submitted, OR when the parent passes forceOpen=true.
const SOON_THRESHOLD_MS = 36 * 60 * 60 * 1000;

export default function TruthSubmissionCard({ campaignId, isDark = true, forceOpen, onSubmitted, onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: blockedReasons } = useBlockedReasons(campaignId);
  const truthDue = blockedReasons?.truthDue ?? null;

  const [totalLeads, setTotalLeads] = useState('');
  const [qualifiedLeads, setQualifiedLeads] = useState('');
  const [bookedCalls, setBookedCalls] = useState('');
  // paidActive is a BOOLEAN per shared/schema.ts:3081 ("did the customer
  // convert to paying status during this window"). Modeled as a Yes/No
  // toggle to match the wire contract — sending a number throws
  // INVALID_FIELD at acceptUserTruth.
  const [paidActive, setPaidActive] = useState<boolean>(false);
  const [expanded, setExpanded] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      // Customer-grade endpoint (under requireCampaign auth, not admin).
      // Server re-derives the window — client never sends windowId.
      return apiRequest('POST', '/api/perception/user-truth', {
        totalLeads: Number(totalLeads),
        qualifiedLeads: Number(qualifiedLeads),
        bookedCalls: Number(bookedCalls),
        paidActive,
      });
    },
    onSuccess: () => {
      Alert.alert('Submitted', "Thanks — I'll use these numbers in the next review.");
      setTotalLeads(''); setQualifiedLeads(''); setBookedCalls(''); setPaidActive(false);
      setExpanded(false);
      onClose?.();
      // Invalidate everything that depends on user_truth state.
      queryClient.invalidateQueries({ queryKey: ['/api/perception/blocked-reasons', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['/api/perception/watchtower', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['/api/perception/activity', campaignId] });
      onSubmitted?.();
    },
    onError: (err: any) => {
      // Server-side validation surfaces in err.message — pass through.
      const msg = err?.message ?? 'Could not submit. Try again in a moment.';
      Alert.alert('Submission failed', msg);
    },
  });

  const now = Date.now();
  const endsAtMs = truthDue ? new Date(truthDue.windowEndsAt).getTime() : 0;
  const soonOrLate = truthDue && (truthDue.isLate || endsAtMs - now <= SOON_THRESHOLD_MS);
  const shouldShow = forceOpen || soonOrLate;
  if (!shouldShow || !truthDue) return null;

  // Required-field check (the 3 integer counts; paidActive is a boolean toggle).
  const integerFields = [totalLeads, qualifiedLeads, bookedCalls];
  const allFilled = integerFields.every((s) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 && Number.isInteger(Number(s)));
  const inFunnelOrder = allFilled
    && Number(qualifiedLeads) <= Number(totalLeads)
    && Number(bookedCalls) <= Number(qualifiedLeads);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const accent = truthDue.isLate ? '#FFB347' : '#4C9AFF';
  const inputBg = isDark ? '#1A2030' : '#F4F6F8';
  const inputBorder = isDark ? '#262E40' : '#D8DDE3';

  const open = expanded || forceOpen;

  const dueLabel = truthDue.isLate
    ? `Past due — closed ${formatRelative(truthDue.windowEndsAt)}`
    : `Closes ${formatRelative(truthDue.windowEndsAt)}`;

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconWrap, { backgroundColor: accent + '22' }]}>
            <Feather name="edit-3" size={14} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: textPrimary }]}>Weekly numbers</Text>
            <Text style={[styles.subtitle, { color: textSec }]}>{dueLabel}</Text>
          </View>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={textSec} />
      </Pressable>

      {open ? (
        <View style={styles.form}>
          <FieldRow label="New leads" value={totalLeads} onChange={setTotalLeads} isDark={isDark} inputBg={inputBg} inputBorder={inputBorder} textPrimary={textPrimary} textSec={textSec} />
          <FieldRow label="Qualified" value={qualifiedLeads} onChange={setQualifiedLeads} isDark={isDark} inputBg={inputBg} inputBorder={inputBorder} textPrimary={textPrimary} textSec={textSec} />
          <FieldRow label="Calls booked" value={bookedCalls} onChange={setBookedCalls} isDark={isDark} inputBg={inputBg} inputBorder={inputBorder} textPrimary={textPrimary} textSec={textSec} />

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: textSec }]}>Paying customer active?</Text>
            <Switch
              value={paidActive}
              onValueChange={setPaidActive}
              trackColor={{ false: inputBorder, true: accent }}
              thumbColor="#FFFFFF"
            />
          </View>

          {allFilled && !inFunnelOrder ? (
            <Text style={[styles.warnText, { color: '#FFB347' }]}>
              Each step should be ≤ the one above (qualified ≤ leads, booked ≤ qualified).
            </Text>
          ) : null}

          <Pressable
            onPress={() => mutation.mutate()}
            disabled={!allFilled || !inFunnelOrder || mutation.isPending}
            style={[
              styles.submitBtn,
              { backgroundColor: accent + (allFilled && inFunnelOrder ? 'FF' : '55') },
            ]}
          >
            {mutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Submit numbers</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FieldRow({
  label, value, onChange, isDark, inputBg, inputBorder, textPrimary, textSec,
}: {
  label: string; value: string; onChange: (s: string) => void;
  isDark: boolean; inputBg: string; inputBorder: string; textPrimary: string; textSec: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: textSec }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={isDark ? '#5A6478' : '#A4ACB8'}
        style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary }]}
      />
    </View>
  );
}

function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const h = Math.floor(abs / 3_600_000);
  if (h < 1) return past ? 'just now' : 'in <1h';
  if (h < 48) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 2 },
  form: { marginTop: 14, gap: 10 },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '500', flex: 1 },
  input: { width: 100, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, textAlign: 'right' },
  warnText: { fontSize: 11, marginTop: 2 },
  submitBtn: { marginTop: 6, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },
});
