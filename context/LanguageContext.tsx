import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n, { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/i18n';

const LANGUAGE_STORAGE_KEY = '@marketmind_language';

interface LanguageContextValue {
  locale: LanguageCode;
  setLocale: (code: LanguageCode) => Promise<void>;
  t: (scope: string, options?: Record<string, unknown>) => string;
  isRTL: boolean;
  languages: typeof SUPPORTED_LANGUAGES;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LanguageCode>('en');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) {
          i18n.locale = stored;
          setLocaleState(stored as LanguageCode);
        } else {
          const deviceLocales = Localization.getLocales();
          const deviceLang = deviceLocales?.[0]?.languageCode || 'en';
          const supported = SUPPORTED_LANGUAGES.find(l => l.code === deviceLang);
          const finalLocale = supported ? supported.code : 'en';
          i18n.locale = finalLocale;
          setLocaleState(finalLocale as LanguageCode);
        }
      } catch {
        i18n.locale = 'en';
      }
      setIsReady(true);
    };
    loadLanguage();
  }, []);

  const setLocale = useCallback(async (code: LanguageCode) => {
    i18n.locale = code;
    setLocaleState(code);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {}
  }, []);

  const t = useCallback((scope: string, options?: Record<string, unknown>) => {
    return i18n.t(scope, options) as string;
  }, [locale]);

  const isRTL = locale === 'ar' || locale === 'he';

  const value = useMemo(() => ({
    locale,
    setLocale,
    t,
    isRTL,
    languages: SUPPORTED_LANGUAGES,
  }), [locale, setLocale, t, isRTL]);

  if (!isReady) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
