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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { PlatformPicker } from '@/components/PlatformPicker';

const toneOptions = ['Professional', 'Casual', 'Friendly', 'Authoritative', 'Playful', 'Inspirational'];

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { brandProfile, setBrandProfile } = useApp();

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
        <Text style={[styles.title, { color: colors.text }]}>Brand Settings</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Configure your brand profile for AI-powered content
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
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

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Active Platforms</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Select the platforms you want to manage
          </Text>
          <PlatformPicker selected={platforms} onChange={setPlatforms} />
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

        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>AI-Powered Marketing</Text>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Your brand settings help the AI create more personalized and on-brand content for your marketing campaigns.
            </Text>
          </View>
        </View>

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
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
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
  infoCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});
