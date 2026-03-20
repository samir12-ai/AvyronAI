import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '@/lib/query-client';

interface User {
  id: string;
  email: string;
  name: string;
  subscriptionStatus: 'trial' | 'active' | 'expired';
  planType: 'trial' | 'paid';
  trialEnd: string | null;
  hasSeenIntro: boolean;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  subscriptionStatus: 'trial' | 'active' | 'expired' | null;
  trialDaysRemaining: number;
  isAccessActive: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AUTH_TOKEN_KEY = 'marketmind_auth_token';
const AUTH_USER_KEY = 'marketmind_auth_user_v2';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser] = await Promise.all([
        AsyncStorage.getItem(AUTH_TOKEN_KEY),
        AsyncStorage.getItem(AUTH_USER_KEY),
      ]);

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));

        try {
          const baseUrl = getApiUrl();
          const res = await fetch(new URL('/api/auth/me', baseUrl).toString(), {
            headers: { Authorization: `Bearer ${storedToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
          } else {
            await clearAuth();
          }
        } catch {
          // offline - use cached user
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
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Connection failed. Please try again.' };
    }
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
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
      }
    } catch {}
  }, [token]);

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
    login,
    register,
    logout,
    markIntroSeen,
    refreshUser,
  }), [user, token, isLoading, trialDaysRemaining, isAccessActive, login, register, logout, markIntroSeen, refreshUser]);

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
