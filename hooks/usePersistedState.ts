import { useState, useEffect, useRef, useCallback } from 'react';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';

type PersistedStateReturn<T> = {
  state: T;
  updateState: (partial: Partial<T>) => void;
  replaceState: (next: T) => void;
  isLoading: boolean;
  isSaving: boolean;
  saveError: string | null;
  resetState: () => void;
  lastSavedAt: string | null;
  hydrationVersion: number;
};

export function usePersistedState<T extends Record<string, any>>(
  moduleKey: string,
  defaultState: T,
  debounceMs: number = 800
): PersistedStateReturn<T> {
  const { selectedCampaign } = useCampaign();
  const selectedCampaignId = selectedCampaign?.selectedCampaignId || '';
  const baseUrl = getApiUrl();

  const [state, setState] = useState<T>(defaultState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [hydrationVersion, setHydrationVersion] = useState(0);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef<T | null>(null);
  const currentCampaign = useRef<string>('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const saveToServer = useCallback(async (data: T) => {
    if (!selectedCampaignId || !mountedRef.current) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        new URL(`/api/ui-state/${moduleKey}?accountId=default`, baseUrl).toString(),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stateData: data }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Save failed' }));
        if (mountedRef.current) setSaveError(err.message || `Save failed (${res.status})`);
        return;
      }
      const result = await res.json();
      if (mountedRef.current) {
        setLastSavedAt(result.updatedAt);
        setSaveError(null);
      }
    } catch (e: any) {
      if (mountedRef.current) setSaveError(e.message || 'Network error');
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [selectedCampaignId, moduleKey, baseUrl]);

  const debouncedSave = useCallback((data: T) => {
    pendingState.current = data;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (pendingState.current) {
        saveToServer(pendingState.current);
        pendingState.current = null;
      }
    }, debounceMs);
  }, [saveToServer, debounceMs]);

  useEffect(() => {
    if (!selectedCampaignId) {
      setState(defaultState);
      setIsLoading(false);
      setHydrated(false);
      return;
    }

    if (currentCampaign.current === selectedCampaignId && hydrated) {
      return;
    }

    const isSwitch = currentCampaign.current !== '' && currentCampaign.current !== selectedCampaignId;
    currentCampaign.current = selectedCampaignId;
    setIsLoading(true);
    setHydrated(false);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    pendingState.current = null;

    (async () => {
      try {
        const res = await fetch(
          new URL(`/api/ui-state/${moduleKey}?accountId=default`, baseUrl).toString()
        );
        if (res.ok) {
          const data = await res.json();
          if (mountedRef.current && currentCampaign.current === selectedCampaignId) {
            if (data.exists && data.stateData) {
              setState({ ...defaultState, ...data.stateData });
              setLastSavedAt(data.updatedAt);
            } else {
              setState(defaultState);
              setLastSavedAt(null);
            }
            setHydrated(true);
            setHydrationVersion(v => v + 1);
          }
        } else {
          if (mountedRef.current) {
            setState(defaultState);
            setHydrated(true);
            setHydrationVersion(v => v + 1);
          }
        }
      } catch {
        if (mountedRef.current) {
          setState(defaultState);
          setHydrated(true);
          setHydrationVersion(v => v + 1);
        }
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    })();
  }, [selectedCampaignId, moduleKey]);

  const updateState = useCallback((partial: Partial<T>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      if (hydrated) debouncedSave(next);
      return next;
    });
  }, [hydrated, debouncedSave]);

  const replaceState = useCallback((next: T) => {
    setState(next);
    if (hydrated) debouncedSave(next);
  }, [hydrated, debouncedSave]);

  const resetState = useCallback(async () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    pendingState.current = null;
    setState(defaultState);
    setLastSavedAt(null);
    setSaveError(null);

    if (!selectedCampaignId) return;
    try {
      await fetch(
        new URL(`/api/ui-state/${moduleKey}?accountId=default`, baseUrl).toString(),
        { method: 'DELETE' }
      );
    } catch {}
  }, [selectedCampaignId, moduleKey, baseUrl, defaultState]);

  return {
    state,
    updateState,
    replaceState,
    isLoading,
    isSaving,
    saveError,
    resetState,
    lastSavedAt,
    hydrationVersion,
  };
}
