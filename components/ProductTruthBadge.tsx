import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  PRODUCT_TRUTH_LABELS,
  type ProductTruthStatus,
  type ProductTruthLabel,
} from '../shared/contracts/product-truth-classification';

interface Props {
  status?: ProductTruthStatus | 'SUPPORTED' | 'PROPOSED' | 'VERIFIED' | 'UNCERTAIN' | 'UNVERIFIED' | 'UNKNOWN' | string | null;
  label?: ProductTruthLabel | string | null;
  claimText?: string | null;
  compact?: boolean;
  showUnknown?: boolean;
  style?: any;
  testID?: string;
}

/**
 * ProductTruthBadge
 *
 * Displays a quiet, readable indicator showing whether a strategic claim
 * is directly supported by established Product Truth facts, proposed/strategic
 * emphasis requiring verification, or not yet evaluated.
 * Never defaults missing/unknown status to SUPPORTED.
 */
export function ProductTruthBadge({
  status,
  label,
  claimText,
  compact = false,
  showUnknown = false,
  style,
  testID = 'product-truth-badge',
}: Props) {
  const normStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const normLabel = typeof label === 'string' ? label.trim() : '';
  const lowerLabel = normLabel.toLowerCase();
  const lowerClaim = typeof claimText === 'string' ? claimText.toLowerCase() : '';

  let resolvedStatus: 'SUPPORTED' | 'PROPOSED' | 'UNKNOWN' | null = null;

  if (
    normStatus === 'PROPOSED' ||
    normStatus === 'UNCERTAIN' ||
    normStatus === 'UNVERIFIED' ||
    normStatus === 'STRATEGIC_HYPOTHESIS' ||
    normStatus === 'SHARED_CAPABILITY_STRATEGIC_EMPHASIS' ||
    normStatus === 'COMPETITIVE_COMPARISON_UNAVAILABLE' ||
    normStatus === 'PARTIALLY_MITIGATED' ||
    normStatus === 'UNRESOLVED'
  ) {
    resolvedStatus = 'PROPOSED';
  } else if (normStatus === 'SUPPORTED' || normStatus === 'VERIFIED' || normStatus === 'VERIFIED_DIFFERENTIATOR') {
    resolvedStatus = 'SUPPORTED';
  } else if (normStatus === 'UNKNOWN' || normStatus === 'NOT_EVALUATED') {
    resolvedStatus = 'UNKNOWN';
  } else if (normLabel) {
    if (
      lowerLabel.includes('proposed') ||
      lowerLabel.includes('hypothesis') ||
      lowerLabel.includes('emphasis') ||
      lowerLabel.includes('unavailable') ||
      lowerLabel.includes('uncertain') ||
      lowerLabel.includes('unverified') ||
      lowerLabel.includes('requires')
    ) {
      resolvedStatus = 'PROPOSED';
    } else if (lowerLabel.includes('supported') || lowerLabel.includes('verified')) {
      resolvedStatus = 'SUPPORTED';
    } else {
      resolvedStatus = 'UNKNOWN';
    }
  } else if (lowerClaim.includes('proposed') || lowerClaim.includes('subject to verifying')) {
    resolvedStatus = 'PROPOSED';
  } else if (showUnknown) {
    resolvedStatus = 'UNKNOWN';
  }

  if (!resolvedStatus) return null;
  if (resolvedStatus === 'UNKNOWN' && !normLabel && !showUnknown) return null;

  if (resolvedStatus === 'UNKNOWN') {
    const unknownLabel = normLabel || 'Truth Status Not Evaluated';
    return (
      <View
        testID={testID}
        style={[
          styles.badgeBase,
          styles.unknownBadge,
          compact && styles.compactBadge,
          style,
        ]}
      >
        <Feather
          name="help-circle"
          size={compact ? 11 : 12}
          color="#94A3B8"
          style={styles.icon}
        />
        <Text
          style={[
            styles.textBase,
            styles.unknownText,
            compact && styles.compactText,
          ]}
          numberOfLines={1}
        >
          {unknownLabel}
        </Text>
      </View>
    );
  }

  const isProposed = resolvedStatus === 'PROPOSED';
  const defaultProposedLabel =
    normStatus === 'SHARED_CAPABILITY_STRATEGIC_EMPHASIS'
      ? 'Shared Capability · Strategic Market Emphasis'
      : normStatus === 'COMPETITIVE_COMPARISON_UNAVAILABLE'
        ? 'Competitive Comparison Unavailable · Strategic Emphasis'
        : normStatus === 'STRATEGIC_HYPOTHESIS'
          ? 'Strategic Hypothesis — Grounded in Market Evidence'
          : PRODUCT_TRUTH_LABELS.PROPOSED;
  const displayLabel = normLabel || (isProposed ? defaultProposedLabel : PRODUCT_TRUTH_LABELS.SUPPORTED);

  if (isProposed) {
    return (
      <View
        testID={testID}
        style={[
          styles.badgeBase,
          styles.proposedBadge,
          compact && styles.compactBadge,
          style,
        ]}
      >
        <Feather
          name="compass"
          size={compact ? 11 : 12}
          color="#D97706"
          style={styles.icon}
        />
        <Text
          style={[
            styles.textBase,
            styles.proposedText,
            compact && styles.compactText,
          ]}
          numberOfLines={1}
        >
          {displayLabel}
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.badgeBase,
        styles.supportedBadge,
        compact && styles.compactBadge,
        style,
      ]}
    >
      <Feather
        name="check-circle"
        size={compact ? 11 : 12}
        color="#10B981"
        style={styles.icon}
      />
      <Text
        style={[
          styles.textBase,
          styles.supportedText,
          compact && styles.compactText,
        ]}
        numberOfLines={1}
      >
        {displayLabel}
      </Text>
    </View>
  );
}

export default ProductTruthBadge;

const styles = StyleSheet.create({
  badgeBase: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  compactBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginVertical: 2,
  },
  icon: {
    marginRight: 5,
  },
  textBase: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  compactText: {
    fontSize: 10,
  },
  supportedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  supportedText: {
    color: '#10B981',
  },
  proposedBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  proposedText: {
    color: '#D97706',
  },
  unknownBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  unknownText: {
    color: '#94A3B8',
  },
});
