import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { getApiUrl } from '@/lib/query-client';
import { fetch } from 'expo/fetch';

export interface FeatureFlags {
  lead_capture_enabled: boolean;
  cta_engine_enabled: boolean;
  conversion_tracking_enabled: boolean;
  funnel_logic_enabled: boolean;
  lead_magnet_enabled: boolean;
  landing_pages_enabled: boolean;
  revenue_attribution_enabled: boolean;
  ai_lead_optimization_enabled: boolean;
  lead_engine_global_off: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  lead_capture_enabled: false,
  cta_engine_enabled: false,
  conversion_tracking_enabled: false,
  funnel_logic_enabled: false,
  lead_magnet_enabled: false,
  landing_pages_enabled: false,
  revenue_attribution_enabled: false,
  ai_lead_optimization_enabled: false,
  lead_engine_global_off: false,
};

const TTL_MS = 5 * 60 * 1000;

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchRef = useRef<number>(0);

  const fetchFlags = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < TTL_MS) return;

    try {
      setError(null);
      const baseUrl = getApiUrl();
      const url = new URL('/api/feature-flags', baseUrl);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch flags');
      const data = await res.json();
      setFlags(data.flags);
      lastFetchRef.current = Date.now();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleFlag = useCallback(async (flagName: string, enabled: boolean, reason?: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/feature-flags/${flagName}`, baseUrl);
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, reason }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to toggle flag');
      const data = await res.json();
      setFlags(data.flags);
      lastFetchRef.current = Date.now();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, []);

  const globalKill = useCallback(async (reason?: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/feature-flags/global-kill', baseUrl);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to activate kill switch');
      await fetchFlags(true);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, [fetchFlags]);

  const globalResume = useCallback(async (reason?: string) => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/feature-flags/global-resume', baseUrl);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to resume');
      await fetchFlags(true);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }, [fetchFlags]);

  useEffect(() => {
    fetchFlags(true);
  }, [fetchFlags]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') fetchFlags();
    });
    return () => sub.remove();
  }, [fetchFlags]);

  const isGlobalOff = flags.lead_engine_global_off;
  const enabledCount = Object.entries(flags)
    .filter(([k, v]) => k !== 'lead_engine_global_off' && v)
    .length;

  return {
    flags,
    loading,
    error,
    toggleFlag,
    globalKill,
    globalResume,
    refresh: () => fetchFlags(true),
    isGlobalOff,
    enabledCount,
  };
}
