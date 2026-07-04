import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { CoachChat } from "@/src/components/coach-chat";
import { api, Exercise, Workout } from "@/src/api";

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [coachOpen, setCoachOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [name, setName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
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
    setEditing(null); setName(""); setSets("3"); setReps("10"); setRest("60"); setNotes("");
    setEditOpen(true);
  };
  const openEdit = (ex: Exercise) => {
    setEditing(ex);
    setName(ex.name); setSets(String(ex.sets)); setReps(ex.reps);
    setRest(String(ex.rest_seconds)); setNotes(ex.notes);
    setEditOpen(true);
  };

  const saveExercise = async () => {
    if (!workout) return;
    if (!name.trim()) return;
    setSaving(true);
    const next: Exercise = {
      id: editing?.id ?? Math.random().toString(36).slice(2),
      name: name.trim(),
      sets: parseInt(sets, 10) || 3,
      reps: reps.trim() || "10",
      rest_seconds: parseInt(rest, 10) || 60,
      notes: notes.trim(),
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

  const complete = async () => {
    if (!workout) return;
    try {
      const w = await api.completeWorkout(workout.id);
      setWorkout(w);
    } catch {}
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
            title={workout.performed_at ? "Refaire" : "Marquer terminé"}
            onPress={complete}
            testID="workout-complete"
            variant={workout.performed_at ? "secondary" : "primary"}
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

        {workout.exercises.map((ex) => (
          <View key={ex.id} style={styles.exRow} testID={`exercise-${ex.id}`}>
            <View style={styles.exIcon}>
              <Ionicons name="fitness-outline" size={18} color={colors.onBrandTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.exName}>{ex.name}</Text>
              <Text style={styles.exSub}>{ex.sets} séries × {ex.reps} · repos {ex.rest_seconds}s</Text>
              {ex.notes ? <Text style={styles.exNote}>{ex.notes}</Text> : null}
            </View>
            <Pressable onPress={() => openEdit(ex)} style={styles.miniBtn} testID={`exercise-edit-${ex.id}`}>
              <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
            </Pressable>
            <Pressable onPress={() => removeExercise(ex.id)} style={styles.miniBtn} testID={`exercise-delete-${ex.id}`}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </Pressable>
          </View>
        ))}

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

      <CoachChat
        visible={coachOpen}
        onClose={() => setCoachOpen(false)}
        workoutId={workout.id}
        title={`Coach · ${workout.title}`}
      />
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
  exSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  exNote: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 4, fontStyle: "italic" },
  miniBtn: { padding: spacing.sm },
  emptyEx: { textAlign: "center", color: colors.onSurfaceSecondary, marginTop: spacing.xl },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xxxl },
  drag: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
});
