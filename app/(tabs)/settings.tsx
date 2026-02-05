import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  TextInput,
  Pressable,
  Alert,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { PlatformPicker } from '@/components/PlatformPicker';
import { PlatformConnection } from '@/components/PlatformConnection';

const toneOptions = ['Professional', 'Casual', 'Friendly', 'Authoritative', 'Playful', 'Inspirational'];

const platformIcons: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  instagram: { icon: 'logo-instagram', color: '#E1306C' },
  facebook: { icon: 'logo-facebook', color: '#1877F2' },
  twitter: { icon: 'logo-twitter', color: '#1DA1F2' },
  linkedin: { icon: 'logo-linkedin', color: '#0A66C2' },
  tiktok: { icon: 'musical-notes', color: '#000000' },
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { 
    brandProfile, 
    setBrandProfile, 
    platformConnections, 
    updatePlatformConnection,
    postingSchedules,
    updatePostingSchedule,
  } = useApp();

  const [name, setName] = useState(brandProfile.name);
  const [industry, setIndustry] = useState(brandProfile.industry);
  const [tone, setTone] = useState(brandProfile.tone);
  const [targetAudience, setTargetAudience] = useState(brandProfile.targetAudience);
  const [platforms, setPlatforms] = useState<string[]>(brandProfile.platforms);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setName(brandProfile.name);
    setIndustry(brandProfile.industry);
    setTone(brandProfile.tone);
    setTargetAudience(brandProfile.targetAudience);
    setPlatforms(brandProfile.platforms);
  }, [brandProfile]);

  useEffect(() => {
    const changed = 
      name !== brandProfile.name ||
      industry !== brandProfile.industry ||
      tone !== brandProfile.tone ||
      targetAudience !== brandProfile.targetAudience ||
      JSON.stringify(platforms) !== JSON.stringify(brandProfile.platforms);
    setHasChanges(changed);
  }, [name, industry, tone, targetAudience, platforms, brandProfile]);

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setBrandProfile({
      name,
      industry,
      tone,
      targetAudience,
      platforms,
    });
    setHasChanges(false);
    Alert.alert('Saved', 'Your brand profile has been updated.');
  };

  const handleConnect = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updatePlatformConnection(id, true);
  };

  const handleDisconnect = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updatePlatformConnection(id, false);
  };

  const handleScheduleToggle = (platform: string, enabled: boolean) => {
    const schedule = postingSchedules.find(s => s.platform === platform);
    if (schedule) {
      updatePostingSchedule({ ...schedule, enabled });
    }
  };

  const connectedCount = platformConnections.filter(p => p.isConnected).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Configure your brand and platform connections
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="link" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Connected Platforms</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{connectedCount} active</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Connect your social media accounts to enable auto-publishing
          </Text>
          <View style={styles.connectionsList}>
            {platformConnections.map(connection => {
              const style = platformIcons[connection.id] || { icon: 'globe' as const, color: colors.primary };
              return (
                <PlatformConnection
                  key={connection.id}
                  name={connection.name}
                  icon={style.icon}
                  color={style.color}
                  isConnected={connection.isConnected}
                  onConnect={() => handleConnect(connection.id)}
                  onDisconnect={() => handleDisconnect(connection.id)}
                />
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="time" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Auto-Publish Schedule</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Enable automatic posting at optimal times
          </Text>
          <View style={styles.scheduleList}>
            {postingSchedules.map(schedule => {
              const connection = platformConnections.find(c => c.name === schedule.platform);
              const isConnected = connection?.isConnected || false;
              return (
                <View 
                  key={schedule.platform}
                  style={[styles.scheduleItem, { backgroundColor: colors.inputBackground }]}
                >
                  <View style={styles.scheduleLeft}>
                    <Text style={[styles.schedulePlatform, { color: colors.text }]}>{schedule.platform}</Text>
                    <Text style={[styles.scheduleInfo, { color: colors.textMuted }]}>
                      {schedule.times.join(', ')} on {schedule.days.join(', ')}
                    </Text>
                  </View>
                  <Switch
                    value={schedule.enabled && isConnected}
                    onValueChange={(value) => handleScheduleToggle(schedule.platform, value)}
                    disabled={!isConnected}
                    trackColor={{ false: colors.inputBorder, true: colors.primary + '50' }}
                    thumbColor={schedule.enabled && isConnected ? colors.primary : colors.textMuted}
                  />
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="business" size={20} color={colors.accentOrange} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Brand Profile</Text>
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>Brand Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder="Your company or brand name"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>Industry</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder="e.g., E-commerce, SaaS, Restaurant..."
              placeholderTextColor={colors.textMuted}
              value={industry}
              onChangeText={setIndustry}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>Target Audience</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder="e.g., Young professionals, small businesses..."
              placeholderTextColor={colors.textMuted}
              value={targetAudience}
              onChangeText={setTargetAudience}
              multiline
              numberOfLines={2}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Brand Voice</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Select the tone for your content
          </Text>
          <View style={styles.toneGrid}>
            {toneOptions.map(option => (
              <Pressable
                key={option}
                onPress={() => {
                  Haptics.selectionAsync();
                  setTone(option);
                }}
                style={[
                  styles.toneButton,
                  { 
                    backgroundColor: tone === option ? colors.primary + '20' : colors.inputBackground,
                    borderColor: tone === option ? colors.primary : 'transparent',
                  }
                ]}
              >
                <Text style={[
                  styles.toneLabel,
                  { color: tone === option ? colors.primary : colors.textMuted }
                ]}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {hasChanges && (
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, { opacity: pressed ? 0.8 : 1 }]}
          >
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </LinearGradient>
          </Pressable>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
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
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 24,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  cardSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  connectionsList: {
    gap: 12,
  },
  scheduleList: {
    gap: 10,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
  },
  scheduleLeft: {
    flex: 1,
    gap: 2,
  },
  schedulePlatform: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scheduleInfo: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  toneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toneButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  toneLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 24,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
