import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  Pressable,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { CampaignCard } from '@/components/CampaignCard';
import { PlatformPicker } from '@/components/PlatformPicker';
import { generateId } from '@/lib/storage';
import type { Campaign } from '@/lib/types';

export default function CampaignsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { campaigns, addCampaign, updateCampaign, removeCampaign } = useApp();

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [platform, setPlatform] = useState<string[]>(['Meta Ads']);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter a campaign name.');
      return;
    }
    if (!budget.trim() || isNaN(Number(budget))) {
      Alert.alert('Invalid Budget', 'Please enter a valid budget amount.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newCampaign: Campaign = {
      id: generateId(),
      name: name.trim(),
      status: 'draft',
      budget: Number(budget),
      spent: 0,
      platform: platform[0],
      startDate: new Date().toISOString(),
      reach: 0,
      engagement: 0,
      conversions: 0,
    };

    await addCampaign(newCampaign);
    setShowModal(false);
    setName('');
    setBudget('');
    setPlatform(['Meta Ads']);
  };

  const handleToggle = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 
                      campaign.status === 'paused' ? 'active' : 
                      campaign.status === 'draft' ? 'active' : campaign.status;
    
    await updateCampaign({
      ...campaign,
      status: newStatus,
      reach: campaign.reach || Math.floor(Math.random() * 5000) + 1000,
      engagement: campaign.engagement || Math.floor(Math.random() * 500) + 100,
      conversions: campaign.conversions || Math.floor(Math.random() * 50) + 10,
      spent: campaign.spent || Math.floor(campaign.budget * 0.3),
    });
  };

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const otherCampaigns = campaigns.filter(c => c.status !== 'active');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Campaigns</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Manage your ad campaigns
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowModal(true);
            }}
          >
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              style={styles.addButton}
            >
              <Ionicons name="add" size={24} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>

        {activeCampaigns.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Active Campaigns</Text>
            <View style={styles.campaignList}>
              {activeCampaigns.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onPress={() => {}}
                  onToggle={() => handleToggle(campaign)}
                />
              ))}
            </View>
          </View>
        )}

        {otherCampaigns.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {activeCampaigns.length > 0 ? 'Other Campaigns' : 'All Campaigns'}
            </Text>
            <View style={styles.campaignList}>
              {otherCampaigns.map(campaign => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  onPress={() => {}}
                  onToggle={() => handleToggle(campaign)}
                />
              ))}
            </View>
          </View>
        )}

        {campaigns.length === 0 && (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="megaphone-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No campaigns yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              Create your first campaign to start advertising
            </Text>
            <Pressable
              onPress={() => setShowModal(true)}
              style={({ pressed }) => [
                styles.emptyButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.emptyButtonText}>Create Campaign</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>New Campaign</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Campaign Name</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., Summer Sale 2025"
                  placeholderTextColor={colors.textMuted}
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Budget ($)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., 1000"
                  placeholderTextColor={colors.textMuted}
                  value={budget}
                  onChangeText={setBudget}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Platform</Text>
                <PlatformPicker selected={platform} onChange={setPlatform} single />
              </View>
            </View>

            <Pressable
              onPress={handleCreate}
              style={({ pressed }) => [styles.createButton, { opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Text style={styles.createButtonText}>Create Campaign</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  campaignList: {
    gap: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    marginTop: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  emptyButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
  },
  modalBody: {
    gap: 20,
    marginBottom: 24,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  createButton: {},
  gradientButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
