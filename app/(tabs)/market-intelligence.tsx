import React from 'react';
import { View, StyleSheet, Text, ScrollView } from 'react-native';
import CompetitiveIntelligence from '@/components/CompetitiveIntelligence';
import { CampaignBar } from '@/components/CampaignSelector';
import Colors from '@/constants/colors';
import { GlobalHeader } from '@/components/GlobalHeader';

export default function MarketIntelligenceScreen() {
  return (
    <View style={styles.container}>
      <GlobalHeader title="MARKET INTELLIGENCE" />
      
      <ScrollView style={styles.content}>
        <CampaignBar />
        <View style={styles.intelligenceWrapper}>
          <CompetitiveIntelligence />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F13',
  },
  content: {
    flex: 1,
  },
  intelligenceWrapper: {
    marginTop: 16,
  }
});
