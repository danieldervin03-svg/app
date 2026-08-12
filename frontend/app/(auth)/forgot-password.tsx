import React, { useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Button, Input } from "@/src/components/ui";
import { colors, spacing, font } from "@/src/theme";
import { api } from "@/src/api";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    if (!email.trim()) {
      setError("Entrez votre email");
      return;
    }
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setStep("reset");
    } catch (e: any) {
      setError(e.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError(null);
    if (code.trim().length !== 6) {
      setError("Le code doit contenir 6 chiffres");
      return;
    }
    if (newPassword.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(email.trim(), code.trim(), newPassword);
      setStep("done");
    } catch (e: any) {
      setError(e.message || "Code invalide ou expiré");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => router.back()} style={styles.backBtn} testID="forgot-back">
              <Text style={{ color: colors.onSurfaceSecondary }}>← Retour</Text>
            </Pressable>

            {step === "email" ? (
              <>
                <Text style={styles.title}>Mot de passe oublié</Text>
                <Text style={styles.subtitle}>Entrez votre email, on vous envoie un code de réinitialisation.</Text>
                <Input
                  label="Email"
                  placeholder="vous@exemple.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  testID="forgot-email-input"
                />
                {error ? <Text style={styles.err}>{error}</Text> : null}
                <Button title="Envoyer le code" onPress={sendCode} loading={loading} testID="forgot-send-code" />
              </>
            ) : step === "reset" ? (
              <>
                <Text style={styles.title}>Vérifiez vos emails</Text>
                <Text style={styles.subtitle}>
                  Un code à 6 chiffres a été envoyé à {email}. Il expire dans 15 minutes.
                </Text>
                <Input
                  label="Code reçu par email"
                  placeholder="123456"
                  keyboardType="number-pad"
                  value={code}
                  onChangeText={setCode}
                  testID="forgot-code-input"
                />
                <Input
                  label="Nouveau mot de passe"
                  placeholder="6 caractères minimum"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  testID="forgot-new-password"
                />
                <Input
                  label="Confirmer le mot de passe"
                  placeholder="Retapez le mot de passe"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  testID="forgot-confirm-password"
                />
                {error ? <Text style={styles.err}>{error}</Text> : null}
                <Button title="Réinitialiser le mot de passe" onPress={resetPassword} loading={loading} testID="forgot-reset-submit" />
                <Pressable onPress={sendCode} disabled={loading} style={{ alignItems: "center", padding: spacing.md }}>
                  <Text style={{ color: colors.brandPrimary }}>Renvoyer le code</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.title}>C'est fait ! 🎉</Text>
                <Text style={styles.subtitle}>Votre mot de passe a été mis à jour. Vous pouvez maintenant vous connecter.</Text>
                <Button
                  title="Retour à la connexion"
                  onPress={() => router.replace("/(auth)/login")}
                  testID="forgot-back-to-login"
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: "center" },
  backBtn: { marginBottom: spacing.lg },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "600", marginBottom: spacing.xs },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.xl },
  err: { color: colors.error, textAlign: "center", marginBottom: spacing.md },
});
