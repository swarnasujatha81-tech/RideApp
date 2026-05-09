import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNotifications } from '@/hooks/use-notifications';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { installGlobalErrorLogger } from '@/lib/global-error-logger';

installGlobalErrorLogger();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    console.log('[navigation] RootLayout mounted');
    return () => console.log('[navigation] RootLayout unmounted');
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SafeAreaProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
      <StatusBar hidden />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const { user, initializing } = useAuth();

  // Initialize notifications after user is authenticated
  useNotifications();

  useEffect(() => {
    if (initializing) return;

    const inLoginRoute = segments[0] === 'login';
    if (!user && !inLoginRoute) {
      router.replace('/login');
      return;
    }

    if (user && inLoginRoute) {
      router.replace('/(tabs)');
    }
  }, [initializing, router, segments, user]);

  if (initializing) {
    return (
      <View style={rootStyles.splash}>
        <ActivityIndicator size="large" color="#0B61FF" />
        <Text style={rootStyles.splashText}>Checking your login...</Text>
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

const rootStyles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  splashText: {
    marginTop: 12,
    color: '#475569',
    fontWeight: '700',
  },
});
