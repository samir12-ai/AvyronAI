import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import AvyronLogo from "@/components/AvyronLogo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { 
  useFonts, 
  Inter_400Regular, 
  Inter_500Medium, 
  Inter_600SemiBold, 
  Inter_700Bold 
} from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AppProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { CampaignProvider } from "@/context/CampaignContext";
import { CreativeContextProvider } from "@/context/CreativeContext";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { AccountSwitcherModal } from "@/components/AccountSwitcherModal";

SplashScreen.preventAutoHideAsync();

function LoadingScreen() {
  return (
    <View style={loadingStyles.container}>
      <View style={loadingStyles.logo}>
        <AvyronLogo size={56} />
      </View>
      <Text style={loadingStyles.title}>Avyron AI</Text>
      <ActivityIndicator size="large" color="#7C3AED" style={loadingStyles.spinner} />
      <Text style={loadingStyles.subtitle}>Loading your workspace...</Text>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: '#0F0F1A',
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    marginBottom: 16,
    backgroundColor: 'rgba(124,58,237,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 24,
  },
  spinner: {
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user, isAccessActive, isAddingAccount } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'signup';
    const inIntro = segments[0] === 'intro';
    const inUpgrade = segments[0] === 'upgrade';
    const inSetup = segments[0] === 'setup';

    if (!isAuthenticated) {
      if (!inAuthGroup) {
        router.replace('/login');
      }
    } else if (!user?.hasSeenIntro && !inSetup) {
      if (!inIntro) {
        router.replace('/intro');
      }
    } else if (!isAccessActive && process.env.NODE_ENV !== "development") {
      if (!inUpgrade) {
        router.replace('/upgrade');
      }
    } else {
      if (inAuthGroup && isAddingAccount) {
        return;
      }
      if (inAuthGroup || inUpgrade) {
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, isLoading, user, isAccessActive, isAddingAccount, segments]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <OnboardingProvider>
        <Stack screenOptions={{ headerBackTitle: "Back" }}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="setup" options={{ headerShown: false }} />
          <Stack.Screen name="intro" options={{ headerShown: false }} />
          <Stack.Screen name="upgrade" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="studio/[id]" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="agent" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="audit-control" options={{ headerShown: false, presentation: 'card' }} />
        </Stack>
        <AccountSwitcherModal />
      </OnboardingProvider>
    </AuthGate>
  );
}

export default function RootLayout() {
  // Preload Ionicons alongside Inter so the icon font is registered exactly
  // once during splash. Without this, @expo/vector-icons calls Font.loadAsync
  // lazily on first icon render, which on iOS triggers
  // CTFontManagerError code 104 ("Font registration was unsuccessful")
  // during Fast Refresh / re-mount because the font is already registered.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
  });

  // Safety valve: if useFonts never resolves (silent hang in Replit's sandboxed
  // environment or slow CDN) the app would be permanently stuck on the loading
  // screen. After 3 s we treat fonts as ready regardless so the auth gate can
  // run and redirect to login / tabs.
  const [fontsTimedOut, setFontsTimedOut] = React.useState(false);
  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const t = setTimeout(() => setFontsTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, [fontsLoaded, fontError]);

  const fontsReady = fontsLoaded || !!fontError || fontsTimedOut;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return <LoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <AppProvider>
            <CampaignProvider>
            <CreativeContextProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
            </CreativeContextProvider>
            </CampaignProvider>
            </AppProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
