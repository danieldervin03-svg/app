import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { api, Exercise } from "@/src/api";

type Draft = {
  name: string;
  sets: string;
  reps: string;
  rest_seconds: string;
  target_weight_kg: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  name: "", sets: "3", reps: "10", rest_seconds: "60", target_weight_kg: "", notes: "",
});

const toDraft = (e: Exercise): Draft => ({
  name: e.name,
  sets: String(e.sets),
  reps: e.reps,
  rest_seconds: String(e.rest_seconds),
  target_weight_kg: e.target_weight_kg != null ? String(e.target_weight_kg) : "",
  notes: e.notes ?? "",
});

export default function StudentWorkoutForm() {
  const router = useRouter();
  const { studentId, workoutId } = useLocalSearchParams<{ studentId: string; workoutId?: string }>();
  const isEdit = !!workoutId;

  const [loading, setLoading] = useState(isEdit);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !studentId || !workoutId) return;
    api.coachGetStudentWorkout(studentId, workoutId)
      .then((wk) => {
        setTitle(wk.title);
        setDescription(wk.description ?? "");
        setDrafts(wk.exercises.length > 0 ? wk.exercises.map(toDraft) : [emptyDraft()]);
      })
      .catch(() => setError("Impossible de charger cette séance"))
      .finally(() => setLoading(false));
  }, [isEdit, studentId, workoutId]);

  const updateDraft = (idx: number, field: keyof Draft, value: string) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d)));
  };
  const addRow = () => setDrafts((p) => [...p, emptyDraft()]);
  const removeRow = (idx: number) => setDrafts((p) => p.filter((_, i) => i !== idx));

  const save = async () => {
    if (!studentId) return;
    setError(null);
    if (!title.trim()) return setError("Donnez un titre à la séance");
    const parsed: Exercise[] = [];
    for (const d of drafts) {
      if (!d.name.trim()) continue;
      const tw = parseFloat(d.target_weight_kg.replace(",", "."));
      parsed.push({
        id: Math.random().toString(36).slice(2),
        name: d.name.trim(),
        sets: parseInt(d.sets, 10) || 3,
        reps: d.reps.trim() || "10",
        rest_seconds: parseInt(d.rest_seconds, 10) || 60,
        notes: d.notes.trim(),
        target_weight_kg: Number.isFinite(tw) ? tw : null,
      });
    }
    if (parsed.length === 0) return setError("Ajoutez au moins un exercice");
    setSaving(true);
    try {
      if (isEdit && workoutId) {
        await api.coachUpdateStudentWorkout(studentId, workoutId, {
          title: title.trim(), description: description.trim(), exercises: parsed,
        });
      } else {
        await api.coachAssignWorkout(studentId, {
          title: title.trim(), description: description.trim(), exercises: parsed,
        });
      }
      router.back();
    } catch (e: any) {
      setError(e.message ?? "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="student-workout-form">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="form-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEdit ? "Modifier la séance" : "Nouvelle séance"}</Text>
        <View style={styles.iconBtn} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Input label="Titre de la séance" placeholder="Ex : Séance push" value={title} onChangeText={setTitle} testID="form-title" />
          <Input label="Description (facultatif)" placeholder="Ex : pecs, épaules, triceps" value={description} onChangeText={setDescription} testID="form-description" />

          <View style={styles.sectionRow}>
            <Text style={styles.sectionH}>Exercices</Text>
            <Pressable onPress={addRow} style={styles.addBtn} testID="form-add-exercise">
              <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
            </Pressable>
          </View>

          {drafts.map((d, idx) => (
            <View key={idx} style={styles.exCard} testID={`form-ex-${idx}`}>
              <View style={styles.exHead}>
                <Text style={styles.exNum}>Exercice {idx + 1}</Text>
                {drafts.length > 1 ? (
                  <Pressable onPress={() => removeRow(idx)} style={styles.miniBtn} testID={`form-ex-remove-${idx}`}>
                    <Ionicons name="close" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
              <Input label="Nom" placeholder="Ex : Développé couché" value={d.name} onChangeText={(v) => updateDraft(idx, "name", v)} />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Séries" keyboardType="numeric" value={d.sets} onChangeText={(v) => updateDraft(idx, "sets", v)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Reps" value={d.reps} onChangeText={(v) => updateDraft(idx, "reps", v)} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Poids cible (kg, facultatif)" keyboardType="decimal-pad" value={d.target_weight_kg} onChangeText={(v) => updateDraft(idx, "target_weight_kg", v)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Repos (s)" keyboardType="numeric" value={d.rest_seconds} onChangeText={(v) => updateDraft(idx, "rest_seconds", v)} />
                </View>
              </View>
              <Input label="Notes (facultatif)" value={d.notes} onChangeText={(v) => updateDraft(idx, "notes", v)} />
            </View>
          ))}

          {error ? <Text style={styles.err}>{error}</Text> : null}
          <Button title="Enregistrer" onPress={save} loading={saving} testID="form-save" style={{ marginTop: spacing.md }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: font.lg, color: colors.onSurface, fontWeight: "500", textAlign: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md, marginBottom: spacing.sm },
  sectionH: { fontSize: font.xl, color: colors.onSurface, fontWeight: "500" },
  addBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  exCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
  },
  exHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  exNum: { fontSize: font.base, color: colors.onSurfaceSecondary, fontWeight: "500" },
  miniBtn: { padding: spacing.xs },
  err: { color: colors.error, textAlign: "center" },
});
