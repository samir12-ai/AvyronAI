import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl, queryClient } from '@/lib/query-client';
import { getAuthToken, setAuthToken, clearAuthToken } from '@/lib/secure-token-storage';

export interface SavedAccount {
  userId: string;
  email: string;
  token: string;
  subscriptionStatus: 'trial' | 'active' | 'expired';
  planType: 'trial' | 'paid';
  videoCredits: number;
}

interface User {
  id: string;
  email: string;
  name: string;
  subscriptionStatus: 'trial' | 'active' | 'expired';
  planType: 'trial' | 'paid';
  videoCredits: number;
  trialEnd: string | null;
  hasSeenIntro: boolean;
  isAdmin: boolean;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  subscriptionStatus: 'trial' | 'active' | 'expired' | null;
  trialDaysRemaining: number;
  isAccessActive: boolean;
  savedAccounts: SavedAccount[];
  showAccountSwitcher: boolean;
  isAddingAccount: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
  refreshUser: () => Promise<void>;
  switchToAccount: (account: SavedAccount) => Promise<void>;
  removeSavedAccount: (userId: string) => Promise<void>;
  openAccountSwitcher: () => void;
  closeAccountSwitcher: () => void;
  setIsAddingAccount: (value: boolean) => void;
}

// P0-3 (launch-closure Wave 1): JWT lives in expo-secure-store (Keychain /
// EncryptedSharedPreferences). The legacy AUTH_TOKEN_KEY is read once for
// migration and then deleted by `getAuthToken()` (see lib/secure-token-storage).
// User profile JSON stays in AsyncStorage — it is non-secret display data.
// SavedAccount metadata stays in AsyncStorage but tokens for saved accounts
// are now stored separately in SecureStore under per-userId keys.
const AUTH_USER_KEY = 'avyron_auth_user_v2';
const SAVED_ACCOUNTS_KEY = 'avyron_saved_accounts_v2';
const LEGACY_SAVED_ACCOUNTS_KEY = 'avyron_saved_accounts_v1';
const SAVED_ACCOUNT_TOKEN_PREFIX = 'avyron_saved_token_';

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Per-userId token helpers for the saved-accounts roster.
async function readSavedToken(userId: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return await SecureStore.getItemAsync(SAVED_ACCOUNT_TOKEN_PREFIX + userId);
    }
    const usable = await SecureStore.isAvailableAsync().catch(() => false);
    if (!usable) return null;
    return await SecureStore.getItemAsync(SAVED_ACCOUNT_TOKEN_PREFIX + userId);
  } catch { return null; }
}
async function writeSavedToken(userId: string, token: string): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      const usable = await SecureStore.isAvailableAsync().catch(() => false);
      if (!usable) return;
    }
    await SecureStore.setItemAsync(SAVED_ACCOUNT_TOKEN_PREFIX + userId, token);
  } catch {}
}
async function deleteSavedToken(userId: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(SAVED_ACCOUNT_TOKEN_PREFIX + userId); } catch {}
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userToSavedAccount(user: User, token: string): SavedAccount {
  return {
    userId: user.id,
    email: user.email,
    token,
    subscriptionStatus: user.subscriptionStatus,
    planType: user.planType,
    videoCredits: user.videoCredits,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  // P0-3: SavedAccount roster is stored token-less in AsyncStorage
  // (`SAVED_ACCOUNTS_KEY` v2). The actual token for each saved account lives
  // in SecureStore under `SAVED_ACCOUNT_TOKEN_PREFIX + userId`. On read we
  // hydrate the token back so the in-memory shape stays the same. On first
  // run we migrate the legacy v1 blob (which inlined plaintext tokens),
  // promote each token to SecureStore, and delete the legacy key.
  const loadSavedAccounts = async (): Promise<SavedAccount[]> => {
    try {
      let raw = await AsyncStorage.getItem(SAVED_ACCOUNTS_KEY);
      if (!raw) {
        const legacyRaw = await AsyncStorage.getItem(LEGACY_SAVED_ACCOUNTS_KEY);
        if (legacyRaw) {
          const legacyList: SavedAccount[] = JSON.parse(legacyRaw);
          // Promote tokens to SecureStore, then strip them from AsyncStorage.
          for (const acc of legacyList) {
            if (acc.token) await writeSavedToken(acc.userId, acc.token);
          }
          const stripped = legacyList.map(({ token: _t, ...rest }) => ({ ...rest, token: '' as string }));
          await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(stripped));
          await AsyncStorage.removeItem(LEGACY_SAVED_ACCOUNTS_KEY);
          raw = JSON.stringify(stripped);
        }
      }
      const list: SavedAccount[] = raw ? JSON.parse(raw) : [];
      // Hydrate tokens from SecureStore back into the in-memory roster.
      const hydrated = await Promise.all(list.map(async (a) => ({
        ...a,
        token: (await readSavedToken(a.userId)) || '',
      })));
      return hydrated;
    } catch {
      return [];
    }
  };

  const persistSavedAccounts = async (accounts: SavedAccount[]) => {
    try {
      // Persist token-less metadata only.
      const stripped = accounts.map(({ token: _t, ...rest }) => ({ ...rest, token: '' as string }));
      await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(stripped));
      setSavedAccounts(accounts);
    } catch {}
  };

  const upsertSavedAccount = async (account: SavedAccount) => {
    const accounts = await loadSavedAccounts();
    const idx = accounts.findIndex(a => a.userId === account.userId);
    if (idx >= 0) {
      accounts[idx] = account;
    } else {
      accounts.push(account);
    }
    if (account.token) await writeSavedToken(account.userId, account.token);
    await persistSavedAccounts(accounts);
  };

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser, storedAccounts] = await Promise.all([
        getAuthToken(),
        AsyncStorage.getItem(AUTH_USER_KEY),
        loadSavedAccounts(),
      ]);

      setSavedAccounts(storedAccounts);

      if (storedToken && storedUser) {
        const parsedUser: User = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);

        try {
          const baseUrl = getApiUrl();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(new URL('/api/auth/me', baseUrl).toString(), {
            headers: { Authorization: `Bearer ${storedToken}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
            await upsertSavedAccount(userToSavedAccount(data.user, storedToken));
          } else {
            await clearAuth();
          }
        } catch {
          // offline or timeout - use cached user
        }
      }
    } catch (error) {
      console.error('[Auth] Load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearAuth = async () => {
    setUser(null);
    setToken(null);
    await clearAuthToken();
    await AsyncStorage.removeItem(AUTH_USER_KEY);
    // P1 isolation seal: blow away every cached server response and pending
    // mutation so the next authed user can never read the previous user's
    // React Query cache (cross-tenant leakage surface #1).
    try {
      queryClient.cancelQueries();
      queryClient.clear();
    } catch (e) {
      console.warn('[Auth] queryClient.clear failed during clearAuth:', e);
    }
  };

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/auth/login', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Login failed' };
      }

      setToken(data.token);
      setUser(data.user);
      await setAuthToken(data.token);
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      await upsertSavedAccount(userToSavedAccount(data.user, data.token));
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Connection failed. Please try again.' };
    }
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/auth/register', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Registration failed' };
      }

      setToken(data.token);
      setUser(data.user);
      await setAuthToken(data.token);
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      await upsertSavedAccount(userToSavedAccount(data.user, data.token));
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Connection failed. Please try again.' };
    }
  }, []);

  const logout = useCallback(async () => {
    if (user) {
      const accounts = await loadSavedAccounts();
      const remaining = accounts.filter(a => a.userId !== user.id);
      await persistSavedAccounts(remaining);
      // P0-3: also wipe the SecureStore-resident saved token for this user.
      await deleteSavedToken(user.id);
    }
    await clearAuth();
  }, [user]);

  const switchToAccount = useCallback(async (account: SavedAccount) => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/auth/me', baseUrl).toString(), {
        headers: { Authorization: `Bearer ${account.token}` },
      });

      let freshUser: User | null = null;
      if (res.ok) {
        const data = await res.json();
        freshUser = data.user;
        await upsertSavedAccount(userToSavedAccount(freshUser!, account.token));
      }

      const resolvedUser: User = freshUser ?? {
        id: account.userId,
        email: account.email,
        name: account.email.split('@')[0],
        subscriptionStatus: account.subscriptionStatus,
        planType: account.planType,
        videoCredits: account.videoCredits,
        trialEnd: null,
        hasSeenIntro: true,
        isAdmin: false,
      };

      // P1 isolation seal: clear cache BEFORE swapping tokens so no in-flight
      // query can settle into the new account's cache slot with old-account data.
      try {
        queryClient.cancelQueries();
        queryClient.clear();
      } catch (e) {
        console.warn('[Auth] queryClient.clear failed during switchToAccount:', e);
      }
      setToken(account.token);
      setUser(resolvedUser);
      await setAuthToken(account.token);
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(resolvedUser));
      setShowAccountSwitcher(false);
    } catch (error) {
      console.error('[Auth] Switch account error:', error);
    }
  }, []);

  const removeSavedAccount = useCallback(async (userId: string) => {
    const accounts = await loadSavedAccounts();
    const remaining = accounts.filter(a => a.userId !== userId);
    await persistSavedAccounts(remaining);
    // P0-3: drop the SecureStore-resident token for this saved account.
    await deleteSavedToken(userId);
  }, []);

  const markIntroSeen = useCallback(async () => {
    if (!token || !user) return;
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/auth/seen-intro', baseUrl).toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const updatedUser = { ...user, hasSeenIntro: true };
        setUser(updatedUser);
        await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
        await upsertSavedAccount(userToSavedAccount(updatedUser, token));
      }
    } catch (error) {
      console.error('[Auth] Mark intro seen error:', error);
    }
  }, [token, user]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/auth/me', baseUrl).toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        await upsertSavedAccount(userToSavedAccount(data.user, token));
      }
    } catch {}
  }, [token]);

  const openAccountSwitcher = useCallback(() => setShowAccountSwitcher(true), []);
  const closeAccountSwitcher = useCallback(() => setShowAccountSwitcher(false), []);

  const trialDaysRemaining = useMemo(() => {
    if (!user?.trialEnd) return 0;
    const diff = new Date(user.trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  }, [user?.trialEnd]);

  const isAccessActive = useMemo(() => {
    if (!user) return false;
    if (user.subscriptionStatus === 'active') return true;
    if (user.subscriptionStatus === 'trial') {
      if (!user.trialEnd) return false;
      return new Date(user.trialEnd).getTime() > Date.now();
    }
    return false;
  }, [user]);

  const value = useMemo(() => ({
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    subscriptionStatus: user?.subscriptionStatus || null,
    trialDaysRemaining,
    isAccessActive,
    savedAccounts,
    showAccountSwitcher,
    isAddingAccount,
    login,
    register,
    logout,
    markIntroSeen,
    refreshUser,
    switchToAccount,
    removeSavedAccount,
    openAccountSwitcher,
    closeAccountSwitcher,
    setIsAddingAccount,
  }), [user, token, isLoading, trialDaysRemaining, isAccessActive, savedAccounts, showAccountSwitcher, isAddingAccount, login, register, logout, markIntroSeen, refreshUser, switchToAccount, removeSavedAccount, openAccountSwitcher, closeAccountSwitcher]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
