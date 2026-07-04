import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Button, Input } from "@/src/components/ui";
import { colors, spacing, font } from "@/src/theme";
import { useAuth } from "@/src/auth";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError("Veuillez remplir tous les champs");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Impossible de se connecter");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.hero}>
        <Image
          source="https://images.pexels.com/photos/36717701/pexels-photo-36717701.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.85)", colors.surface]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.heroInner}>
          <Text style={styles.brand}>Bodypilot</Text>
          <Text style={styles.tagline}>Votre coach IA de poche</Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Bon retour</Text>
          <Text style={styles.subtitle}>Connectez-vous pour continuer</Text>

          <Input
            label="Email"
            placeholder="vous@exemple.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            testID="login-email-input"
          />
          <Input
            label="Mot de passe"
            placeholder="••••••••"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            testID="login-password-input"
          />

          {error ? <Text style={styles.err} testID="login-error">{error}</Text> : null}

          <Button
            title="Se connecter"
            onPress={onSubmit}
            loading={loading}
            testID="login-submit-button"
            style={{ marginTop: spacing.md }}
          />

          <Pressable
            onPress={() => router.push("/(auth)/register")}
            style={styles.link}
            testID="login-goto-register"
          >
            <Text style={styles.linkTxt}>
              Pas encore de compte ? <Text style={{ color: colors.brandPrimary }}>Créer un compte</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, backgroundColor: colors.surfaceSecondary },
  heroInner: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "flex-end", paddingBottom: spacing.xl },
  brand: { fontSize: 40, color: colors.brandPrimary, fontWeight: "500" },
  tagline: { fontSize: font.lg, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  form: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  title: { fontSize: font.xxl, color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.xl },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.sm },
  link: { alignItems: "center", marginTop: spacing.xl },
  linkTxt: { color: colors.onSurfaceSecondary, fontSize: font.base },
});
