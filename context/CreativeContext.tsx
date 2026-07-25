import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';

export interface CreativeContextData {
  source: 'CI';
  competitorId: string;
  competitorName: string;
  snapshotId: string;
  snapshotCreatedAt: string;
  intelligence: {
    conversion_intelligence: any;
    narrative_intelligence: any;
    performance_context: any;
    storytelling_intelligence: any;
    dominance: any;
    archetype: any;
  };
  creative_layers?: {
    creative_expansion?: any;
    creative_strategy?: any;
  };
  onboarding_context?: {
    location?: string;
    market_type?: string;
    language?: string;
    primary_objective?: string;
  };
  blueprint_context: {
    offer: string;
    icp: string;
  };
}

interface CreativeContextValue {
  creativeContext: CreativeContextData | null;
  setCreativeContext: (ctx: CreativeContextData | null) => void;
  clearCreativeContext: () => void;
}

const CreativeCtx = createContext<CreativeContextValue | null>(null);

export function CreativeContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const authUserId = user?.id ?? null;
  const [creativeContext, setCreativeContextState] = useState<CreativeContextData | null>(null);

  const setCreativeContext = useCallback((ctx: CreativeContextData | null) => {
    setCreativeContextState(ctx);
  }, []);

  const clearCreativeContext = useCallback(() => {
    setCreativeContextState(null);
  }, []);

  // SECURITY: competitor intelligence is account-scoped. Clear it on any
  // change of auth identity (login, logout, switchToAccount) so the next
  // user cannot see the previous account's selected competitor snapshot.
  useEffect(() => {
    setCreativeContextState(null);
  }, [authUserId]);

  return (
    <CreativeCtx.Provider value={{ creativeContext, setCreativeContext, clearCreativeContext }}>
      {children}
    </CreativeCtx.Provider>
  );
}

export function useCreativeContext() {
  const context = useContext(CreativeCtx);
  if (!context) {
    throw new Error('useCreativeContext must be used within a CreativeContextProvider');
  }
  return context;
}
