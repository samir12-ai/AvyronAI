import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import BusinessDataForm from '@/components/BusinessDataForm';

interface BusinessProfileProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

export function BusinessProfileModal({ visible, onClose, onComplete }: BusinessProfileProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <View style={[s.header, { 
          paddingTop: Platform.OS === 'web' ? 20 : insets.top + 8,
          borderBottomColor: colors.cardBorder,
        }]}>
          <View style={s.headerLeft}>
            <View style={[s.headerIcon, { backgroundColor: '#6366F120' }]}>
              <Ionicons name="person-circle" size={22} color="#6366F1" />
            </View>
            <Text style={[s.headerTitle, { color: colors.text }]}>Business Profile</Text>
          </View>
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <BusinessDataForm
            onComplete={() => {
              onComplete?.();
            }}
          />
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export function ProfileButton({ onPress }: { onPress: () => void }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Pressable onPress={onPress} style={[s.profileBtn, { backgroundColor: isDark ? '#151B24' : '#EDF2EE' }]}>
      <Ionicons name="person-circle-outline" size={22} color={isDark ? '#8892A4' : '#546478'} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  profileBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
