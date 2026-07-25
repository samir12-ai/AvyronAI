import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl , authFetch } from '@/lib/query-client';

const ONBOARDING_KEY = 'avyron_onboarding_state';

export interface OnboardingStep {
  id: string;
  title: string;
  message: string;
  deepLink?: string;
  deepLinkLabel?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'setup',
    title: 'Step 1 — Setup',
    message: 'Start by completing your business profile: add your brand details, product DNA, content style, and link your social channels for scraping.',
    deepLink: '/(tabs)/settings?openBrandProfile=1',
    deepLinkLabel: 'Open Brand Profile',
  },
  {
    id: 'market',
    title: 'Step 2 — Market Intelligence',
    message: 'Add your top competitors. The intelligence engine will analyze their strategy, content, and positioning to calibrate your market data.',
    deepLink: '/(tabs)/ai-management',
    deepLinkLabel: 'Add Competitors',
  },
  {
    id: 'run',
    title: 'Step 3 — Launch System',
    message: 'Run the full orchestrator pipeline. This initializes your strategy engines, builds your plan, and activates autonomous monitoring.',
    deepLink: '/(tabs)/ai-management',
    deepLinkLabel: 'Run Pipeline',
  },
];

interface OnboardingState {
  currentStep: number;
  completed: boolean;
  skipped: boolean;
  startedAt: string | null;
  completedAt: string | null;
  stepsVisited: string[];
}

interface OnboardingContextValue {
  steps: OnboardingStep[];
  currentStep: number;
  currentStepData: OnboardingStep | null;
  totalSteps: number;
  isActive: boolean;
  isVisible: boolean;
  progress: number;
  next: () => void;
  skip: () => void;
  dismiss: () => void;
  show: () => void;
}

const defaultState: OnboardingState = {
  currentStep: 0,
  completed: false,
  skipped: false,
  startedAt: null,
  completedAt: null,
  stepsVisited: [],
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [isVisible, setIsVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (user?.id) {
      loadState(user.id);
    }
  }, [user?.id]);

  const loadState = async (userId: string) => {
    try {
      const stored = await AsyncStorage.getItem(`${ONBOARDING_KEY}_${userId}`);
      if (stored) {
        let parsed: OnboardingState = JSON.parse(stored);
        if (!parsed.completed && !parsed.skipped && parsed.currentStep >= ONBOARDING_STEPS.length) {
          parsed = { ...defaultState, startedAt: new Date().toISOString() };
          await AsyncStorage.setItem(`${ONBOARDING_KEY}_${userId}`, JSON.stringify(parsed));
        }
        setState(parsed);
        if (!parsed.completed && !parsed.skipped) {
          setIsVisible(true);
        }
      } else {
        const fresh = { ...defaultState, startedAt: new Date().toISOString() };
        setState(fresh);
        setIsVisible(true);
        await AsyncStorage.setItem(`${ONBOARDING_KEY}_${userId}`, JSON.stringify(fresh));
      }
    } catch {
      setState({ ...defaultState, startedAt: new Date().toISOString() });
      setIsVisible(true);
    }
    setLoaded(true);
  };

  const saveState = useCallback(async (newState: OnboardingState) => {
    if (!user?.id) return;
    setState(newState);
    await AsyncStorage.setItem(`${ONBOARDING_KEY}_${user.id}`, JSON.stringify(newState));
  }, [user?.id]);

  const trackEvent = useCallback(async (event: string, data: Record<string, unknown>) => {
    if (!token) return;
    try {
      const baseUrl = getApiUrl();
      await authFetch(new URL('/api/onboarding/track', baseUrl).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ event, ...data, timestamp: Date.now() }),
      });
    } catch {}
  }, [token]);

  const next = useCallback(() => {
    const nextStep = state.currentStep + 1;
    const stepData = ONBOARDING_STEPS[state.currentStep];

    if (nextStep >= ONBOARDING_STEPS.length) {
      const completed: OnboardingState = {
        ...state,
        currentStep: nextStep,
        completed: true,
        completedAt: new Date().toISOString(),
        stepsVisited: [...state.stepsVisited, stepData?.id || ''],
      };
      saveState(completed);
      setIsVisible(false);
      trackEvent('onboarding_completed', {
        totalSteps: ONBOARDING_STEPS.length,
        stepsVisited: completed.stepsVisited,
      });
    } else {
      const updated: OnboardingState = {
        ...state,
        currentStep: nextStep,
        stepsVisited: [...state.stepsVisited, stepData?.id || ''],
      };
      saveState(updated);
      trackEvent('step_completed', {
        stepId: stepData?.id,
        stepIndex: state.currentStep,
      });
    }
  }, [state, saveState, trackEvent]);

  const skip = useCallback(() => {
    const stepData = ONBOARDING_STEPS[state.currentStep];
    const skippedState: OnboardingState = {
      ...state,
      skipped: true,
      completedAt: new Date().toISOString(),
    };
    saveState(skippedState);
    setIsVisible(false);
    trackEvent('onboarding_skipped', {
      skippedAtStep: state.currentStep,
      skippedStepId: stepData?.id,
      stepsCompleted: state.stepsVisited.length,
    });
  }, [state, saveState, trackEvent]);

  const dismiss = useCallback(() => {
    const dismissedState: OnboardingState = {
      ...state,
      skipped: true,
      completedAt: new Date().toISOString(),
    };
    saveState(dismissedState);
    setIsVisible(false);
  }, [state, saveState]);

  const show = useCallback(() => {
    if (!state.completed && !state.skipped) {
      setIsVisible(true);
    }
  }, [state.completed, state.skipped]);

  const value = useMemo(() => ({
    steps: ONBOARDING_STEPS,
    currentStep: state.currentStep,
    currentStepData: state.currentStep < ONBOARDING_STEPS.length ? ONBOARDING_STEPS[state.currentStep] : null,
    totalSteps: ONBOARDING_STEPS.length,
    isActive: loaded && !state.completed && !state.skipped,
    isVisible: loaded && isVisible && !state.completed && !state.skipped,
    progress: state.currentStep / ONBOARDING_STEPS.length,
    next,
    skip,
    dismiss,
    show,
  }), [state, isVisible, loaded, next, skip, dismiss, show]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
