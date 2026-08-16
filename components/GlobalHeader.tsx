import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface GlobalHeaderProps {
  title?: string;
  rightElement?: React.ReactNode;
}

export function GlobalHeader({ title, rightElement }: GlobalHeaderProps) {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={styles.brandRow}>
        <Text style={styles.brandName}>
          AVYRON <Text style={styles.brandSub}>AI</Text>
        </Text>
        {title && <Text style={styles.title}>{title}</Text>}
      </View>
      {rightElement && <View style={styles.rightSection}>{rightElement}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0F0F13',
    paddingHorizontal: 24,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2535',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandSub: {
    color: '#8B5CF6',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#374151',
    textTransform: 'uppercase',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
