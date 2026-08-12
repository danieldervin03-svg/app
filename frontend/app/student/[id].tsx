import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input, EmptyState } from "@/src/components/ui";
import { api } from "@/src/api";

type TodayData = Awaited<ReturnType<typeof api.coachStudentToday>>;
type HistoryData = Awaited<ReturnType<typeof api.coachStudentHistory>>;

const LEVELS: { key: "débutant" | "intermédiaire" | "avancé"; label: string }[] = [
  { key: "débutant", label: "Débutant" },
  { key: "intermédiaire", label: "Intermédiaire" },
  { key: "avancé", label: "Avancé" },
];

export default function StudentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [today, setToday] = useState<TodayData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  const [genOpen, setGenOpen] = useState(false);
  const [genGoal, setGenGoal] = useState("Prise de force générale");
  const [genLevel, setGenLevel] = useState<"débutant" | "intermédiaire" | "avancé">("intermédiaire");
  const [genDuration, setGenDuration] = useState("45");
  const [genEquipment, setGenEquipment] = useState("Salle de sport");
  const [genSaving, setGenSaving] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [goalOpen, setGoalOpen] = useState(false);
  const [goalCalories, setGoalCalories] = useState("");
  const [goalProtein, setGoalProtein] = useState("");
  const [goalCarbs, setGoalCarbs] = useState("");
  const [goalFat, setGoalFat] = useState("");
  const [goalFiber, setGoalFiber] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [t, h] = await Promise.all([api.coachStudentToday(id), api.coachStudentHistory(id)]);
      setToday(t);
      setHistory(h);
      setGoalCalories(String(t.nutrition.calorie_goal));
    } catch {} finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generateWorkout = async () => {
    if (!id) return;
    setGenError(null);
    setGenSaving(true);
    try {
      await api.coachAssignGeneratedWorkout(id, {
        goal: genGoal,
        level: genLevel,
        duration_minutes: parseInt(genDuration, 10) || 45,
        equipment: genEquipment,
      });
      setGenOpen(false);
      await load();
    } catch (e: any) {
      setGenError(e.message ?? "Impossible de générer le programme");
    } finally {
      setGenSaving(false);
    }
  };

  const saveGoal = async () => {
    if (!id) return;
    setGoalError(null);
    const n = parseInt(goalCalories, 10);
    if (Number.isNaN(n) || n < 800 || n > 8000) {
      setGoalError("Entrez une valeur entre 800 et 8000");
      return;
    }
    setGoalSaving(true);
    try {
      await api.coachSetStudentNutritionGoal(id, {
        calorie_goal: n,
        protein_goal_g: goalProtein.trim() ? parseFloat(goalProtein.replace(",", ".")) : undefined,
        carbs_goal_g: goalCarbs.trim() ? parseFloat(goalCarbs.replace(",", ".")) : undefined,
        fat_goal_g: goalFat.trim() ? parseFloat(goalFat.replace(",", ".")) : undefined,
        fiber_goal_g: goalFiber.trim() ? parseFloat(goalFiber.replace(",", ".")) : undefined,
      });
      setGoalOpen(false);
      await load();
    } catch (e: any) {
      setGoalError(e.message ?? "Impossible d'enregistrer l'objectif");
    } finally {
      setGoalSaving(false);
    }
  };

  if (loading || !today) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const n = today.nutrition;
  const pct = n.calorie_goal > 0 ? Math.min(1, n.calories_consumed / n.calorie_goal) : 0;

  return (
    <SafeAreaView style={styles.container} testID="student-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="student-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{today.student.name}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionH}>Aujourd'hui — Nutrition</Text>
        <View style={styles.nutriCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.nutriBig}>{n.calories_consumed} kcal</Text>
            <Text style={styles.nutriGoal}>/ {n.calorie_goal} kcal</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: pct > 1 ? colors.error : colors.brandPrimary }]} />
          </View>
          <View style={styles.macroRow}>
            <Text style={styles.macroTxt}><Text style={{ color: "#FB7185", fontWeight: "700" }}>P</Text> {n.protein_consumed_g}/{n.protein_goal_g}g</Text>
            <Text style={styles.macroTxt}><Text style={{ color: "#FBBF24", fontWeight: "700" }}>G</Text> {n.carbs_consumed_g}/{n.carbs_goal_g}g</Text>
            <Text style={styles.macroTxt}><Text style={{ color: "#60A5FA", fontWeight: "700" }}>L</Text> {n.fat_consumed_g}/{n.fat_goal_g}g</Text>
            <Text style={styles.macroTxt}><Text style={{ color: "#34D399", fontWeight: "700" }}>F</Text> {n.fiber_consumed_g}/{n.fiber_goal_g}g</Text>
          </View>
          {n.meals.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              {n.meals.map((m, i) => (
                <Text key={i} style={styles.mealLine}>• {m.name} — {m.calories} kcal</Text>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyTxt}>Aucun repas enregistré aujourd'hui</Text>
          )}
        </View>

        <Text style={styles.sectionH}>Aujourd'hui — Entraînement</Text>
        <View style={styles.workoutCard}>
          {today.workouts_today.completed.length === 0 && today.workouts_today.in_progress.length === 0 ? (
            <Text style={styles.emptyTxt}>Aucune séance validée aujourd'hui</Text>
          ) : (
            <>
              {today.workouts_today.completed.map((w) => (
                <View key={w.id} style={styles.workoutLine}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.brandPrimary} />
                  <Text style={styles.workoutTxt}>{w.title} — terminée</Text>
                </View>
              ))}
              {today.workouts_today.in_progress.map((w) => (
                <View key={w.id} style={styles.workoutLine}>
                  <Ionicons name="time-outline" size={16} color={colors.warning} />
                  <Text style={styles.workoutTxt}>{w.title} — en cours</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={styles.sectionH}>Assigner</Text>
        <Pressable style={styles.assignBtn} onPress={() => setGenOpen(true)} testID="student-assign-workout">
          <Ionicons name="sparkles" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.assignBtnTxt}>Générer un programme IA</Text>
        </Pressable>
        <Pressable style={[styles.assignBtn, styles.assignBtnAlt]} onPress={() => setGoalOpen(true)} testID="student-assign-goal">
          <Ionicons name="flag-outline" size={18} color={colors.brandPrimary} />
          <Text style={[styles.assignBtnTxt, { color: colors.brandPrimary }]}>Définir l'objectif nutritionnel</Text>
        </Pressable>

        <Text style={styles.sectionH}>Historique récent</Text>
        {!history || history.workouts.length === 0 ? (
          <EmptyState title="Aucune séance réalisée" subtitle="L'historique apparaîtra ici." testID="student-history-empty" />
        ) : (
          history.workouts.slice(0, 10).map((w) => (
            <View key={w.id} style={styles.histRow}>
              <Text style={styles.histTitle}>{w.title}</Text>
              <Text style={styles.histSub}>
                {new Date(w.performed_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · {w.exercises_count} exercices
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Generate workout modal */}
      <Modal visible={genOpen} transparent animationType="slide" onRequestClose={() => setGenOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Générer un programme</Text>
              <Input label="Objectif" value={genGoal} onChangeText={setGenGoal} testID="gen-goal-input" />
              <Text style={styles.fieldLabel}>Niveau</Text>
              <View style={styles.chipRow}>
                {LEVELS.map((l) => (
                  <Pressable
                    key={l.key}
                    onPress={() => setGenLevel(l.key)}
                    style={[styles.chip, genLevel === l.key && styles.chipActive]}
                  >
                    <Text style={[styles.chipTxt, genLevel === l.key && styles.chipTxtActive]}>{l.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Input label="Durée (minutes)" keyboardType="number-pad" value={genDuration} onChangeText={setGenDuration} />
              <Input label="Équipement disponible" value={genEquipment} onChangeText={setGenEquipment} />
              {genError ? <Text style={styles.err}>{genError}</Text> : null}
              <Button title="Générer et assigner" onPress={generateWorkout} loading={genSaving} testID="gen-submit" />
              <Pressable onPress={() => setGenOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Nutrition goal modal */}
      <Modal visible={goalOpen} transparent animationType="slide" onRequestClose={() => setGoalOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Objectif nutritionnel</Text>
              <Input label="Calories cibles" keyboardType="number-pad" value={goalCalories} onChangeText={setGoalCalories} testID="goal-calories-input" />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Protéines (g)" placeholder="Auto" keyboardType="decimal-pad" value={goalProtein} onChangeText={setGoalProtein} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Glucides (g)" placeholder="Auto" keyboardType="decimal-pad" value={goalCarbs} onChangeText={setGoalCarbs} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Lipides (g)" placeholder="Auto" keyboardType="decimal-pad" value={goalFat} onChangeText={setGoalFat} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Fibres (g)" placeholder="Auto" keyboardType="decimal-pad" value={goalFiber} onChangeText={setGoalFiber} />
                </View>
              </View>
              {goalError ? <Text style={styles.err}>{goalError}</Text> : null}
              <Button title="Enregistrer" onPress={saveGoal} loading={goalSaving} testID="goal-submit" />
              <Pressable onPress={() => setGoalOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
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
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  sectionH: { fontSize: font.lg, color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  nutriCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  rowBetween: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  nutriBig: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "700" },
  nutriGoal: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: 4 },
  progressTrack: { height: 8, backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.sm },
  progressFill: { height: "100%", borderRadius: radius.pill },
  macroRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.md },
  macroTxt: { fontSize: font.sm, color: colors.onSurface },
  mealLine: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 4 },
  emptyTxt: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, fontStyle: "italic" },
  workoutCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  workoutLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  workoutTxt: { fontSize: font.sm, color: colors.onSurface },
  assignBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  assignBtnAlt: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandPrimary },
  assignBtnTxt: { color: colors.onBrandPrimary, fontSize: font.base, fontWeight: "500" },
  histRow: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  histTitle: { fontSize: font.base, color: colors.onSurface, fontWeight: "500" },
  histSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxxl,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
  fieldLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTxt: { fontSize: font.sm, color: colors.onSurface },
  chipTxtActive: { color: colors.onBrandPrimary },
  err: { color: colors.error, textAlign: "center", marginBottom: spacing.sm },
});
