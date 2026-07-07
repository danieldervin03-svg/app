import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { api, BodyField, LatestMeasurements } from "@/src/api";

type ZoneKey = BodyField;

type Zone = {
  key: ZoneKey;
  label: string;
  unit: "cm" | "kg";
  // Y position as percentage of the image height (0 = top, 100 = bottom)
  y: number;
  // Which side of the body to render the badge
  side: "left" | "right";
};

// Positions calibrated visually against the generated silhouettes (1:2 aspect)
// Head 5-15%, shoulders 18-22%, chest 25-28%, waist 38-42%, hips 48-52%, thighs 60-72%, feet 98%
const ZONES: Zone[] = [
  { key: "weight_kg", label: "Poids", unit: "kg", y: 11, side: "left" },
  { key: "chest_cm", label: "Torse", unit: "cm", y: 25, side: "right" },
  { key: "arm_cm", label: "Bras", unit: "cm", y: 31, side: "left" },
  { key: "waist_cm", label: "Taille", unit: "cm", y: 37, side: "right" },
  { key: "belly_cm", label: "Ventre", unit: "cm", y: 45, side: "right" },
  { key: "hips_cm", label: "Hanches", unit: "cm", y: 53, side: "right" },
  { key: "thigh_cm", label: "Cuisse", unit: "cm", y: 65, side: "left" },
];

const LABEL_FR: Record<ZoneKey, string> = {
  weight_kg: "Poids",
  chest_cm: "Torse",
  arm_cm: "Bras",
  waist_cm: "Taille",
  belly_cm: "Ventre",
  hips_cm: "Hanches",
  thigh_cm: "Cuisse",
};

const RANGE: Record<ZoneKey, { min: number; max: number }> = {
  weight_kg: { min: 30, max: 250 },
  chest_cm: { min: 10, max: 200 },
  arm_cm: { min: 10, max: 200 },
  waist_cm: { min: 10, max: 200 },
  belly_cm: { min: 10, max: 200 },
  hips_cm: { min: 10, max: 200 },
  thigh_cm: { min: 10, max: 200 },
};

const MALE_IMG = require("@/assets/body/male.png");
const FEMALE_IMG = require("@/assets/body/female.png");

export function BodyMeasurements({
  sex,
  onSaved,
  testID,
}: {
  sex: "homme" | "femme" | null | undefined;
  onSaved?: () => void;
  testID?: string;
}) {
  const [latest, setLatest] = useState<LatestMeasurements | null>(null);
  const [selected, setSelected] = useState<Zone | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const l = await api.latestMeasurements();
      setLatest(l);
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openZone = (z: Zone) => {
    setSelected(z);
    const current = latest?.[z.key];
    setValue(current ? String(current.value) : "");
    setError(null);
  };

  const saveZone = async () => {
    if (!selected) return;
    const n = parseFloat(value.replace(",", "."));
    const { min, max } = RANGE[selected.key];
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(`Entrez une valeur entre ${min} et ${max} ${selected.unit}`);
      return;
    }
    setSaving(true);
    try {
      await api.createMeasurement({ [selected.key]: n } as any);
      await load();
      setSelected(null);
      onSaved?.();
    } catch (e: any) {
      setError(e.message ?? "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const source = sex === "femme" ? FEMALE_IMG : MALE_IMG;

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.diagram}>
        {/* Realistic AI-generated body silhouette, tinted to the current brand color */}
        <Image
          source={source}
          style={styles.silhouette}
          contentFit="contain"
          tintColor={colors.brand}
        />

        {/* Zone markers + badges overlaid */}
        {ZONES.map((z) => {
          const rec = latest?.[z.key] ?? null;
          const val = rec?.value;
          const has = !!val;
          return (
            <Pressable
              key={z.key}
              onPress={() => openZone(z)}
              style={[
                styles.hit,
                {
                  top: `${z.y}%`,
                  left: z.side === "left" ? 0 : "50%",
                  right: z.side === "left" ? "50%" : 0,
                },
              ]}
              testID={`body-zone-${z.key}`}
            >
              <View style={styles.hitInner}>
                {z.side === "right" ? (
                  <>
                    <View style={styles.connector} />
                    <View style={[styles.dot, has && styles.dotFilled]} />
                    <View style={[styles.badge, styles.badgeRight]}>
                      <Text style={styles.badgeLabel}>{z.label}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={[styles.badge, styles.badgeLeft]}>
                      <Text style={styles.badgeLabel}>{z.label}</Text>
                    </View>
                    <View style={[styles.dot, has && styles.dotFilled]} />
                    <View style={styles.connector} />
                  </>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>Appuyez sur une zone pour ajouter une mesure</Text>

      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.drag} />
              <Text style={styles.modalTitle}>{selected ? LABEL_FR[selected.key] : ""}</Text>
              {selected && latest?.[selected.key] ? (
                <Text style={styles.modalSub}>
                  Dernière mesure : {latest[selected.key]!.value} {selected.unit} ·{" "}
                  {new Date(latest[selected.key]!.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
                </Text>
              ) : (
                <Text style={styles.modalSub}>Aucune mesure enregistrée</Text>
              )}

              <Input
                label={`Mesure (${selected?.unit ?? "cm"})`}
                keyboardType="decimal-pad"
                value={value}
                onChangeText={setValue}
                autoFocus
                testID={`body-input-${selected?.key ?? "x"}`}
              />
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <Button title="Enregistrer" onPress={saveZone} loading={saving} testID={`body-save-${selected?.key ?? "x"}`} />
              <Pressable onPress={() => setSelected(null)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: spacing.md },
  diagram: {
    width: "100%",
    aspectRatio: 1 / 2, // image is portrait 1:2
    maxWidth: 320,
    position: "relative",
  },
  silhouette: { width: "100%", height: "100%" },
  hit: {
    position: "absolute",
    height: 44,
    marginTop: -22, // center vertically on the y anchor
    justifyContent: "center",
  },
  hitInner: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: "100%",
    // side-specific ordering happens inline
  },
  connector: {
    width: 24,
    height: 1.5,
    backgroundColor: colors.brandPrimary,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.brandPrimary,
  },
  dotFilled: { backgroundColor: colors.brandPrimary },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    minWidth: 66,
    maxWidth: 110,
  },
  badgeLeft: { marginRight: spacing.xs },
  badgeRight: { marginLeft: spacing.xs },
  badgeLabel: {
    fontSize: 9,
    color: colors.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  badgeVal: {
    fontSize: font.base,
    color: colors.onSurface,
    fontWeight: "500",
  },
  badgeValEmpty: { color: colors.muted, fontWeight: "400" },
  hint: {
    fontSize: font.sm,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  drag: {
    width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2,
    alignSelf: "center", marginBottom: spacing.md,
  },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.xs, fontWeight: "500" },
  modalSub: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  err: { color: colors.error, textAlign: "center", marginBottom: spacing.sm },
});
