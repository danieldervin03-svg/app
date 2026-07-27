import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import Svg, { Path, Circle } from "react-native-svg";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { CoachChat } from "@/src/components/coach-chat";
import { api, Exercise, ExerciseHistoryPoint, LogEntry, Workout, getToken, getExerciseGifImageUrl } from "@/src/api";

type Difficulty = "facile" | "reussi" | "echec";
const DIFFICULTIES: { key: Difficulty; label: string; color: string; icon: any }[] = [
  { key: "facile", label: "Facile", color: "#65A30D", icon: "arrow-up" },
  { key: "reussi", label: "Réussi", color: "#0891B2", icon: "checkmark" },
  { key: "echec", label: "Échec", color: "#DC2626", icon: "arrow-down" },
];

type ChartPoint = { x: number; y: number };

function smoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function buildSeries(values: number[], width: number, height: number, padY = 16): ChartPoint[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [{ x: width / 2, y: height / 2 }];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.5, max - min);
  const stepX = width / (values.length - 1);
  return values.map((v, i) => {
    const norm = (v - min) / range; // 0..1
    const y = height - padY - norm * (height - padY * 2);
    return { x: i * stepX, y };
  });
}

export default function WorkoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [coachOpen, setCoachOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logSaving, setLogSaving] = useState(false);
  const [logEntries, setLogEntries] = useState<Record<string, LogEntry>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyExName, setHistoryExName] = useState<string>("");
  const [historyPoints, setHistoryPoints] = useState<ExerciseHistoryPoint[]>([]);

  const [gifOpen, setGifOpen] = useState(false);
  const [gifExName, setGifExName] = useState("");
  const [gifLoading, setGifLoading] = useState(false);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifFound, setGifFound] = useState(true);
  const [gifLoadError, setGifLoadError] = useState(false);
  const [gifAuthHeader, setGifAuthHeader] = useState<{ Authorization: string } | null>(null);

  const [validatingExId, setValidatingExId] = useState<string | null>(null);
  const [draftDifficulty, setDraftDifficulty] = useState<Difficulty>("reussi");
  const [draftWeight, setDraftWeight] = useState<number | null>(null);
  const [draftReps, setDraftReps] = useState<number | null>(null);
  const [validateSaving, setValidateSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [titleEditOpen, setTitleEditOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
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

  const parseFirstInt = (s: string): number | null => {
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  };

  const openValidate = (ex: Exercise) => {
    setValidatingExId(ex.id);
    setDraftDifficulty((ex.last_difficulty as Difficulty) ?? "reussi");
    setDraftWeight(ex.last_weight_kg ?? ex.target_weight_kg ?? null);
    setDraftReps(ex.last_reps_done ?? parseFirstInt(ex.reps));
  };

  const cancelValidate = () => setValidatingExId(null);

  const bumpWeight = (delta: number) => setDraftWeight((prev) => Math.max(0, (prev ?? 0) + delta));
  const bumpReps = (delta: number) => setDraftReps((prev) => Math.max(0, (prev ?? 0) + delta));

  const confirmValidate = async () => {
    if (!workout || !validatingExId) return;
    setValidateSaving(true);
    try {
      const res = await api.logExercise(workout.id, validatingExId, {
        difficulty: draftDifficulty,
        weight_kg: draftWeight,
        reps_done: draftReps,
      });
      setWorkout(res.workout);
      setValidatingExId(null);
    } catch {} finally {
      setValidateSaving(false);
    }
  };

  const completeSession = () => {
    if (!workout) return;
    Alert.alert("Terminer la séance", "Marquer cette séance comme terminée ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Terminer", style: "default",
        onPress: async () => {
          setCompleting(true);
          try {
            const res = await api.completeWorkout(workout.id);
            setWorkout(res.workout);
          } catch {} finally {
            setCompleting(false);
          }
        },
      },
    ]);
  };

  const submitLog = async () => {
    if (!workout) return;
    setLogSaving(true);
    try {
      const entries = Object.values(logEntries);
      const res = await api.logSession(workout.id, entries);
      setWorkout(res.workout);
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

  const openGif = async (exName: string) => {
    setGifLoadError(false);
    setGifAuthHeader(null);
    setGifExName(exName);
    setGifOpen(true);
    setGifLoading(true);
    setGifUrl(null);
    setGifFound(true);
    try {
      const [res, token] = await Promise.all([api.getExerciseGif(exName), getToken()]);
      setGifUrl(res.gif_url);
      setGifFound(res.found);
      if (token) setGifAuthHeader({ Authorization: `Bearer ${token}` });
    } catch {
      setGifFound(false);
    } finally {
      setGifLoading(false);
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

  const openTitleEdit = () => {
    if (!workout) return;
    setTitleDraft(workout.title);
    setTitleEditOpen(true);
  };

  const saveTitleEdit = async () => {
    if (!workout) return;
    const t = titleDraft.trim();
    if (!t) return;
    setTitleSaving(true);
    try {
      const w = await api.updateWorkout(workout.id, { title: t });
      setWorkout(w);
      setTitleEditOpen(false);
    } catch {} finally {
      setTitleSaving(false);
    }
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
        <Pressable onPress={openTitleEdit} style={styles.titlePressable} testID="workout-title-edit">
          <Text style={styles.headerTitle} numberOfLines={1}>{workout.title}</Text>
          <Ionicons name="pencil" size={15} color={colors.onSurfaceSecondary} style={{ marginLeft: 6 }} />
        </Pressable>
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
            onPress={workout.performed_at ? openLog : completeSession}
            loading={completing}
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



        {workout.exercises.map((ex) => {
          const diffMeta = ex.last_difficulty
            ? DIFFICULTIES.find((d) => d.key === ex.last_difficulty)
            : null;
          const isValidating = validatingExId === ex.id;
          return (
            <View key={ex.id} style={styles.exCard} testID={`exercise-${ex.id}`}>
              <View style={styles.exRow}>
                <Pressable onPress={() => openHistory(ex.name)} style={styles.exIcon} testID={`ex-history-${ex.id}`}>
                  <Ionicons name="trending-up-outline" size={18} color={colors.onBrandTertiary} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <View style={styles.exTopRow}>
                    <Pressable onPress={() => openHistory(ex.name)} style={{ flex: 1 }}>
                      <Text style={styles.exName}>{ex.name}</Text>
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
                <Pressable onPress={() => openGif(ex.name)} style={styles.miniBtn} testID={`exercise-gif-${ex.id}`}>
                  <Ionicons name="play-circle-outline" size={20} color={colors.brandPrimary} />
                </Pressable>
                <Pressable onPress={() => openEdit(ex)} style={styles.miniBtn} testID={`exercise-edit-${ex.id}`}>
                  <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
                </Pressable>
                <Pressable onPress={() => removeExercise(ex.id)} style={styles.miniBtn} testID={`exercise-delete-${ex.id}`}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </Pressable>
              </View>

              {!isValidating ? (
                <Pressable onPress={() => openValidate(ex)} style={styles.validateBtn} testID={`exercise-validate-${ex.id}`}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.validateBtnTxt}>
                    {diffMeta ? "Modifier la validation" : "Valider cet exercice"}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.validatePanel}>
                  <View style={styles.diffRow}>
                    {DIFFICULTIES.map((d) => {
                      const active = draftDifficulty === d.key;
                      return (
                        <Pressable
                          key={d.key}
                          onPress={() => setDraftDifficulty(d.key)}
                          style={[styles.diffBtn, active && { backgroundColor: d.color, borderColor: d.color }]}
                          testID={`validate-diff-${ex.id}-${d.key}`}
                        >
                          <Ionicons name={d.icon} size={14} color={active ? "#FFF" : d.color} />
                          <Text style={[styles.diffBtnTxt, active && { color: "#FFF" }]}>{d.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {draftDifficulty !== "echec" ? (
                    <>
                      <View style={styles.adjustRow}>
                        <Text style={styles.adjustLabel}>Poids : {draftWeight != null ? `${draftWeight} kg` : "—"}</Text>
                        <View style={styles.chipRow}>
                          {[5, 2, 1].map((n) => (
                            <Pressable key={`-${n}`} onPress={() => bumpWeight(-n)} style={styles.chipMinus} testID={`validate-weight-minus${n}-${ex.id}`}>
                              <Text style={styles.chipMinusTxt}>-{n} kg</Text>
                            </Pressable>
                          ))}
                          {[1, 2, 5].map((n) => (
                            <Pressable key={`+${n}`} onPress={() => bumpWeight(n)} style={styles.chip} testID={`validate-weight-plus${n}-${ex.id}`}>
                              <Text style={styles.chipTxt}>+{n} kg</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                      <View style={styles.adjustRow}>
                        <Text style={styles.adjustLabel}>Reps : {draftReps != null ? draftReps : "—"}</Text>
                        <View style={styles.chipRow}>
                          {[5, 2, 1].map((n) => (
                            <Pressable key={`-${n}`} onPress={() => bumpReps(-n)} style={styles.chipMinus} testID={`validate-reps-minus${n}-${ex.id}`}>
                              <Text style={styles.chipMinusTxt}>-{n}</Text>
                            </Pressable>
                          ))}
                          {[1, 2, 5].map((n) => (
                            <Pressable key={`+${n}`} onPress={() => bumpReps(n)} style={styles.chip} testID={`validate-reps-plus${n}-${ex.id}`}>
                              <Text style={styles.chipTxt}>+{n}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                    <Pressable onPress={cancelValidate} style={styles.cancelBtn} testID={`validate-cancel-${ex.id}`}>
                      <Text style={styles.cancelBtnTxt}>Annuler</Text>
                    </Pressable>
                    <Button
                      title="Valider"
                      onPress={confirmValidate}
                      loading={validateSaving}
                      style={{ flex: 1 }}
                      testID={`validate-confirm-${ex.id}`}
                    />
                  </View>
                </View>
              )}
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

      <Modal visible={titleEditOpen} transparent animationType="slide" onRequestClose={() => setTitleEditOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>Renommer la séance</Text>
              <Input label="Nom" placeholder="Ex : Dos" value={titleDraft} onChangeText={setTitleDraft} testID="workout-title-input" />
              <Button title="Enregistrer" onPress={saveTitleEdit} loading={titleSaving} testID="workout-title-save" />
              <Pressable onPress={() => setTitleEditOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
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
                  const repsPts = historyPoints.filter((p) => p.reps_done != null);
                  if (weightsPts.length < 2 && repsPts.length < 2) {
                    return <Text style={styles.emptyEx}>Ajoutez au moins 2 séances pour voir la courbe.</Text>;
                  }
                  const CHART_W = 300;
                  const CHART_H = 160;
                  const weightPoints = buildSeries(weightsPts.map((p) => p.weight_kg as number), CHART_W, CHART_H);
                  const repsPoints = buildSeries(repsPts.map((p) => p.reps_done as number), CHART_W, CHART_H);
                  return (
                    <View>
                      <View style={styles.legendRow}>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: "#0891B2" }]} />
                          <Text style={styles.legendTxt}>Poids (kg)</Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: "#F59E0B" }]} />
                          <Text style={styles.legendTxt}>Répétitions</Text>
                        </View>
                      </View>
                      <View style={styles.svgChartBox}>
                        <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
                          {weightPoints.length >= 2 ? (
                            <Path d={smoothPath(weightPoints)} stroke="#0891B2" strokeWidth={2.5} fill="none" />
                          ) : null}
                          {weightPoints.map((p, i) => (
                            <Circle key={`w-${i}`} cx={p.x} cy={p.y} r={3.5} fill="#0891B2" />
                          ))}
                          {repsPoints.length >= 2 ? (
                            <Path d={smoothPath(repsPoints)} stroke="#F59E0B" strokeWidth={2.5} fill="none" />
                          ) : null}
                          {repsPoints.map((p, i) => (
                            <Circle key={`r-${i}`} cx={p.x} cy={p.y} r={3.5} fill="#F59E0B" />
                          ))}
                        </Svg>
                      </View>
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

      <Modal visible={gifOpen} transparent animationType="slide" onRequestClose={() => setGifOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.drag} />
            <Text style={styles.modalTitle} numberOfLines={1}>{gifExName}</Text>
            {gifLoading ? (
              <View style={{ alignItems: "center", padding: spacing.xl }}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={{ color: colors.onSurfaceSecondary, marginTop: spacing.sm }}>
                  Recherche d'une démonstration…
                </Text>
              </View>
            ) : gifUrl && !gifLoadError && gifAuthHeader ? (
              <Image
                source={{ uri: getExerciseGifImageUrl(gifExName), headers: gifAuthHeader }}
                style={styles.gifImage}
                contentFit="contain"
                autoplay
                onError={() => setGifLoadError(true)}
              />
            ) : (
              <View style={{ alignItems: "center", padding: spacing.xl }}>
                <Ionicons name="film-outline" size={32} color={colors.onSurfaceTertiary} />
                <Text style={{ color: colors.onSurfaceSecondary, marginTop: spacing.sm, textAlign: "center" }}>
                  {gifFound
                    ? "Aucune démonstration disponible pour cet exercice."
                    : "Impossible de charger la démonstration pour le moment."}
                </Text>
                {gifUrl ? (
                  <Text style={{ fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 8 }}>{gifUrl}</Text>
                ) : null}
              </View>
            )}
            <Pressable onPress={() => setGifOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
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
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flexShrink: 1, fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  titlePressable: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
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
  exCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
    padding: spacing.md,
  },
  exRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    minHeight: 56,
  },
  validateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: spacing.sm, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: "dashed",
  },
  validateBtnTxt: { fontSize: font.sm, color: colors.brandPrimary, fontWeight: "500" },
  validatePanel: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  adjustRow: { marginTop: spacing.sm },
  adjustLabel: { fontSize: font.sm, color: colors.onSurface, fontWeight: "500", marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandSecondary,
  },
  chipTxt: { fontSize: font.sm, color: colors.brandPrimary, fontWeight: "500" },
  chipMinus: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
  },
  chipMinusTxt: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "500" },
  cancelBtn: { paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  cancelBtnTxt: { color: colors.onSurfaceSecondary, fontSize: font.base },
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
  chartBox: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    gap: 4, height: 140, padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, marginBottom: spacing.lg,
  },
  svgChartBox: {
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, marginBottom: spacing.lg,
  },
  legendRow: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { fontSize: font.sm, color: colors.onSurfaceSecondary },
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
  gifImage: { width: "100%", height: 260, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
});
