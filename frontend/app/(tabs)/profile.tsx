import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { useAuth } from "@/src/auth";
import { api, ProfileInput } from "@/src/api";

const SEXES: ProfileInput["sex"][] = ["homme", "femme"];
const ACTIVITIES: ProfileInput["activity_level"][] = ["sédentaire", "léger", "modéré", "actif", "très actif"];
const GOALS: ProfileInput["fitness_goal"][] = ["prise de masse", "sèche", "maintien"];

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut, setUser } = useAuth();

  const [goalOpen, setGoalOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [mealsOpen, setMealsOpen] = useState(false);

  const [goal, setGoal] = useState(String(user?.calorie_goal ?? 2000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Health form
  const [sex, setSex] = useState<ProfileInput["sex"]>(user?.sex ?? "homme");
  const [age, setAge] = useState(user?.age ? String(user.age) : "");
  const [height, setHeight] = useState(user?.height_cm ? String(user.height_cm) : "");
  const [weight, setWeight] = useState(user?.weight_kg ? String(user.weight_kg) : "");
  const [activity, setActivity] = useState<ProfileInput["activity_level"]>(user?.activity_level ?? "modéré");
  const [fitnessGoal, setFitnessGoal] = useState<ProfileInput["fitness_goal"]>(user?.fitness_goal ?? "maintien");

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
      setGoalOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveHealth = async () => {
    setError(null);
    const a = parseInt(age, 10);
    const h = parseFloat(height.replace(",", "."));
    const w = parseFloat(weight.replace(",", "."));
    if (Number.isNaN(a) || a < 10 || a > 100) return setError("Âge entre 10 et 100");
    if (Number.isNaN(h) || h < 120 || h > 230) return setError("Taille entre 120 et 230 cm");
    if (Number.isNaN(w) || w < 30 || w > 250) return setError("Poids entre 30 et 250 kg");
    setSaving(true);
    try {
      const u = await api.updateProfile({
        sex,
        age: a,
        height_cm: h,
        weight_kg: w,
        activity_level: activity,
        fitness_goal: fitnessGoal,
      });
      setUser(u);
      setHealthOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const hasProfile = !!(user?.sex && user?.age && user?.height_cm && user?.weight_kg);

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

  const Chip = ({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID?: string }) => (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
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

        <Text style={styles.section}>Profil santé</Text>
        {!hasProfile ? (
          <Pressable
            style={styles.hint}
            onPress={() => setHealthOpen(true)}
            testID="profile-health-hint"
          >
            <Ionicons name="information-circle" size={20} color={colors.brandPrimary} />
            <Text style={styles.hintTxt}>
              Renseignez votre profil pour calculer automatiquement votre besoin calorique quotidien.
            </Text>
          </Pressable>
        ) : null}

        <Row
          icon="body-outline"
          label="Sexe · Âge · Taille · Poids"
          value={hasProfile ? `${user!.sex} · ${user!.age} ans · ${user!.height_cm} cm · ${user!.weight_kg} kg` : "Non renseigné"}
          onPress={() => setHealthOpen(true)}
          testID="profile-health-row"
        />
        <Row
          icon="walk-outline"
          label="Niveau d'activité"
          value={user?.activity_level ?? "Non renseigné"}
          onPress={() => setHealthOpen(true)}
        />
        <Row
          icon="trophy-outline"
          label="Objectif"
          value={user?.fitness_goal ?? "Non renseigné"}
          onPress={() => setHealthOpen(true)}
        />

        <Text style={styles.section}>Objectif calorique</Text>
        <Row
          icon="flame-outline"
          label={user?.calorie_goal_auto === false ? "Objectif quotidien (manuel)" : "Objectif quotidien (calculé)"}
          value={`${user?.calorie_goal ?? 2000} kcal`}
          onPress={() => { setGoal(String(user?.calorie_goal ?? 2000)); setGoalOpen(true); }}
          testID="profile-goal-row"
        />
        <Row
          icon="restaurant-outline"
          label="Nombre de repas par jour"
          value={`${user?.meals_per_day ?? 4} repas · ~${Math.round((user?.calorie_goal ?? 2000) / (user?.meals_per_day ?? 4))} kcal/repas`}
          onPress={() => setMealsOpen(true)}
          testID="profile-meals-row"
        />

        <Text style={styles.section}>Compte</Text>
        <Row icon="mail-outline" label="Email" value={user?.email} />
        <Row icon="calendar-outline" label="Membre depuis" value={user?.created_at ? new Date(user.created_at).toLocaleDateString("fr-FR") : ""} />

        <Pressable style={styles.logout} onPress={doLogout} testID="profile-logout">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutTxt}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>

      {/* Manual calorie override */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>Objectif quotidien</Text>
              <Text style={styles.modalSub}>{"Modifie manuellement l'objectif calculé."}</Text>
              <Input label="Calories (kcal)" keyboardType="numeric" value={goal} onChangeText={setGoal} testID="profile-goal-input" />
              {error ? <Text style={{ color: colors.error, textAlign: "center" }}>{error}</Text> : null}
              <Button title="Enregistrer" onPress={saveGoal} loading={saving} testID="profile-goal-save" />
              <Pressable onPress={() => setGoalOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Health profile */}
      <Modal visible={healthOpen} transparent animationType="slide" onRequestClose={() => setHealthOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%", maxHeight: "92%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>Profil santé</Text>
              <Text style={styles.modalSub}>
                Utilisé pour calculer automatiquement vos calories quotidiennes (Mifflin-St Jeor).
              </Text>
              <ScrollView style={{ maxHeight: 520 }}>
                <Text style={styles.subLabel}>Sexe</Text>
                <View style={styles.chipsRow}>
                  {SEXES.map((s) => (
                    <Chip key={s} active={sex === s} label={s} onPress={() => setSex(s)} testID={`profile-sex-${s}`} />
                  ))}
                </View>

                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Input label="Âge (ans)" keyboardType="numeric" value={age} onChangeText={setAge} testID="profile-age" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label="Taille (cm)" keyboardType="decimal-pad" value={height} onChangeText={setHeight} testID="profile-height" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label="Poids (kg)" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} testID="profile-weight" />
                  </View>
                </View>

                <Text style={styles.subLabel}>{"Niveau d'activité"}</Text>
                <View style={styles.chipsRow}>
                  {ACTIVITIES.map((a) => (
                    <Chip key={a} active={activity === a} label={a} onPress={() => setActivity(a)} testID={`profile-activity-${a}`} />
                  ))}
                </View>

                <Text style={styles.subLabel}>Objectif</Text>
                <View style={styles.chipsRow}>
                  {GOALS.map((g) => (
                    <Chip key={g} active={fitnessGoal === g} label={g} onPress={() => setFitnessGoal(g)} testID={`profile-fitness-${g}`} />
                  ))}
                </View>
              </ScrollView>
              {error ? <Text style={{ color: colors.error, textAlign: "center", marginBottom: spacing.sm }}>{error}</Text> : null}
              <Button title="Calculer et enregistrer" onPress={saveHealth} loading={saving} testID="profile-health-save" />
              <Pressable onPress={() => setHealthOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      {/* Meals per day */}
      <Modal visible={mealsOpen} transparent animationType="slide" onRequestClose={() => setMealsOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.drag} />
            <Text style={styles.modalTitle}>Nombre de repas par jour</Text>
            <Text style={styles.rowValue}>
              Vos {user?.calorie_goal ?? 2000} kcal seront divisées en portions égales.
            </Text>
            <View style={[styles.chipsRow, { marginTop: spacing.md }]}>
              {[2, 3, 4, 5, 6].map((n) => (
                <Pressable
                  key={n}
                  onPress={async () => {
                    try {
                      const u = await api.updateMealsPerDay(n);
                      setUser(u);
                      setMealsOpen(false);
                    } catch {}
                  }}
                  style={[styles.chip, user?.meals_per_day === n && styles.chipActive]}
                  testID={`profile-meals-${n}`}
                >
                  <Text style={[styles.chipTxt, user?.meals_per_day === n && styles.chipTxtActive]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setMealsOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
              <Text style={{ color: colors.onSurfaceSecondary }}>Fermer</Text>
            </Pressable>
          </View>
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
  hint: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  hintTxt: { flex: 1, fontSize: font.sm, color: colors.onBrandTertiary },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: font.base, color: colors.onSurface },
  rowValue: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2, textTransform: "capitalize" },
  logout: {
    marginTop: spacing.xxl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
  },
  logoutTxt: { color: colors.error, fontSize: font.lg },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xxxl },
  drag: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.xs, fontWeight: "500" },
  modalSub: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  subLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, marginBottom: spacing.xs, marginLeft: spacing.xs },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTxt: { fontSize: font.sm, color: colors.onSurface, textTransform: "capitalize" },
  chipTxtActive: { color: colors.onBrandPrimary },
});
