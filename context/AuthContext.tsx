import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/query-client';

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
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
  refreshUser: () => Promise<void>;
  switchToAccount: (account: SavedAccount) => Promise<void>;
  removeSavedAccount: (userId: string) => Promise<void>;
  openAccountSwitcher: () => void;
  closeAccountSwitcher: () => void;
}

const AUTH_TOKEN_KEY = 'avyron_auth_token';
const AUTH_USER_KEY = 'avyron_auth_user_v2';
const SAVED_ACCOUNTS_KEY = 'avyron_saved_accounts_v1';

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

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadSavedAccounts = async (): Promise<SavedAccount[]> => {
    try {
      const raw = await AsyncStorage.getItem(SAVED_ACCOUNTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const persistSavedAccounts = async (accounts: SavedAccount[]) => {
    try {
      await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
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
    await persistSavedAccounts(accounts);
  };

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser, storedAccounts] = await Promise.all([
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
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
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
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
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
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
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
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

      setToken(account.token);
      setUser(resolvedUser);
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, account.token);
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
    login,
    register,
    logout,
    markIntroSeen,
    refreshUser,
    switchToAccount,
    removeSavedAccount,
    openAccountSwitcher,
    closeAccountSwitcher,
  }), [user, token, isLoading, trialDaysRemaining, isAccessActive, savedAccounts, showAccountSwitcher, login, register, logout, markIntroSeen, refreshUser, switchToAccount, removeSavedAccount, openAccountSwitcher, closeAccountSwitcher]);

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
