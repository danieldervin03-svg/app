import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input, EmptyState } from "@/src/components/ui";
import { api, Measurement } from "@/src/api";

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
  const [items, setItems] = useState<Measurement[]>([]);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [weight, setWeight] = useState("");
  const [chest, setChest] = useState("");
  const [waist, setWaist] = useState("");
  const [hips, setHips] = useState("");
  const [arm, setArm] = useState("");
  const [thigh, setThigh] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listMeasurements();
      setItems(list);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const parseNum = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    setError(null);
    const body = {
      weight_kg: parseNum(weight),
      chest_cm: parseNum(chest),
      waist_cm: parseNum(waist),
      hips_cm: parseNum(hips),
      arm_cm: parseNum(arm),
      thigh_cm: parseNum(thigh),
      note: note.trim(),
    };
    if (Object.values(body).every((v) => v == null || v === "")) {
      setError("Renseignez au moins une valeur");
      return;
    }
    setSaving(true);
    try {
      await api.createMeasurement(body);
      setWeight(""); setChest(""); setWaist(""); setHips(""); setArm(""); setThigh(""); setNote("");
      setOpen(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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
        <Pressable onPress={() => setOpen(true)} style={styles.addBtn} testID="progress-add">
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.sectionH}>Évolution du poids</Text>
        <WeightChart data={items} />

        <Text style={styles.sectionH}>Historique</Text>
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
                    m.chest_cm != null ? `Poitrine ${m.chest_cm}cm` : null,
                    m.waist_cm != null ? `Taille ${m.waist_cm}cm` : null,
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

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%", maxHeight: "90%" }}>
            <View style={styles.modalCard}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Nouvelle mesure</Text>
              <ScrollView style={{ maxHeight: 480 }}>
                <Input label="Poids (kg)" placeholder="Ex : 72.5" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} testID="measure-weight" />
                <Input label="Poitrine (cm)" keyboardType="decimal-pad" value={chest} onChangeText={setChest} testID="measure-chest" />
                <Input label="Taille (cm)" keyboardType="decimal-pad" value={waist} onChangeText={setWaist} testID="measure-waist" />
                <Input label="Hanches (cm)" keyboardType="decimal-pad" value={hips} onChangeText={setHips} testID="measure-hips" />
                <Input label="Bras (cm)" keyboardType="decimal-pad" value={arm} onChangeText={setArm} testID="measure-arm" />
                <Input label="Cuisse (cm)" keyboardType="decimal-pad" value={thigh} onChangeText={setThigh} testID="measure-thigh" />
                <Input label="Note (facultatif)" value={note} onChangeText={setNote} />
              </ScrollView>
              {error ? <Text style={{ color: colors.error, textAlign: "center" }}>{error}</Text> : null}
              <Button title="Enregistrer" onPress={submit} loading={saving} testID="measure-save" style={{ marginTop: spacing.md }} />
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
