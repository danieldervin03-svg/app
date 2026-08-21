import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle, Line, Text as SvgText } from "react-native-svg";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { api, Workout, ExerciseHistoryPoint } from "@/src/api";

type MyExercise = {
  name: string;
  points: ExerciseHistoryPoint[];
  sessions_count: number;
  latest_weight_kg: number | null;
  latest_reps_done: number | null;
  last_performed_at: string | null;
};

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

function buildXY(
  points: { reps: number; weight: number }[],
  drawW: number,
  drawH: number,
): { chartPoints: ChartPoint[]; xMin: number; xMax: number; yMin: number; yMax: number } {
  const xs = points.map((p) => p.reps);
  const ys = points.map((p) => p.weight);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = Math.max(1, xMax - xMin);
  const yRange = Math.max(0.5, yMax - yMin);
  const chartPoints = points.map((p) => ({
    x: ((p.reps - xMin) / xRange) * drawW,
    y: drawH - ((p.weight - yMin) / yRange) * drawH,
  }));
  return { chartPoints, xMin, xMax, yMin, yMax };
}

type HistorySession = {
  id: string;
  workout_id: string;
  workout_title: string;
  performed_at: string;
  entries: {
    exercise_id: string;
    exercise_name: string;
    difficulty: "facile" | "reussi" | "echec" | null;
    weight_kg: number | null;
    reps_done: number | null;
  }[];
};

const DIFF_META: Record<string, { icon: any; color: string; label: string }> = {
  facile: { icon: "happy-outline", color: "#65A30D", label: "Facile" },
  reussi: { icon: "checkmark-circle-outline", color: "#0891B2", label: "Réussi" },
  echec: { icon: "close-circle-outline", color: "#DC2626", label: "Échec" },
};

function ProgressTip() {
  return (
    <View style={styles.tip} testID="workouts-progress-tip">
      <Ionicons name="bulb-outline" size={18} color={colors.brandPrimary} />
      <Text style={styles.tipTxt}>
        Pensez à rajouter une répétition ou à augmenter le poids pour les exercices réussis.
      </Text>
    </View>
  );
}

