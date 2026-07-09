import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Button, Input } from "@/src/components/ui";
import { colors, spacing, font } from "@/src/theme";
import { useAuth } from "@/src/auth";

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError("Nom requis. Mot de passe : 6 caractères minimum.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Impossible de créer le compte");
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
          <Text style={styles.tagline}>Commencez votre transformation</Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Quelques secondes suffisent</Text>

          <Input
            label="Prénom"
            placeholder="Ex : Léa"
            value={name}
            onChangeText={setName}
            testID="register-name-input"
          />
          <Input
            label="Email"
            placeholder="vous@exemple.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            testID="register-email-input"
          />
          <Input
            label="Mot de passe"
            placeholder="6 caractères minimum"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            testID="register-password-input"
          />

          {error ? <Text style={styles.err} testID="register-error">{error}</Text> : null}

          <Button
            title="S'inscrire"
            onPress={onSubmit}
            loading={loading}
            testID="register-submit-button"
            style={{ marginTop: spacing.md }}
          />

          <Pressable
            onPress={() => router.back()}
            style={styles.link}
            testID="register-goto-login"
          >
            <Text style={styles.linkTxt}>
              Déjà un compte ? <Text style={{ color: colors.brandPrimary }}>Se connecter</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 220, backgroundColor: colors.surfaceSecondary },
  heroInner: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "flex-end", paddingBottom: spacing.xl },
  brand: { fontSize: 34, color: colors.brandPrimary, fontWeight: "500" },
  tagline: { fontSize: font.lg, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  form: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  title: { fontSize: font.xxl, color: colors.onSurface, marginBottom: spacing.xs },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.xl },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.sm },
  link: { alignItems: "center", marginTop: spacing.xl },
  linkTxt: { color: colors.onSurfaceSecondary, fontSize: font.base },
});
