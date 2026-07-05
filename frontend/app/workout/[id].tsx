import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { CoachChat } from "@/src/components/coach-chat";
import { api, Deload, Exercise, ExerciseHistoryPoint, LogEntry, Workout } from "@/src/api";

type Difficulty = "facile" | "reussi" | "echec";
const DIFFICULTIES: { key: Difficulty; label: string; color: string; icon: any }[] = [
  { key: "facile", label: "Facile", color: "#65A30D", icon: "arrow-up" },
  { key: "reussi", label: "Réussi", color: "#0891B2", icon: "checkmark" },
  { key: "echec", label: "Échec", color: "#DC2626", icon: "arrow-down" },
];

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [coachOpen, setCoachOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logSaving, setLogSaving] = useState(false);
  const [logEntries, setLogEntries] = useState<Record<string, LogEntry>>({});
  const [deloads, setDeloads] = useState<Deload[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyExName, setHistoryExName] = useState<string>("");
  const [historyPoints, setHistoryPoints] = useState<ExerciseHistoryPoint[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [name, setName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [weight, setWeightField] = useState("");
  const [rest, setRest] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const w = await api.getWorkout(id as string);
      setWorkout(w);
    } catch {}
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null); setName(""); setSets("3"); setReps("10"); setWeightField(""); setRest("60"); setNotes("");
    setEditOpen(true);
  };
  const openEdit = (ex: Exercise) => {
    setEditing(ex);
    setName(ex.name); setSets(String(ex.sets)); setReps(ex.reps);
    setWeightField(ex.target_weight_kg != null ? String(ex.target_weight_kg) : "");
    setRest(String(ex.rest_seconds)); setNotes(ex.notes);
    setEditOpen(true);
  };

  const saveExercise = async () => {
    if (!workout) return;
    if (!name.trim()) return;
    setSaving(true);
    const parsedWeight = parseFloat(weight.replace(",", "."));
    const next: Exercise = {
      id: editing?.id ?? Math.random().toString(36).slice(2),
      name: name.trim(),
      sets: parseInt(sets, 10) || 3,
      reps: reps.trim() || "10",
      rest_seconds: parseInt(rest, 10) || 60,
      notes: notes.trim(),
      target_weight_kg: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : null,
      // preserve progression history when editing
      last_difficulty: editing?.last_difficulty ?? null,
      last_weight_kg: editing?.last_weight_kg ?? null,
      last_reps_done: editing?.last_reps_done ?? null,
    };
    const updated = editing
      ? workout.exercises.map((e) => (e.id === editing.id ? next : e))
      : [...workout.exercises, next];
    try {
      const w = await api.updateWorkout(workout.id, { exercises: updated });
      setWorkout(w);
      setEditOpen(false);
    } catch {} finally { setSaving(false); }
  };

  const removeExercise = async (exId: string) => {
    if (!workout) return;
    const next = workout.exercises.filter((e) => e.id !== exId);
    try {
      const w = await api.updateWorkout(workout.id, { exercises: next });
      setWorkout(w);
    } catch {}
  };

  const openLog = () => {
    if (!workout) return;
    const init: Record<string, LogEntry> = {};
    workout.exercises.forEach((ex) => {
      init[ex.id] = {
        exercise_id: ex.id,
        difficulty: "reussi",
        weight_kg: ex.target_weight_kg ?? null,
      };
    });
    setLogEntries(init);
    setLogOpen(true);
  };

  const setDifficulty = (exId: string, d: Difficulty) => {
    setLogEntries((prev) => ({
      ...prev,
      [exId]: { ...prev[exId], difficulty: d },
    }));
  };

  const setWeight = (exId: string, txt: string) => {
    const n = parseFloat(txt.replace(",", "."));
    setLogEntries((prev) => ({
      ...prev,
      [exId]: { ...prev[exId], weight_kg: Number.isFinite(n) ? n : null },
    }));
  };

  const submitLog = async () => {
    if (!workout) return;
    setLogSaving(true);
    try {
      const entries = Object.values(logEntries);
      const res = await api.logSession(workout.id, entries);
      setWorkout(res.workout);
      setDeloads(res.deloads);
      setLogOpen(false);
    } catch {} finally {
      setLogSaving(false);
    }
  };

  const openHistory = async (exName: string) => {
    setHistoryExName(exName);
    setHistoryOpen(true);
    try {
      const res = await api.exerciseHistory(exName);
      setHistoryPoints(res.points);
    } catch {
      setHistoryPoints([]);
    }
  };

  const deleteWorkout = async () => {
    if (!workout) return;
    Alert.alert("Supprimer", `Supprimer "${workout.title}" ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          await api.deleteWorkout(workout.id).catch(() => {});
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }
  if (!workout) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ padding: spacing.xl }}>Entraînement introuvable.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="workout-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="workout-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{workout.title}</Text>
        <Pressable onPress={deleteWorkout} style={styles.iconBtn} testID="workout-delete">
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {workout.description ? <Text style={styles.desc}>{workout.description}</Text> : null}
        <Text style={styles.meta}>
          {workout.exercises.length} exercices · {workout.performed_at ? "Terminé le " + new Date(workout.performed_at).toLocaleDateString("fr-FR") : "Non effectué"}
        </Text>

        <View style={styles.actionsRow}>
          <Button
            title={workout.performed_at ? "Refaire la séance" : "Terminer la séance"}
            onPress={openLog}
            testID="workout-log-open"
            variant="primary"
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => setCoachOpen(true)}
            style={styles.coachBtn}
            testID="workout-coach-open"
          >
            <Ionicons name="sparkles" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.coachBtnTxt}>Coach IA</Text>
          </Pressable>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionH}>Exercices</Text>
          <Pressable onPress={openAdd} style={styles.addBtn} testID="workout-add-exercise">
            <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        {deloads.length > 0 ? (
          <View style={styles.deloadBanner} testID="deload-banner">
            <View style={styles.deloadIcon}>
              <Ionicons name="warning" size={16} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.deloadTitle}>Deload appliqué</Text>
              {deloads.map((d) => (
                <Text key={d.exercise_id} style={styles.deloadTxt}>
                  {d.exercise_name} : {d.new_target_weight_kg} kg (−10 %)
                </Text>
              ))}
            </View>
            <Pressable onPress={() => setDeloads([])}>
              <Ionicons name="close" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        ) : null}

        {workout.exercises.map((ex) => {
          const diffMeta = ex.last_difficulty
            ? DIFFICULTIES.find((d) => d.key === ex.last_difficulty)
            : null;
          return (
            <View key={ex.id} style={styles.exRow} testID={`exercise-${ex.id}`}>
              <Pressable onPress={() => openHistory(ex.name)} style={styles.exIcon} testID={`ex-history-${ex.id}`}>
                <Ionicons name="trending-up-outline" size={18} color={colors.onBrandTertiary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <View style={styles.exTopRow}>
                  <Pressable onPress={() => openHistory(ex.name)} style={{ flex: 1 }}>
                    <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                  </Pressable>
                  {diffMeta ? (
                    <View style={[styles.diffPill, { backgroundColor: diffMeta.color + "22" }]}>
                      <Ionicons name={diffMeta.icon} size={10} color={diffMeta.color} />
                      <Text style={[styles.diffPillTxt, { color: diffMeta.color }]}>{diffMeta.label}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.exSub}>
                  {ex.sets} séries × {ex.reps}
                  {ex.target_weight_kg ? ` · ${ex.target_weight_kg} kg` : ""}
                  {" · repos "}{ex.rest_seconds}s
                </Text>
                {ex.notes ? <Text style={styles.exNote}>{ex.notes}</Text> : null}
              </View>
              <Pressable onPress={() => openEdit(ex)} style={styles.miniBtn} testID={`exercise-edit-${ex.id}`}>
                <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
              </Pressable>
              <Pressable onPress={() => removeExercise(ex.id)} style={styles.miniBtn} testID={`exercise-delete-${ex.id}`}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          );
        })}

        {workout.exercises.length === 0 ? (
          <Text style={styles.emptyEx}>Ajoutez votre premier exercice.</Text>
        ) : null}
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>{editing ? "Modifier l'exercice" : "Nouvel exercice"}</Text>
              <Input label="Nom" placeholder="Ex : Squat" value={name} onChangeText={setName} testID="ex-name-input" />
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Input label="Séries" keyboardType="numeric" value={sets} onChangeText={setSets} testID="ex-sets-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Reps" value={reps} onChangeText={setReps} testID="ex-reps-input" />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Input label="Poids (kg)" keyboardType="decimal-pad" value={weight} onChangeText={setWeightField} testID="ex-weight-input" placeholder="—" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Repos (s)" keyboardType="numeric" value={rest} onChangeText={setRest} testID="ex-rest-input" />
                </View>
              </View>
              <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="ex-notes-input" />
              <Button title="Enregistrer" onPress={saveExercise} loading={saving} testID="ex-save" />
              <Pressable onPress={() => setEditOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Session log modal - progressive overload */}
      <Modal visible={logOpen} animationType="slide" onRequestClose={() => setLogOpen(false)} presentationStyle="pageSheet">
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Pressable onPress={() => setLogOpen(false)} style={styles.iconBtn} testID="log-close">
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.headerTitle}>Bilan de séance</Text>
            <View style={styles.iconBtn} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
            <Text style={styles.logIntro}>
              Notez la difficulté de chaque exercice. L{"'"}IA ajustera automatiquement les charges pour la prochaine séance (surcharge progressive).
            </Text>
            {workout.exercises.map((ex) => {
              const entry = logEntries[ex.id];
              return (
                <View key={ex.id} style={styles.logCard} testID={`log-ex-${ex.id}`}>
                  <Text style={styles.logExName}>{ex.name}</Text>
                  <Text style={styles.logExSub}>
                    Cible : {ex.sets}×{ex.reps}{ex.target_weight_kg ? ` @ ${ex.target_weight_kg} kg` : ""}
                  </Text>
                  {ex.target_weight_kg != null ? (
                    <Input
                      label="Poids soulevé (kg)"
                      keyboardType="decimal-pad"
                      value={entry?.weight_kg != null ? String(entry.weight_kg) : ""}
                      onChangeText={(t) => setWeight(ex.id, t)}
                      testID={`log-weight-${ex.id}`}
                    />
                  ) : null}
                  <View style={styles.diffRow}>
                    {DIFFICULTIES.map((d) => {
                      const active = entry?.difficulty === d.key;
                      return (
                        <Pressable
                          key={d.key}
                          onPress={() => setDifficulty(ex.id, d.key)}
                          style={[
                            styles.diffBtn,
                            active && { backgroundColor: d.color, borderColor: d.color },
                          ]}
                          testID={`log-diff-${ex.id}-${d.key}`}
                        >
                          <Ionicons name={d.icon} size={14} color={active ? "#FFF" : d.color} />
                          <Text style={[styles.diffBtnTxt, active && { color: "#FFF" }]}>{d.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <Button
              title="Enregistrer et ajuster"
              onPress={submitLog}
              loading={logSaving}
              testID="log-submit"
              style={{ marginTop: spacing.md }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <CoachChat
        visible={coachOpen}
        onClose={() => setCoachOpen(false)}
        workoutId={workout.id}
        title={`Coach · ${workout.title}`}
      />

      {/* Exercise history chart modal */}
      <Modal visible={historyOpen} animationType="slide" onRequestClose={() => setHistoryOpen(false)} presentationStyle="pageSheet">
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Pressable onPress={() => setHistoryOpen(false)} style={styles.iconBtn} testID="history-close">
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>{historyExName}</Text>
            <View style={styles.iconBtn} />
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            {historyPoints.length === 0 ? (
              <Text style={styles.emptyEx}>Aucun historique pour cet exercice</Text>
            ) : (
              <>
                <Text style={styles.logIntro}>
                  {historyPoints.length} séance{historyPoints.length > 1 ? "s" : ""} enregistrée{historyPoints.length > 1 ? "s" : ""}
                </Text>
                {(() => {
                  const weightsPts = historyPoints.filter((p) => p.weight_kg != null);
                  if (weightsPts.length < 2) {
                    return <Text style={styles.emptyEx}>Ajoutez au moins 2 séances avec poids pour voir la courbe.</Text>;
                  }
                  const vals = weightsPts.map((p) => p.weight_kg as number);
                  const max = Math.max(...vals);
                  const min = Math.min(...vals);
                  const range = Math.max(0.5, max - min);
                  return (
                    <View style={styles.chartBox}>
                      {weightsPts.map((p, i) => {
                        const h = ((p.weight_kg as number) - min) / range;
                        const barColor = p.difficulty === "facile" ? "#65A30D"
                          : p.difficulty === "echec" ? "#DC2626"
                          : "#0891B2";
                        return (
                          <View key={i} style={styles.chartCol}>
                            <View style={[styles.chartBar, { height: 15 + h * 100, backgroundColor: barColor }]} />
                            <Text style={styles.chartVal}>{p.weight_kg}</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
                <Text style={styles.sectionH}>Détails</Text>
                {[...historyPoints].reverse().map((p, i) => (
                  <View key={i} style={styles.histLine} testID={`history-point-${i}`}>
                    <Text style={styles.histDate}>
                      {new Date(p.performed_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                    </Text>
                    <Text style={styles.histVal}>
                      {p.weight_kg ? `${p.weight_kg} kg` : "—"}
                      {p.reps_done ? ` × ${p.reps_done}` : ""}
                    </Text>
                    <Text style={styles.histDiff}>{p.difficulty ?? ""}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: font.lg, color: colors.onSurface, fontWeight: "500", textAlign: "center" },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  desc: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  meta: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginBottom: spacing.lg },
  actionsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  coachBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg, height: 52, borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  coachBtnTxt: { color: colors.onBrandPrimary, fontSize: font.base },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  sectionH: { fontSize: font.xl, color: colors.onSurface, fontWeight: "500" },
  addBtn: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  exRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
    minHeight: 56,
  },
  exIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  exName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  exTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  diffPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill,
  },
  diffPillTxt: { fontSize: 10, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.4 },
  logIntro: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.lg, lineHeight: 20 },
  logCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  logExName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  logExSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2, marginBottom: spacing.md },
  diffRow: { flexDirection: "row", gap: spacing.sm },
  diffBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  diffBtnTxt: { fontSize: font.sm, color: colors.onSurface, fontWeight: "500" },
  deloadBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, marginBottom: spacing.md,
    backgroundColor: "#FEF3C7", borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.warning,
  },
  deloadIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.warning, alignItems: "center", justifyContent: "center",
  },
  deloadTitle: { fontSize: font.base, color: "#78350F", fontWeight: "500" },
  deloadTxt: { fontSize: font.sm, color: "#78350F", marginTop: 2 },
  chartBox: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    gap: 4, height: 140, padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, marginBottom: spacing.lg,
  },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBar: { width: "70%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartVal: { fontSize: 9, color: colors.onSurfaceSecondary, marginTop: 4 },
  histLine: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  histDate: { flex: 1, fontSize: font.base, color: colors.onSurfaceSecondary },
  histVal: { fontSize: font.base, color: colors.onSurface, fontWeight: "500", marginHorizontal: spacing.sm },
  histDiff: { fontSize: font.sm, color: colors.onSurfaceTertiary, textTransform: "capitalize" },
  exSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  exNote: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 4, fontStyle: "italic" },
  miniBtn: { padding: spacing.sm },
  emptyEx: { textAlign: "center", color: colors.onSurfaceSecondary, marginTop: spacing.xl },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xxxl },
  drag: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
});
