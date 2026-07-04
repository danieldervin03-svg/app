import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(String(user?.calorie_goal ?? 2000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = user?.name?.slice(0, 2).toUpperCase() ?? "BP";

  const doLogout = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const saveGoal = async () => {
    setError(null);
    const n = parseInt(goal, 10);
    if (Number.isNaN(n) || n < 800 || n > 8000) {
      setError("Entrez une valeur entre 800 et 8000");
      return;
    }
    setSaving(true);
    try {
      const u = await api.updateCalorieGoal(n);
      setUser(u);
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ icon, label, value, onPress, testID }: { icon: any; label: string; value?: string; onPress?: () => void; testID?: string }) => (
    <Pressable style={styles.row} onPress={onPress} testID={testID}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.onBrandTertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container} testID="profile-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials}</Text>
          </View>
          <Text style={styles.name} testID="profile-name">{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <Text style={styles.section}>Objectifs</Text>
        <Row
          icon="flame-outline"
          label="Objectif calorique quotidien"
          value={`${user?.calorie_goal ?? 2000} kcal`}
          onPress={() => { setGoal(String(user?.calorie_goal ?? 2000)); setOpen(true); }}
          testID="profile-goal-row"
        />

        <Text style={styles.section}>Compte</Text>
        <Row icon="mail-outline" label="Email" value={user?.email} />
        <Row icon="calendar-outline" label="Membre depuis" value={user?.created_at ? new Date(user.created_at).toLocaleDateString("fr-FR") : ""} />

        <Pressable style={styles.logout} onPress={doLogout} testID="profile-logout">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutTxt}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>Objectif quotidien</Text>
              <Input label="Calories (kcal)" keyboardType="numeric" value={goal} onChangeText={setGoal} testID="profile-goal-input" />
              {error ? <Text style={{ color: colors.error, textAlign: "center" }}>{error}</Text> : null}
              <Button title="Enregistrer" onPress={saveGoal} loading={saving} testID="profile-goal-save" />
              <Pressable onPress={() => setOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  header: { alignItems: "center", padding: spacing.xl },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { fontSize: 30, color: colors.onBrandTertiary, fontWeight: "500" },
  name: { fontSize: font.xxl, color: colors.onSurface, marginTop: spacing.md, fontWeight: "500" },
  email: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  section: { fontSize: font.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: font.base, color: colors.onSurface },
  rowValue: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  logout: {
    marginTop: spacing.xxl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
  },
  logoutTxt: { color: colors.error, fontSize: font.lg },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xxxl },
  drag: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
});
