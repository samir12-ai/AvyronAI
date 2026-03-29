import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  useColorScheme,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useAuth, SavedAccount } from '@/context/AuthContext';

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function getAvatarColor(email: string): string {
  const colors = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function planBadge(account: SavedAccount): { label: string; color: string; bg: string } {
  if (account.subscriptionStatus === 'active') {
    return { label: 'Pro', color: '#10B981', bg: '#10B98120' };
  }
  if (account.subscriptionStatus === 'trial') {
    return { label: 'Trial', color: '#8B5CF6', bg: '#8B5CF620' };
  }
  return { label: 'Expired', color: '#EF4444', bg: '#EF444420' };
}

export function AccountSwitcherModal() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { user, savedAccounts, showAccountSwitcher, closeAccountSwitcher, switchToAccount, removeSavedAccount } = useAuth();

  const colors = {
    bg: isDark ? '#0F1421' : '#FFFFFF',
    sheet: isDark ? '#161D2B' : '#F8FAFC',
    card: isDark ? '#1E2535' : '#FFFFFF',
    border: isDark ? '#2A3347' : '#E2E8F0',
    text: isDark ? '#F1F5F9' : '#0F172A',
    textSub: isDark ? '#94A3B8' : '#64748B',
    overlay: 'rgba(0,0,0,0.6)',
    active: isDark ? '#8B5CF620' : '#EDE9FE',
  };

  const handleSwitch = async (account: SavedAccount) => {
    if (account.userId === user?.id) {
      closeAccountSwitcher();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await switchToAccount(account);
  };

  const handleRemove = (account: SavedAccount) => {
    if (account.userId === user?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${account.email} from saved accounts?`)) {
        removeSavedAccount(account.userId);
      }
    } else {
      Alert.alert(
        'Remove Account',
        `Remove ${account.email} from saved accounts?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeSavedAccount(account.userId),
          },
        ]
      );
    }
  };

  const handleAddAccount = () => {
    Haptics.selectionAsync();
    closeAccountSwitcher();
    router.push({ pathname: '/login', params: { addAccount: '1' } });
  };

  const otherAccounts = savedAccounts.filter(a => a.userId !== user?.id);
  const currentAccount = savedAccounts.find(a => a.userId === user?.id);

  return (
    <Modal
      visible={showAccountSwitcher}
      transparent
      animationType="slide"
      onRequestClose={closeAccountSwitcher}
    >
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={closeAccountSwitcher}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.sheet,
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
          onPress={e => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Switch Account</Text>
            <Pressable onPress={closeAccountSwitcher} style={styles.closeBtn} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.textSub} />
            </Pressable>
          </View>

          {currentAccount && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSub }]}>ACTIVE</Text>
              <AccountRow
                account={currentAccount}
                isActive
                colors={colors}
                onPress={() => closeAccountSwitcher()}
                onRemove={undefined}
              />
            </View>
          )}

          {otherAccounts.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSub }]}>SAVED ACCOUNTS</Text>
              {otherAccounts.map(account => (
                <AccountRow
                  key={account.userId}
                  account={account}
                  isActive={false}
                  colors={colors}
                  onPress={() => handleSwitch(account)}
                  onRemove={() => handleRemove(account)}
                />
              ))}
            </View>
          )}

          <Pressable
            onPress={handleAddAccount}
            style={({ pressed }) => [
              styles.addBtn,
              { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={[styles.addIcon, { backgroundColor: '#8B5CF620' }]}>
              <Ionicons name="add" size={20} color="#8B5CF6" />
            </View>
            <Text style={[styles.addText, { color: colors.text }]}>Add another account</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSub} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AccountRow({
  account,
  isActive,
  colors,
  onPress,
  onRemove,
}: {
  account: SavedAccount;
  isActive: boolean;
  colors: Record<string, string>;
  onPress: () => void;
  onRemove?: () => void;
}) {
  const badge = planBadge(account);
  const initials = getInitials(account.email);
  const avatarColor = getAvatarColor(account.email);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: isActive ? colors.active : colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>

      <View style={styles.rowContent}>
        <Text style={[styles.rowEmail, { color: colors.text }]} numberOfLines={1}>
          {account.email}
        </Text>
        <View style={styles.rowMeta}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
          {account.subscriptionStatus === 'active' && account.videoCredits > 0 && (
            <Text style={[styles.creditsText, { color: colors.textSub }]}>
              {account.videoCredits} credits
            </Text>
          )}
        </View>
      </View>

      {isActive ? (
        <View style={styles.activeCheck}>
          <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />
        </View>
      ) : (
        <View style={styles.rowActions}>
          {onRemove && (
            <Pressable onPress={onRemove} hitSlop={12} style={styles.removeBtn}>
              <Ionicons name="remove-circle-outline" size={20} color="#EF4444" />
            </Pressable>
          )}
          <Ionicons name="swap-horizontal" size={18} color={colors.textSub} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  closeBtn: {
    padding: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  rowContent: {
    flex: 1,
    gap: 4,
  },
  rowEmail: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  creditsText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  activeCheck: {
    flexShrink: 0,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  removeBtn: {
    padding: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 14,
    gap: 12,
    marginTop: 4,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});
