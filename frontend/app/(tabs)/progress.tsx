import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { api, CalorieRecommendation, HistoryStats, Measurement } from "@/src/api";
import { useAuth } from "@/src/auth";
import { BodyMeasurements } from "@/src/components/body-measurements";

function WeightChart({ data }: { data: Measurement[] }) {
  const points = data.filter((d) => typeof d.weight_kg === "number").slice(-14);
  if (points.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyTxt}>{"Ajoutez au moins 2 mesures pour voir l'évolution"}</Text>
      </View>
    );
  }
  const values = points.map((p) => p.weight_kg as number);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(0.5, max - min);
  return (
    <View style={styles.chart}>
      <View style={styles.chartBars}>
        {points.map((p, i) => {
          const h = ((p.weight_kg as number) - min) / range;
          return (
            <View key={p.id} style={styles.barCol}>
              <View style={[styles.bar, { height: `${20 + h * 75}%` }]} />
              <Text style={styles.barLabel}>{(p.weight_kg as number).toFixed(1)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function ProgressScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [items, setItems] = useState<Measurement[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [reco, setReco] = useState<CalorieRecommendation | null>(null);
  const [applyingReco, setApplyingReco] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, s, r] = await Promise.all([
        api.listMeasurements(),
        api.historyStats(),
        api.calorieRecommendation().catch(() => null),
      ]);
      setItems(list);
      setStats(s);
      setReco(r);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const applyReco = async () => {
    setApplyingReco(true);
    try {
      await api.applyCalorieRecommendation();
      await refresh();
      await load();
    } catch {}
    setApplyingReco(false);
  };

  const delItem = async (id: string) => {
    await api.deleteMeasurement(id).catch(() => {});
    setItems((p) => p.filter((x) => x.id !== id));
  };

  const sorted = [...items].reverse();

  return (
    <SafeAreaView style={styles.container} testID="progress-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Progrès</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.sectionH}>Séances</Text>
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.total_completed ?? 0}</Text>
              <Text style={styles.statLbl}>Terminées</Text>
            </View>
            <View style={styles.statBoxAccent}>
              <View style={styles.streakIcon}>
                <Ionicons name="flame" size={16} color={colors.onBrandPrimary} />
              </View>
              <Text style={styles.statValueAccent}>{stats?.current_streak_weeks ?? 0}</Text>
              <Text style={styles.statLblAccent}>Streak (sem.)</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats?.best_streak_weeks ?? 0}</Text>
              <Text style={styles.statLbl}>Meilleur</Text>
            </View>
          </View>

          <Text style={styles.weeklyLbl}>8 dernières semaines</Text>
          <View style={styles.weeklyBars}>
            {(stats?.weekly ?? []).map((w) => {
              const maxCount = Math.max(1, ...(stats?.weekly.map((x) => x.count) ?? [1]));
              const h = 8 + (w.count / maxCount) * 60;
              return (
                <View key={w.week} style={styles.weekCol}>
                  <View style={[styles.weekBar, { height: h, backgroundColor: w.count > 0 ? colors.brandPrimary : colors.brandTertiary }]} />
                  <Text style={styles.weekTxt}>{w.label}</Text>
                  <Text style={styles.weekCount}>{w.count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {stats && stats.recent.length > 0 ? (
          <>
            <Text style={styles.sectionH}>Historique récent</Text>
            {stats.recent.slice(0, 6).map((w) => (
              <Pressable
                key={w.id}
                onPress={() => router.push(`/workout/${w.id}` as any)}
                style={styles.histRow}
                testID={`history-workout-${w.id}`}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.onBrandTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{w.title}</Text>
                  <Text style={styles.rowSub}>
                    {w.performed_at
                      ? new Date(w.performed_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
                      : ""}
                    {" · "}{w.exercises.length} exercices
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </>
        ) : null}

        <Text style={styles.sectionH}>Mensurations du corps</Text>
        <View style={styles.bodyWrap}>
          <BodyMeasurements sex={user?.sex} onSaved={load} testID="body-measurements" />
        </View>

        <Text style={styles.sectionH}>Évolution du poids</Text>
        {reco && (reco.applicable || reco.status === "insufficient_data") ? (
          <View
            style={[
              styles.recoCard,
              reco.should_adjust ? styles.recoCardWarn : styles.recoCardOk,
            ]}
            testID="calorie-reco-card"
          >
            <View style={styles.recoHeader}>
              <View style={[styles.recoIcon, reco.should_adjust ? { backgroundColor: colors.warning } : { backgroundColor: colors.brandPrimary }]}>
                <Ionicons
                  name={reco.should_adjust ? "trending-up" : "checkmark"}
                  size={16}
                  color={colors.onBrandPrimary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recoTitle}>Ajustement calorique adaptatif</Text>
                <Text style={styles.recoSub}>
                  {reco.weekly_change_kg != null
                    ? `${reco.weekly_change_kg >= 0 ? "+" : ""}${reco.weekly_change_kg} kg/sem sur ${reco.span_days} j`
                    : (reco.reason ?? "")}
                </Text>
              </View>
            </View>
            {reco.applicable ? (
              <Text style={styles.recoReason}>{reco.reason}</Text>
            ) : null}
            {reco.should_adjust ? (
              <View style={styles.recoActions}>
                <View style={styles.recoGoal}>
                  <Text style={styles.recoOld}>{reco.current_goal}</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.onSurfaceSecondary} />
                  <Text style={styles.recoNew}>{reco.suggested_goal} kcal</Text>
                </View>
                <Pressable
                  onPress={applyReco}
                  disabled={applyingReco}
                  style={[styles.recoBtn, applyingReco && { opacity: 0.5 }]}
                  testID="calorie-reco-apply"
                >
                  <Text style={styles.recoBtnTxt}>{applyingReco ? "…" : "Appliquer"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        <WeightChart data={items} />

        <Text style={styles.sectionH}>Mesures</Text>
        {sorted.length === 0 ? (
          <EmptyState title="Aucune mesure enregistrée" subtitle="Ajoutez votre premier suivi." testID="progress-empty" />
        ) : (
          sorted.map((m) => (
            <View key={m.id} style={styles.row} testID={`measurement-${m.id}`}>
              <View style={styles.rowIcon}>
                <Ionicons name="scale-outline" size={18} color={colors.onBrandTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {new Date(m.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </Text>
                <Text style={styles.rowSub}>
                  {[
                    m.weight_kg != null ? `${m.weight_kg} kg` : null,
                    m.chest_cm != null ? `Torse ${m.chest_cm}cm` : null,
                    m.waist_cm != null ? `Taille ${m.waist_cm}cm` : null,
                    m.belly_cm != null ? `Ventre ${m.belly_cm}cm` : null,
                    m.hips_cm != null ? `Hanches ${m.hips_cm}cm` : null,
                    m.arm_cm != null ? `Bras ${m.arm_cm}cm` : null,
                    m.thigh_cm != null ? `Cuisse ${m.thigh_cm}cm` : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </Text>
                {m.note ? <Text style={styles.rowNote}>{m.note}</Text> : null}
              </View>
              <Pressable onPress={() => delItem(m.id)} style={{ padding: spacing.sm }} testID={`measurement-delete-${m.id}`}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  addBtn: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  sectionH: { fontSize: font.lg, color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.md },
  statsCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
  },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  statBox: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    alignItems: "center",
  },
  statBoxAccent: {
    flex: 1, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md,
    alignItems: "center",
  },
  streakIcon: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  statValue: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  statValueAccent: { fontSize: font.xxl, color: colors.onBrandTertiary, fontWeight: "500" },
  statLbl: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2, textAlign: "center" },
  statLblAccent: { fontSize: font.sm, color: colors.onBrandTertiary, marginTop: 2, textAlign: "center" },
  weeklyLbl: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  weeklyBars: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
    gap: 4, height: 100, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm,
  },
  weekCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  weekBar: { width: "70%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  weekTxt: { fontSize: 9, color: colors.onSurfaceSecondary, marginTop: 4 },
  weekCount: { fontSize: 9, color: colors.onSurface, fontWeight: "500" },
  histRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  bodyWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  chart: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, height: 200,
  },
  chartBars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "80%", backgroundColor: colors.brandPrimary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 9, color: colors.onSurfaceSecondary, marginTop: 4 },
  chartEmpty: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, height: 120,
    alignItems: "center", justifyContent: "center", padding: spacing.md,
  },
  chartEmptyTxt: { color: colors.onSurfaceSecondary, textAlign: "center" },
  recoCard: {
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1,
  },
  recoCardOk: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary },
  recoCardWarn: { backgroundColor: "#FEF3C7", borderColor: colors.warning },
  recoHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  recoIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  recoTitle: { fontSize: font.base, color: colors.onSurface, fontWeight: "500" },
  recoSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  recoReason: { fontSize: font.sm, color: colors.onSurface, marginBottom: spacing.sm, lineHeight: 18 },
  recoActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recoGoal: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  recoOld: { fontSize: font.base, color: colors.onSurfaceSecondary, textDecorationLine: "line-through" },
  recoNew: { fontSize: font.lg, color: colors.brandPrimary, fontWeight: "500" },
  recoBtn: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
  },
  recoBtnTxt: { color: colors.onBrandPrimary, fontSize: font.sm, fontWeight: "500" },
  row: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  rowTitle: { fontSize: font.base, color: colors.onSurface, fontWeight: "500" },
  rowSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  rowNote: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 4, fontStyle: "italic" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxxl,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
});
