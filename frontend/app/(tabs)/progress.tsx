import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle } from "react-native-svg";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState, Input, Button } from "@/src/components/ui";
import { api, CalorieRecommendation, Measurement } from "@/src/api";
import { useAuth } from "@/src/auth";
import { BodyMeasurements } from "@/src/components/body-measurements";

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
    const norm = (v - min) / range;
    const y = height - padY - norm * (height - padY * 2);
    return { x: i * stepX, y };
  });
}

const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "1m", label: "1 mois", days: 30 },
  { key: "3m", label: "3 mois", days: 90 },
  { key: "6m", label: "6 mois", days: 180 },
  { key: "all", label: "Tout", days: null },
];

function WeightChart({ data }: { data: Measurement[] }) {
  const [period, setPeriod] = useState("3m");
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const cutoff = days != null ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

  const points = [...data]
    .filter((d) => typeof d.weight_kg === "number")
    .filter((d) => (cutoff == null ? true : new Date(d.created_at).getTime() >= cutoff));

  const selector = (
    <View style={styles.periodRow}>
      {PERIODS.map((p) => (
        <Pressable
          key={p.key}
          onPress={() => setPeriod(p.key)}
          style={[styles.periodBtn, period === p.key && styles.periodBtnActive]}
          testID={`weight-period-${p.key}`}
        >
          <Text style={[styles.periodTxt, period === p.key && styles.periodTxtActive]}>{p.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  if (points.length < 2) {
    return (
      <View>
        {selector}
        <View style={styles.chartEmpty}>
          <Text style={styles.chartEmptyTxt}>{"Pas assez de pesées sur cette période"}</Text>
        </View>
      </View>
    );
  }
  const CHART_W = 320;
  const CHART_H = 150;
  const values = points.map((p) => p.weight_kg as number);
  const chartPoints = buildSeries(values, CHART_W, CHART_H);
  const first = values[0];
  const last = values[values.length - 1];
  const delta = Math.round((last - first) * 10) / 10;
  return (
    <View>
      {selector}
      <View style={styles.chart}>
        <View style={styles.chartHeaderRow}>
          <Text style={styles.chartLatest}>{last} kg</Text>
          <View style={[styles.chartDeltaPill, delta <= 0 ? styles.chartDeltaDown : styles.chartDeltaUp]}>
            <Ionicons name={delta <= 0 ? "trending-down" : "trending-up"} size={12} color={delta <= 0 ? "#65A30D" : "#DC2626"} />
            <Text style={[styles.chartDeltaTxt, { color: delta <= 0 ? "#65A30D" : "#DC2626" }]}>
              {delta > 0 ? "+" : ""}{delta} kg
            </Text>
          </View>
        </View>
        <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          <Path d={smoothPath(chartPoints)} stroke={colors.brandPrimary} strokeWidth={2.5} fill="none" />
          {chartPoints.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={colors.brandPrimary} />
          ))}
        </Svg>
      </View>
    </View>
  );
}

export default function ProgressScreen() {
  const { user, refresh } = useAuth();
  const [items, setItems] = useState<Measurement[]>([]);
  const [reco, setReco] = useState<CalorieRecommendation | null>(null);
  const [applyingReco, setApplyingReco] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, r] = await Promise.all([
        api.listMeasurements(),
        api.calorieRecommendation().catch(() => null),
      ]);
      setItems(list);
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

  const latestWeight = [...items].reverse().find((it) => typeof it.weight_kg === "number")?.weight_kg ?? null;

  const openWeight = () => {
    setWeightInput(latestWeight != null ? String(latestWeight) : "");
    setWeightError(null);
    setWeightOpen(true);
  };

  const saveWeight = async () => {
    const n = parseFloat(weightInput.replace(",", "."));
    if (!Number.isFinite(n) || n < 30 || n > 250) {
      setWeightError("Entrez une valeur entre 30 et 250 kg");
      return;
    }
    setWeightSaving(true);
    setWeightError(null);
    try {
      await api.createMeasurement({ weight_kg: n });
      setWeightOpen(false);
      await load();
    } catch (e: any) {
      setWeightError(e.message ?? "Erreur, réessayez");
    } finally {
      setWeightSaving(false);
    }
  };

  const sorted = [...items].reverse();

  return (
    <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ flex: 1 }}>
    <SafeAreaView style={styles.container} testID="progress-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Progrès</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.sectionH}>Poids</Text>
        <Pressable style={styles.weightCard} onPress={openWeight} testID="progress-weight-card">
          <View style={styles.weightIcon}>
            <Ionicons name="scale-outline" size={20} color={colors.onBrandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.weightValue}>
              {latestWeight != null ? `${latestWeight} kg` : "Non renseigné"}
            </Text>
            <Text style={styles.weightSub}>Appuyez pour mettre à jour</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
        </Pressable>

        <Text style={styles.sectionH}>Évolution du poids</Text>
        <WeightChart data={items} />

        {reco && (reco.applicable || reco.status === "insufficient_data") ? (
          <>
            <Text style={styles.sectionH}>Ajustement calorique</Text>
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
          </>
        ) : null}

        <Text style={styles.sectionH}>Mensurations du corps</Text>
        <View style={styles.bodyWrap}>
          <BodyMeasurements sex={user?.sex} onSaved={load} testID="body-measurements" />
        </View>

        <Text style={styles.sectionH}>Historique des mensurations</Text>
        {sorted.length === 0 ? (
          <EmptyState title="Aucune mesure enregistrée" subtitle="Ajoutez votre premier suivi." testID="progress-empty" />
        ) : (
          sorted.map((m, idx) => {
            const fields: { key: keyof Measurement; label: string; unit: string }[] = [
              { key: "weight_kg", label: "Poids", unit: "kg" },
              { key: "chest_cm", label: "Torse", unit: "cm" },
              { key: "waist_cm", label: "Taille", unit: "cm" },
              { key: "belly_cm", label: "Ventre", unit: "cm" },
              { key: "hips_cm", label: "Hanches", unit: "cm" },
              { key: "arm_cm", label: "Bras", unit: "cm" },
              { key: "thigh_cm", label: "Cuisse", unit: "cm" },
            ];
            const present = fields.filter((f) => m[f.key] != null);
            const findPrevious = (key: keyof Measurement): number | null => {
              for (let j = idx + 1; j < sorted.length; j++) {
                const v = sorted[j][key];
                if (v != null) return v as number;
              }
              return null;
            };
            const dateLabel = new Date(m.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
            return (
              <View key={m.id} style={styles.histCard} testID={`measurement-${m.id}`}>
                <View style={styles.histCardHeader}>
                  <Text style={styles.histCardDate}>{dateLabel}</Text>
                  <Pressable onPress={() => delItem(m.id)} style={{ padding: spacing.xs }} testID={`measurement-delete-${m.id}`}>
                    <Ionicons name="trash-outline" size={17} color={colors.error} />
                  </Pressable>
                </View>
                {present.length === 0 ? (
                  <Text style={styles.rowSub}>—</Text>
                ) : (
                  <View style={styles.histChipsWrap}>
                    {present.map((f) => {
                      const val = m[f.key] as number;
                      const prev = findPrevious(f.key);
                      const delta = prev != null ? Math.round((val - prev) * 10) / 10 : null;
                      return (
                        <View key={String(f.key)} style={styles.histChip}>
                          <Text style={styles.histChipLabel}>{f.label}</Text>
                          <Text style={styles.histChipVal}>{val} {f.unit}</Text>
                          {delta != null && delta !== 0 ? (
                            <View style={styles.histChipDelta}>
                              <Ionicons
                                name={delta > 0 ? "arrow-up" : "arrow-down"}
                                size={10}
                                color={delta > 0 ? "#DC2626" : "#65A30D"}
                              />
                              <Text style={[styles.histChipDeltaTxt, { color: delta > 0 ? "#DC2626" : "#65A30D" }]}>
                                {Math.abs(delta)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
                {m.note ? <Text style={styles.rowNote}>{m.note}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={weightOpen} transparent animationType="slide" onRequestClose={() => setWeightOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Poids</Text>
              <Input
                label="Poids (kg)"
                placeholder="Ex : 72.5"
                keyboardType="decimal-pad"
                value={weightInput}
                onChangeText={setWeightInput}
                testID="progress-weight-input"
              />
              {weightError ? <Text style={styles.err}>{weightError}</Text> : null}
              <Button title="Enregistrer" onPress={saveWeight} loading={weightSaving} testID="progress-weight-save" />
              <Pressable onPress={() => setWeightOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  sectionH: { fontSize: font.lg, color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.md },
  bodyWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  chart: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  periodRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  periodBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
  },
  periodBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  periodTxt: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "500" },
  periodTxtActive: { color: colors.onBrandPrimary },
  chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  chartLatest: { fontSize: font.xl, color: colors.onSurface, fontWeight: "600" },
  chartDeltaPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
  },
  chartDeltaDown: { backgroundColor: "#ECFCCB" },
  chartDeltaUp: { backgroundColor: "#FEE2E2" },
  chartDeltaTxt: { fontSize: font.sm, fontWeight: "600" },
  chartEmpty: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, height: 120, marginBottom: spacing.md,
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
  histCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  histCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  histCardDate: { fontSize: font.base, color: colors.onSurface, fontWeight: "500", textTransform: "capitalize" },
  histChipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  histChip: {
    backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.divider,
  },
  histChipLabel: { fontSize: 10, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  histChipVal: { fontSize: font.sm, color: colors.onSurface, fontWeight: "600" },
  histChipDelta: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  histChipDeltaTxt: { fontSize: 10, fontWeight: "600" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxxl,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
  err: { color: colors.error, textAlign: "center", marginBottom: spacing.sm },
  weightCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.divider,
  },
  weightIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  weightValue: { fontSize: font.lg, color: colors.onSurface, fontWeight: "600" },
  weightSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
});
