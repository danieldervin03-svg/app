import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, EmptyState } from "@/src/components/ui";
import { api, Meal, MealSuggestion } from "@/src/api";

export default function MealSuggestionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    meal_type: Meal["meal_type"];
    calories: string;
    preferences?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [addedIndex, setAddedIndex] = useState<number | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.suggestMeals({
          remaining_calories: Math.max(50, parseInt(params.calories || "500", 10) || 500),
          meal_type: (params.meal_type as Meal["meal_type"]) || "déjeuner",
          preferences: params.preferences || "",
        });
        setSuggestions(res.suggestions);
      } catch (e: any) {
        setError(e.message ?? "Impossible de générer des idées pour le moment.");
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addSuggestion = async (s: MealSuggestion, i: number) => {
    setAddingIndex(i);
    try {
      await api.createMeal({
        name: s.name,
        calories: s.calories,
        protein_g: s.protein_g,
        carbs_g: s.carbs_g,
        fat_g: s.fat_g,
        fiber_g: s.fiber_g,
        meal_type: (params.meal_type as Meal["meal_type"]) || "déjeuner",
      });
      setAddedIndex(i);
    } catch {} finally {
      setAddingIndex(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="meal-suggestions-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="suggestions-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Idées repas IA</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
          <Text style={styles.loadingTxt}>Génération de vos idées repas…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
          <Text style={styles.errorTxt}>{error}</Text>
          <Button title="Retour" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
        </View>
      ) : suggestions.length === 0 ? (
        <EmptyState title="Aucune idée générée" subtitle="Réessayez avec d'autres critères." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {suggestions.map((s, i) => (
            <View key={i} style={styles.card} testID={`suggestion-card-${i}`}>
              <Text style={styles.cardName}>{s.name}</Text>
              <Text style={styles.cardCal}>
                {s.calories} kcal
                {s.protein_g != null ? (
                  <>
                    <Text style={{ color: colors.onSurfaceSecondary }}> · </Text>
                    <Text style={{ color: "#FB7185", fontWeight: "600" }}>P {s.protein_g}g</Text>
                    <Text style={{ color: colors.onSurfaceSecondary }}> · </Text>
                    <Text style={{ color: "#FBBF24", fontWeight: "600" }}>G {s.carbs_g}g</Text>
                    <Text style={{ color: colors.onSurfaceSecondary }}> · </Text>
                    <Text style={{ color: "#60A5FA", fontWeight: "600" }}>L {s.fat_g}g</Text>
                    {s.fiber_g != null ? (
                      <>
                        <Text style={{ color: colors.onSurfaceSecondary }}> · </Text>
                        <Text style={{ color: "#34D399", fontWeight: "600" }}>F {s.fiber_g}g</Text>
                      </>
                    ) : null}
                  </>
                ) : null}
              </Text>
              <Text style={styles.cardDesc}>{s.description}</Text>
              {s.ingredients?.length > 0 ? (
                <Text style={styles.cardIngredients}>{s.ingredients.join(" · ")}</Text>
              ) : null}
              <Pressable
                onPress={() => addSuggestion(s, i)}
                disabled={addingIndex === i || addedIndex === i}
                style={[styles.addBtn, addedIndex === i && styles.addBtnDone]}
                testID={`suggestion-add-${i}`}
              >
                {addingIndex === i ? (
                  <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                ) : addedIndex === i ? (
                  <>
                    <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
                    <Text style={styles.addBtnTxt}>Ajouté</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
                    <Text style={styles.addBtnTxt}>Ajouter ce repas</Text>
                  </>
                )}
              </Pressable>
            </View>
          ))}
          <Button title="Terminer" onPress={() => router.back()} style={{ marginTop: spacing.md }} testID="suggestions-done" />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  loadingTxt: { marginTop: spacing.md, color: colors.onSurfaceSecondary, textAlign: "center" },
  errorTxt: { marginTop: spacing.md, color: colors.error, textAlign: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "600" },
  cardCal: { fontSize: font.base, marginTop: 4, color: colors.onSurface },
  cardDesc: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, lineHeight: 19 },
  cardIngredients: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, fontStyle: "italic" },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  addBtnDone: { backgroundColor: colors.success },
  addBtnTxt: { color: colors.onBrandPrimary, fontSize: font.sm, fontWeight: "600" },
});
