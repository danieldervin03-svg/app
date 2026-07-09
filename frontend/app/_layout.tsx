import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox, View, ActivityIndicator, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { colors } from "@/src/theme";
import { AnimatedSplash } from "@/src/components/animated-splash";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function RootGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const first = segments[0];
    const inAuth = first === "(auth)";
    if (!user && !inAuth) {
      router.replace("/(auth)/login");
    } else if (user && (inAuth || !first)) {
      router.replace("/(tabs)");
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={styles.center} testID="root-loading">
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    // Hide the tiny native splash as soon as our full-screen animated splash is ready to draw,
    // so there's no flash of blank white in between the two.
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={showSplash ? "light" : "dark"} />
        <AuthProvider>
          <RootGuard />
        </AuthProvider>
        {showSplash ? <AnimatedSplash onFinished={() => setShowSplash(false)} /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