export default function WorkoutsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ initialView?: "home" | "start" | "mine" | "exercises" }>();
  const [items, setItems] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [view, setView] = useState<"home" | "start" | "mine" | "exercises">(params.initialView ?? "home");
  const [mineTab, setMineTab] = useState<"programs" | "history">("programs");
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [myExercises, setMyExercises] = useState<MyExercise[]>([]);
  const [exercisesLoading, setExercisesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (params.initialView) {
        setView(params.initialView);
      }
    }, [params.initialView])
  );

  const load = useCallback(async () => {
    try {
      const list = await api.listWorkouts();
      setItems(list);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.workoutHistory();
      setHistory(res.sessions);
    } catch {} finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "mine" && mineTab === "history") loadHistory();
  }, [view, mineTab, loadHistory]);

  const loadExercises = useCallback(async () => {
    setExercisesLoading(true);
    try {
      const res = await api.myExercises();
      setMyExercises(res.exercises);
    } catch {} finally {
      setExercisesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "exercises") loadExercises();
  }, [view, loadExercises]);

  const renderWorkoutCard = (item: Workout) => (
    <Pressable
      onPress={() => router.push(`/workout/${item.id}` as any)}
      style={styles.card}
      testID={`workout-card-${item.id}`}
    >
      <View style={styles.cardIcon}>
        <Ionicons name="barbell-outline" size={20} color={colors.onBrandTertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          {item.session_index ? (
            <View style={styles.dayPill}>
              <Text style={styles.dayPillTxt}>Séance {item.session_index}</Text>
            </View>
          ) : null}
          {item.performed_at ? (
            <View style={styles.donePill}>
              <Ionicons name="checkmark" size={12} color={colors.success} />
              <Text style={styles.donePillTxt}>Fait</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardSub}>{item.exercises.length} exercices</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );

  const renderHistoryCard = (session: HistorySession) => {
    const counts = { facile: 0, reussi: 0, echec: 0 };
    session.entries.forEach((e) => {
      if (e.difficulty) counts[e.difficulty]++;
    });
    const dateLabel = new Date(session.performed_at).toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long",
    });
    return (
      <View style={styles.historyCard} testID={`history-card-${session.id}`}>
        <Text style={styles.historyDate}>{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</Text>
        <Text style={styles.historyTitle}>{session.workout_title}</Text>
        <View style={styles.historySummaryRow}>
          {(["reussi", "facile", "echec"] as const).map((k) =>
            counts[k] > 0 ? (
              <View key={k} style={styles.historyChip}>
                <Ionicons name={DIFF_META[k].icon} size={12} color={DIFF_META[k].color} />
                <Text style={[styles.historyChipTxt, { color: DIFF_META[k].color }]}>{counts[k]}</Text>
              </View>
            ) : null
          )}
          <Text style={styles.historyCount}>{session.entries.length} exercices</Text>
        </View>
        {session.entries.map((e) => (
          <View key={e.exercise_id} style={styles.historyExRow}>
            <Text style={styles.historyExName} numberOfLines={1}>{e.exercise_name}</Text>
            <Text style={styles.historyExVal}>
              {e.weight_kg != null ? `${e.weight_kg} kg` : ""}
              {e.reps_done != null ? ` × ${e.reps_done}` : ""}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderExerciseCard = (ex: MyExercise) => {
    const rawPoints = ex.points
      .filter((p) => p.weight_kg != null && p.reps_done != null)
      .map((p) => ({ reps: p.reps_done as number, weight: p.weight_kg as number }))
      .sort((a, b) => a.reps - b.reps);

    const CARD_PAD = spacing.lg;
    const LEFT_AXIS_W = 34;
    const BOTTOM_AXIS_H = 18;
    const CHART_W = 260;
    const CHART_H = 90;
    const drawW = CHART_W - LEFT_AXIS_W;
    const drawH = CHART_H - BOTTOM_AXIS_H;

    let chartInfo: ReturnType<typeof buildXY> | null = null;
    if (rawPoints.length >= 2) {
      chartInfo = buildXY(rawPoints, drawW, drawH);
    }

    return (
      <View style={styles.exerciseCard} testID={`my-exercise-${ex.name}`}>
        <Text style={styles.exerciseCardName}>{ex.name}</Text>
        <Text style={styles.exerciseCardCount}>{ex.sessions_count} séance{ex.sessions_count > 1 ? "s" : ""}</Text>
        <View style={styles.exerciseCardStatsRow}>
          {ex.latest_weight_kg != null ? (
            <Text style={styles.exerciseCardStat}>💪 {ex.latest_weight_kg} kg</Text>
          ) : null}
          {ex.latest_reps_done != null ? (
            <Text style={styles.exerciseCardStat}>🔁 {ex.latest_reps_done} reps</Text>
          ) : null}
        </View>
        {chartInfo ? (
          <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: spacing.sm }}>
            {/* Axes */}
            <Line x1={LEFT_AXIS_W} y1={0} x2={LEFT_AXIS_W} y2={drawH} stroke={colors.divider} strokeWidth={1} />
            <Line x1={LEFT_AXIS_W} y1={drawH} x2={CHART_W} y2={drawH} stroke={colors.divider} strokeWidth={1} />
            {/* Y axis labels (weight) */}
            <SvgText x={LEFT_AXIS_W - 4} y={8} fontSize={9} fill={colors.onSurfaceSecondary} textAnchor="end">
              {Math.round(chartInfo.yMax)}
            </SvgText>
            <SvgText x={LEFT_AXIS_W - 4} y={drawH} fontSize={9} fill={colors.onSurfaceSecondary} textAnchor="end">
              {Math.round(chartInfo.yMin)}kg
            </SvgText>
            {/* X axis labels (reps) */}
            <SvgText x={LEFT_AXIS_W} y={CHART_H - 2} fontSize={9} fill={colors.onSurfaceSecondary} textAnchor="start">
              {chartInfo.xMin}
            </SvgText>
            <SvgText x={CHART_W} y={CHART_H - 2} fontSize={9} fill={colors.onSurfaceSecondary} textAnchor="end">
              {chartInfo.xMax} reps
            </SvgText>
            {/* Curve, offset by the left axis width */}
            <Path
              d={smoothPath(chartInfo.chartPoints.map((p) => ({ x: p.x + LEFT_AXIS_W, y: p.y })))}
              stroke="#0891B2" strokeWidth={2.5} fill="none"
            />
            {chartInfo.chartPoints.map((p, i) => (
              <Circle key={i} cx={p.x + LEFT_AXIS_W} cy={p.y} r={3} fill="#0891B2" />
            ))}
          </Svg>
        ) : (
          <Text style={styles.exerciseCardNoData}>Pas encore assez de données pour une courbe</Text>
        )}
      </View>
    );
  };

  return (
    <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ flex: 1 }}>
      <SafeAreaView style={styles.container} testID="workouts-screen">
        <View style={styles.header}>
          {view !== "home" ? (
            <Pressable onPress={() => setView("home")} style={styles.backBtn} testID="workouts-back">
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
          ) : null}
          <Text style={styles.title}>
            {view === "home" ? "Entraînements" : view === "start" ? "Démarrer" : view === "exercises" ? "Mes exercices" : "Mes entraînements"}
          </Text>
          {view === "mine" && mineTab === "programs" ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable
                style={styles.headerBtnAlt}
                onPress={() => router.push("/workout/new" as any)}
                testID="workouts-manual-add"
              >
                <Ionicons name="add" size={18} color={colors.brandPrimary} />
              </Pressable>
              <Pressable
                style={styles.headerBtn}
                onPress={() => router.push("/workout/generate" as any)}
                testID="workouts-generate-fab"
              >
                <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.headerBtnTxt}>IA</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ width: view === "home" ? 0 : 34 }} />
          )}
        </View>

        {view === "home" ? (
          <View style={styles.homeWrap}>
            <Pressable style={styles.homeCard} onPress={() => setView("start")} testID="workouts-go-start">
              <View style={styles.homeIconWrap}>
                <Ionicons name="play" size={26} color={colors.onBrandPrimary} />
              </View>
              <Text style={styles.homeCardTitle}>Démarrer un entraînement</Text>
              <Text style={styles.homeCardSub}>Choisissez une séance et lancez-vous</Text>
            </Pressable>
            <Pressable style={styles.homeCard} onPress={() => setView("mine")} testID="workouts-go-mine">
              <View style={[styles.homeIconWrap, { backgroundColor: colors.brand }]}>
                <Ionicons name="list" size={26} color={colors.onBrandPrimary} />
              </View>
              <Text style={styles.homeCardTitle}>Mes entraînements</Text>
              <Text style={styles.homeCardSub}>Vos programmes et l'historique de vos séances</Text>
            </Pressable>
            <Pressable style={styles.homeCard} onPress={() => setView("exercises")} testID="workouts-go-exercises">
              <View style={[styles.homeIconWrap, { backgroundColor: "#0891B2" }]}>
                <Ionicons name="trending-up" size={26} color={colors.onBrandPrimary} />
              </View>
              <Text style={styles.homeCardTitle}>Mes exercices</Text>
              <Text style={styles.homeCardSub}>La progression de chaque exercice, en courbe</Text>
            </Pressable>
          </View>
        ) : view === "exercises" ? (
          exercisesLoading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
          ) : myExercises.length === 0 ? (
            <EmptyState
              title="Aucun exercice validé"
              subtitle="Validez des exercices pendant vos séances pour voir leur progression ici."
              testID="exercises-empty"
            />
          ) : (
            <FlatList
              data={myExercises}
              keyExtractor={(e) => e.name}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={exercisesLoading} onRefresh={loadExercises} tintColor={colors.brandPrimary} />}
              ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
              renderItem={({ item }) => renderExerciseCard(item)}
            />
          )
        ) : view === "start" ? (
          loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Aucun entraînement"
              subtitle={'Créez-en un dans "Mes entraînements".'}
              testID="workouts-empty"
            />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
              ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
              renderItem={({ item }) => renderWorkoutCard(item)}
            />
          )
        ) : (
          <>
            <View style={styles.tabRow}>
              <Pressable
                onPress={() => setMineTab("programs")}
                style={[styles.tabBtn, mineTab === "programs" && styles.tabBtnActive]}
                testID="mine-tab-programs"
              >
                <Text style={[styles.tabTxt, mineTab === "programs" && styles.tabTxtActive]}>Programmes</Text>
              </Pressable>
              <Pressable
                onPress={() => setMineTab("history")}
                style={[styles.tabBtn, mineTab === "history" && styles.tabBtnActive]}
                testID="mine-tab-history"
              >
                <Text style={[styles.tabTxt, mineTab === "history" && styles.tabTxtActive]}>Historique</Text>
              </Pressable>
            </View>

            {mineTab === "programs" ? (
              <>
                <ProgressTip />
                {loading ? (
                  <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
                ) : items.length === 0 ? (
                  <EmptyState
                    title="Aucun entraînement"
                    subtitle="Laissez l'IA vous générer un programme adapté à vos objectifs."
                    testID="workouts-empty"
                  />
                ) : (
                  <FlatList
                    data={items}
                    keyExtractor={(i) => i.id}
                    contentContainerStyle={styles.list}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
                    ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
                    renderItem={({ item }) => renderWorkoutCard(item)}
                  />
                )}
              </>
            ) : historyLoading ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
            ) : history.length === 0 ? (
              <EmptyState
                title="Aucune séance réalisée"
                subtitle="Vos séances validées apparaîtront ici."
                testID="history-empty"
              />
            ) : (
              <FlatList
                data={history}
                keyExtractor={(s) => s.id}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={historyLoading} onRefresh={loadHistory} tintColor={colors.brandPrimary} />}
                ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
                renderItem={({ item }) => renderHistoryCard(item)}
              />
            )}
          </>
        )}

        {view === "mine" && mineTab === "programs" ? (
          <Pressable
            style={styles.fab}
            onPress={() => router.push("/workout/generate" as any)}
            testID="workouts-fab-generate"
          >
            <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.fabTxt}>{"Demander à l'IA"}</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  tip: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandSecondary,
  },
  tipTxt: { flex: 1, fontSize: font.sm, color: colors.onSurface, lineHeight: 18 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
  },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500", flex: 1 },
  headerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  headerBtnAlt: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surface,
  },
  headerBtnTxt: { color: colors.onBrandPrimary, fontSize: font.sm },
  list: { padding: spacing.lg, paddingBottom: 120 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.divider,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  cardSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  dayPill: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  dayPillTxt: { fontSize: 10, color: colors.onBrandTertiary, textTransform: "capitalize", fontWeight: "500" },
  donePill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  donePillTxt: { fontSize: 10, color: colors.success, fontWeight: "500" },
  fab: {
    position: "absolute", bottom: 16, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabTxt: { color: colors.onBrandPrimary, fontSize: font.lg },

  homeWrap: { padding: spacing.lg, gap: spacing.lg },
  homeCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.divider, alignItems: "flex-start",
  },
  homeIconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  homeCardTitle: { fontSize: font.lg, color: colors.onSurface, fontWeight: "600" },
  homeCardSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 4 },

  tabRow: {
    flexDirection: "row", marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4,
    borderWidth: 1, borderColor: colors.divider,
  },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: "center" },
  tabBtnActive: { backgroundColor: colors.brandPrimary },
  tabTxt: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "500" },
  tabTxtActive: { color: colors.onBrandPrimary },

  historyCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.divider,
  },
  historyDate: { fontSize: font.sm, color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  historyTitle: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500", marginTop: 2 },
  historySummaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  historyChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
  },
  historyChipTxt: { fontSize: 11, fontWeight: "600" },
  historyCount: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginLeft: "auto" },
  historyExRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  historyExName: { fontSize: font.sm, color: colors.onSurface, flex: 1, marginRight: spacing.sm },
  historyExVal: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  exerciseCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.divider,
  },
  exerciseCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  exerciseCardName: { fontSize: font.xl, color: colors.brandPrimary, fontWeight: "700" },
  exerciseCardCount: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  exerciseCardStatsRow: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  exerciseCardStat: { fontSize: font.sm, color: colors.onSurface },
  exerciseCardNoData: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, fontStyle: "italic" },
});
