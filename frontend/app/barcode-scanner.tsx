import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { api, Meal } from "@/src/api";

type Per100g = { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null };

export default function BarcodeScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [productName, setProductName] = useState<string | null>(null);
  const [per100g, setPer100g] = useState<Per100g | null>(null);
  const [grams, setGrams] = useState("100");
  const [mealType, setMealType] = useState<Meal["meal_type"]>("collation");
  const [saving, setSaving] = useState(false);

  const onScanned = async ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api.barcodeLookup(data);
      if (!res.found || !res.per_100g) {
        setNotFound(true);
      } else {
        setProductName(res.name);
        setPer100g(res.per_100g);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const rescan = () => {
    setScanned(false);
    setNotFound(false);
    setProductName(null);
    setPer100g(null);
    setGrams("100");
  };

  const scale = (v: number | null) => {
    if (v == null) return undefined;
    const g = parseFloat(grams.replace(",", ".")) || 0;
    return Math.round(((v * g) / 100) * 10) / 10;
  };

  const addMeal = async () => {
    if (!per100g) return;
    setSaving(true);
    try {
      const g = parseFloat(grams.replace(",", ".")) || 0;
      await api.createMeal({
        name: productName || "Produit scanné",
        calories: Math.round(scale(per100g.calories) ?? 0),
        protein_g: scale(per100g.protein_g),
        carbs_g: scale(per100g.carbs_g),
        fat_g: scale(per100g.fat_g),
        fiber_g: scale(per100g.fiber_g),
        meal_type: mealType,
        quantity_g: g,
        calories_per_100g: per100g.calories ?? undefined,
        protein_per_100g: per100g.protein_g ?? undefined,
        carbs_per_100g: per100g.carbs_g ?? undefined,
        fat_per_100g: per100g.fat_g ?? undefined,
        fiber_per_100g: per100g.fiber_g ?? undefined,
      });
      router.back();
    } catch {} finally {
      setSaving(false);
    }
  };

  if (!permission) {
    return <SafeAreaView style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={40} color={colors.onSurfaceSecondary} />
          <Text style={styles.permTxt}>Bodypilot a besoin d'accéder à la caméra pour scanner un code-barres.</Text>
          <Button title="Autoriser la caméra" onPress={requestPermission} style={{ marginTop: spacing.lg }} />
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
        onBarcodeScanned={scanned ? undefined : onScanned}
      />
      <SafeAreaView style={styles.overlay} edges={["top"]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} testID="barcode-close">
          <Ionicons name="close" size={24} color="#FFF" />
        </Pressable>
        {!scanned ? (
          <View style={styles.frameHint}>
            <View style={styles.frame} />
            <Text style={styles.hintTxt}>Placez le code-barres dans le cadre</Text>
          </View>
        ) : null}
      </SafeAreaView>

      {scanned ? (
        <View style={styles.resultCard}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={{ color: colors.onSurfaceSecondary, marginTop: spacing.sm }}>Recherche du produit…</Text>
            </View>
          ) : notFound ? (
            <View style={styles.center}>
              <Ionicons name="help-circle-outline" size={32} color={colors.onSurfaceTertiary} />
              <Text style={{ color: colors.onSurface, marginTop: spacing.sm, textAlign: "center" }}>
                Produit introuvable dans la base de données.
              </Text>
              <Button title="Rescanner" onPress={rescan} style={{ marginTop: spacing.md }} testID="barcode-retry" />
            </View>
          ) : (
            <>
              <Text style={styles.productName} numberOfLines={2}>{productName}</Text>
              <Input
                label="Quantité consommée (g)"
                keyboardType="number-pad"
                value={grams}
                onChangeText={setGrams}
                testID="barcode-grams-input"
              />
              <View style={styles.macroPreviewRow}>
                <Text style={styles.macroPreview}>🔥 {Math.round(scale(per100g?.calories ?? null) ?? 0)} kcal</Text>
                {scale(per100g?.protein_g ?? null) != null ? <Text style={styles.macroPreview}>P {scale(per100g?.protein_g ?? null)}g</Text> : null}
                {scale(per100g?.carbs_g ?? null) != null ? <Text style={styles.macroPreview}>G {scale(per100g?.carbs_g ?? null)}g</Text> : null}
                {scale(per100g?.fat_g ?? null) != null ? <Text style={styles.macroPreview}>L {scale(per100g?.fat_g ?? null)}g</Text> : null}
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                <Pressable onPress={rescan} style={styles.rescanBtn} testID="barcode-rescan">
                  <Text style={{ color: colors.onSurfaceSecondary }}>Rescanner</Text>
                </Pressable>
                <Button title="Ajouter ce repas" onPress={addMeal} loading={saving} style={{ flex: 1 }} testID="barcode-add" />
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  permTxt: { color: colors.onSurface, textAlign: "center", marginTop: spacing.md },
  overlay: { flex: 1, backgroundColor: "transparent" },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", margin: spacing.md,
  },
  frameHint: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: 260, height: 140, borderRadius: radius.md, borderWidth: 3, borderColor: "#FFF" },
  hintTxt: { color: "#FFF", marginTop: spacing.md, fontSize: font.base },
  resultCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, minHeight: 220,
  },
  productName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "600", marginBottom: spacing.md },
  macroPreviewRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, flexWrap: "wrap" },
  macroPreview: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontWeight: "500" },
  rescanBtn: {
    paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider,
  },
});
