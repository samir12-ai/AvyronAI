import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { getApiUrl , authFetch } from '@/lib/query-client';

const ONBOARDING_KEY = 'marketmind_onboarding_state';

export interface OnboardingStep {
  id: string;
  title: string;
  message: string;
  deepLink?: string;
  deepLinkLabel?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to MarketMind',
    message: 'I\'m your MarketMind agent. I\'ll walk you through your marketing system in a few quick steps.',
  },
  {
    id: 'profile',
    title: 'Set up your brand',
    message: 'First, tell us about your business — name, industry, and target audience. This shapes everything.',
    deepLink: '/(tabs)/settings',
    deepLinkLabel: 'Go to Settings',
  },
  {
    id: 'dashboard_overview',
    title: 'Your command center',
    message: 'This is your Dashboard. Campaign metrics, progress, and system status — all in one view.',
    deepLink: '/(tabs)',
    deepLinkLabel: 'View Dashboard',
  },
  {
    id: 'competitors',
    title: 'Add your competitors',
    message: 'Head to AI Management and add competitors. Our intelligence engine will analyze their strategy.',
    deepLink: '/(tabs)/ai-management',
    deepLinkLabel: 'Open AI Management',
  },
  {
    id: 'run_engines',
    title: 'Run your engines',
    message: 'Now run the strategic engines — Positioning, Differentiation, Funnel, Offer. They build your entire strategy.',
    deepLink: '/(tabs)/ai-management',
    deepLinkLabel: 'Run Engines',
  },
  {
    id: 'narrative',
    title: 'Check your narrative',
    message: 'Once engines complete, your strategic narrative connects everything: problem, cause, intervention, result.',
    deepLink: '/(tabs)/ai-management',
    deepLinkLabel: 'View Narrative',
  },
  {
    id: 'create_content',
    title: 'Create your first content',
    message: 'Use the Create tab to generate strategy-aligned posts, reels, and ad copy powered by your engines.',
    deepLink: '/(tabs)/create',
    deepLinkLabel: 'Start Creating',
  },
  {
    id: 'studio',
    title: 'Explore the Studio',
    message: 'Studio manages your media — videos, scripts, and visual assets. Everything organized in one place.',
    deepLink: '/(tabs)/studio',
    deepLinkLabel: 'Open Studio',
  },
  {
    id: 'calendar',
    title: 'Plan your schedule',
    message: 'Use the Calendar to schedule content and plan your publishing cadence across channels.',
    deepLink: '/(tabs)/calendar',
    deepLinkLabel: 'View Calendar',
  },
  {
    id: 'ready',
    title: 'You\'re all set!',
    message: 'Your marketing system is ready. Run engines, create content, and let MarketMind handle the strategy.',
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
        const parsed: OnboardingState = JSON.parse(stored);
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
    setIsVisible(false);
  }, []);

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
