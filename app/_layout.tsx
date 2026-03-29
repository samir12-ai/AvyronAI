import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Image } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { 
  useFonts, 
  Inter_400Regular, 
  Inter_500Medium, 
  Inter_600SemiBold, 
  Inter_700Bold 
} from "@expo-google-fonts/inter";
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
      <Image source={require('@/assets/images/logo.jpeg')} style={loadingStyles.logo} />
      <Text style={loadingStyles.title}>MarketMind AI</Text>
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
  const { isAuthenticated, isLoading, user, isAccessActive } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'login';
    const inIntro = segments[0] === 'intro';
    const inUpgrade = segments[0] === 'upgrade';

    if (!isAuthenticated) {
      if (!inAuthGroup) {
        router.replace('/login');
      }
    } else if (!user?.hasSeenIntro) {
      if (!inIntro) {
        router.replace('/intro');
      }
    } else if (!isAccessActive) {
      if (!inUpgrade) {
        router.replace('/upgrade');
      }
    } else {
      if (inAuthGroup || inIntro || inUpgrade) {
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, isLoading, user, isAccessActive, segments]);

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
          <Stack.Screen name="intro" options={{ headerShown: false }} />
          <Stack.Screen name="upgrade" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="studio/[id]" options={{ headerShown: false, presentation: 'card' }} />
          <Stack.Screen name="agent" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        </Stack>
        <AccountSwitcherModal />
      </OnboardingProvider>
    </AuthGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
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
