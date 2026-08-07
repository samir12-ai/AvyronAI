import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AdaptiveFlowState } from '@/types/watchtower';

interface Props {
  flow: AdaptiveFlowState;
}

export default function AdaptiveIntelligenceFlow({ flow }: Props) {
  const getWatchtowerMeta = () => {
    switch (flow.watchtowerState) {
      case 'confirmed': return { text: 'Change confirmed', color: '#059669', icon: 'check-circle' };
      case 'detected': return { text: 'Shift detected', color: '#D97706', icon: 'zap' };
      default: return { text: 'Scanning market...', color: '#9CA3AF', icon: 'search' };
    }
  };

  const getStrategyMeta = () => {
    switch (flow.strategyState) {
      case 'updated': return { text: 'Updated', color: '#059669', icon: 'check-circle' };
      case 'refresh_available': return { text: 'Refresh available', color: '#3B82F6', icon: 'refresh-cw' };
      default: return { text: 'Up to date', color: '#9CA3AF', icon: 'check' };
    }
  };

  const getTasksMeta = () => {
    switch (flow.tasksState) {
      case 'task_created': return { text: 'Task created', color: '#059669', icon: 'plus-circle' };
      default: return { text: 'No task required', color: '#9CA3AF', icon: 'check' };
    }
  };

  const getDashboardMeta = () => {
    switch (flow.dashboardState) {
      case 'updated': return { text: 'Updated automatically', color: '#059669', icon: 'refresh-cw' };
      default: return { text: 'Pending', color: '#9CA3AF', icon: 'clock' };
    }
  };

  const watchtowerMeta = getWatchtowerMeta();
  const strategyMeta = getStrategyMeta();
  const tasksMeta = getTasksMeta();
  const dashboardMeta = getDashboardMeta();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adaptive Intelligence</Text>
      <Text style={styles.subtitle}>How Avyron continuously routes market changes into execution</Text>

      <View style={styles.flowContainer}>
        {/* Watchtower Node */}
        <View style={styles.node}>
          <View style={styles.iconContainer}>
            <Feather name="eye" size={24} color="#F9FAFB" />
          </View>
          <Text style={styles.nodeTitle}>Watchtower</Text>
          <View style={styles.metaRow}>
            <Feather name={watchtowerMeta.icon as any} size={14} color={watchtowerMeta.color} />
            <Text style={[styles.nodeMeta, { color: watchtowerMeta.color }]}>{watchtowerMeta.text}</Text>
          </View>
        </View>

        <View style={styles.connector} />

        {/* Strategy Node */}
        <View style={styles.node}>
          <View style={styles.iconContainer}>
            <Feather name="map" size={24} color="#F9FAFB" />
          </View>
          <Text style={styles.nodeTitle}>Strategy Plan</Text>
          <View style={styles.metaRow}>
            <Feather name={strategyMeta.icon as any} size={14} color={strategyMeta.color} />
            <Text style={[styles.nodeMeta, { color: strategyMeta.color }]}>{strategyMeta.text}</Text>
          </View>
        </View>

        <View style={styles.connector} />

        {/* Tasks Node */}
        <View style={styles.node}>
          <View style={styles.iconContainer}>
            <Feather name="check-square" size={24} color="#F9FAFB" />
          </View>
          <Text style={styles.nodeTitle}>What To Do Today</Text>
          <View style={styles.metaRow}>
            <Feather name={tasksMeta.icon as any} size={14} color={tasksMeta.color} />
            <Text style={[styles.nodeMeta, { color: tasksMeta.color }]}>{tasksMeta.text}</Text>
          </View>
        </View>

        <View style={styles.connector} />

        {/* Dashboard Node */}
        <View style={styles.node}>
          <View style={styles.iconContainer}>
            <Feather name="layout" size={24} color="#F9FAFB" />
          </View>
          <Text style={styles.nodeTitle}>Dashboard</Text>
          <View style={styles.metaRow}>
            <Feather name={dashboardMeta.icon as any} size={14} color={dashboardMeta.color} />
            <Text style={[styles.nodeMeta, { color: dashboardMeta.color }]}>{dashboardMeta.text}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E2535',
    borderRadius: 16,
    padding: 32,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#374151',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 32,
  },
  flowContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  node: {
    alignItems: 'center',
    width: 140,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2D3748',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  nodeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E7EB',
    marginBottom: 8,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  nodeMeta: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: '#374151',
    marginTop: 32,
    marginHorizontal: -20,
    zIndex: -1,
  },
});
