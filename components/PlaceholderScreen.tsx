import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShellTheme } from '@/constants/ShellTheme';
import { Feather } from '@expo/vector-icons';

export default function PlaceholderScreen({ title }: { title?: string }) {
  return (
    <View style={styles.container}>
      <Feather name="layout" size={48} color={ShellTheme.colors.textDeepMuted} style={styles.icon} />
      <Text style={styles.title}>{title || 'Section design pending'}</Text>
      <Text style={styles.subtitle}>This section is scheduled for the next design phase.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ShellTheme.colors.appBackground,
    justifyContent: 'center',
    alignItems: 'center',
    padding: ShellTheme.spacing.loose,
  },
  icon: {
    marginBottom: ShellTheme.spacing.standard,
  },
  title: {
    ...ShellTheme.typography.h2,
    marginBottom: ShellTheme.spacing.base,
  },
  subtitle: {
    ...ShellTheme.typography.body,
    color: ShellTheme.colors.textMuted,
  }
});
