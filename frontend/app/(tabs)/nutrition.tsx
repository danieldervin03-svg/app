import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input, EmptyState } from "@/src/components/ui";
import { api, Meal, MealSuggestion, MenuScanResult } from "@/src/api";
import { useAuth } from "@/src/auth";

const MEAL_TYPES: Meal["meal_type"][] = ["petit-déjeuner", "déjeuner", "dîner", "collation"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function NutritionScreen() {
  const { user } = useAuth();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [mealName, setMealName] = useState("");
  const [mealCal, setMealCal] = useState("");
  const [mealProtein, setMealProtein] = useState("");
  const [mealCarbs, setMealCarbs] = useState("");
  const [mealFat, setMealFat] = useState("");
  const [mealType, setMealType] = useState<Meal["meal_type"]>("petit-déjeuner");
  const [mealDesc, setMealDesc] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [suggestType, setSuggestType] = useState<Meal["meal_type"]>("déjeuner");
  const [suggestPref, setSuggestPref] = useState("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanImageUri, setScanImageUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<MenuScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listMeals(todayStr());
      setMeals(list);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goal = user?.calorie_goal ?? 2000;
  const consumed = meals.reduce((s, m) => s + m.calories, 0);
  const remaining = Math.max(0, goal - consumed);
  const percent = Math.min(1, consumed / Math.max(1, goal));

  const mealsPerDay = user?.meals_per_day ?? 4;
  const mealsRemaining = Math.max(1, mealsPerDay - meals.length);
  const perRemainingMeal = Math.max(0, Math.round(remaining / mealsRemaining));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const estimateFromDesc = async () => {
    if (!mealDesc.trim()) return;
    setEstimating(true);
    setError(null);
    setBreakdown(null);
    try {
      const res = await api.estimateMeal(mealDesc.trim());
      setMealName(res.name);
      setMealCal(String(res.calories));
      setMealProtein(String(res.protein_g ?? ""));
      setMealCarbs(String(res.carbs_g ?? ""));
      setMealFat(String(res.fat_g ?? ""));
      setMealType(res.meal_type);
      setBreakdown(res.breakdown);
    } catch (e: any) {
      setError(e.message ?? "Estimation impossible");
    } finally {
      setEstimating(false);
    }
  };

  const submitMeal = async () => {
    setError(null);
    // If user only filled description, estimate on-the-fly
    let calories = parseInt(mealCal, 10);
    let name = mealName.trim();
    if ((Number.isNaN(calories) || !name) && mealDesc.trim()) {
      try {
        setSaving(true);
        const res = await api.estimateMeal(mealDesc.trim());
        name = name || res.name;
        calories = Number.isNaN(calories) ? res.calories : calories;
        setMealName(name);
        setMealCal(String(calories));
        setBreakdown(res.breakdown);
      } catch (e: any) {
        setSaving(false);
        setError(e.message ?? "Estimation impossible");
        return;
      }
    }
    if (!name || Number.isNaN(calories) || calories < 0) {
      setSaving(false);
      setError("Décrivez votre repas ou renseignez nom et calories");
      return;
    }
    setSaving(true);
    try {
      await api.createMeal({
        name,
        calories,
        protein_g: mealProtein.trim() ? parseFloat(mealProtein.replace(",", ".")) : undefined,
        carbs_g: mealCarbs.trim() ? parseFloat(mealCarbs.replace(",", ".")) : undefined,
        fat_g: mealFat.trim() ? parseFloat(mealFat.replace(",", ".")) : undefined,
        meal_type: mealType,
      });
      setMealName(""); setMealCal(""); setMealDesc(""); setBreakdown(null);
      setMealProtein(""); setMealCarbs(""); setMealFat("");
      setMealType("petit-déjeuner");
      setAddOpen(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteMeal = async (id: string) => {
    await api.deleteMeal(id).catch(() => {});
    setMeals((prev) => prev.filter((m) => m.id !== id));
  };

  const runSuggest = async () => {
    setSuggestLoading(true);
    setSuggestions([]);
    try {
      // Toujours utiliser la portion par repas définie par le profil,
      // indépendamment des calories déjà consommées dans la journée.
      const perMeal = Math.round(goal / (user?.meals_per_day ?? 4));
      const res = await api.suggestMeals({
        remaining_calories: Math.max(150, perMeal),
        meal_type: suggestType,
        preferences: suggestPref,
      });
      setSuggestions(res.suggestions);
    } catch {} finally {
      setSuggestLoading(false);
    }
  };

  const addSuggested = async (s: MealSuggestion) => {
    await api.createMeal({
      name: s.name,
      calories: s.calories,
      protein_g: s.protein_g,
      carbs_g: s.carbs_g,
      fat_g: s.fat_g,
      meal_type: suggestType,
    });
    await load();
  };

  const pickMenuImage = async (source: "camera" | "library") => {
    setScanError(null);
    let result: ImagePicker.ImagePickerResult;
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setScanError("Autorisation caméra refusée");
        return;
      }
      result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setScanError("Autorisation galerie refusée");
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
    }
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setScanImageUri(asset.uri);
    setScanResult(null);
    if (!asset.base64) {
      setScanError("Impossible de lire l'image");
      return;
    }
    setScanning(true);
    try {
      const mime = asset.mimeType || "image/jpeg";
      const res = await api.scanMenu(asset.base64, mime);
      setScanResult(res);
    } catch (e: any) {
      setScanError(e.message ?? "Analyse impossible");
    } finally {
      setScanning(false);
    }
  };

  const saveScannedMeal = async () => {
    if (!scanResult) return;
    setSaving(true);
    try {
      await api.createMeal({
        name: scanResult.plat_recommande || "Repas au restaurant",
        calories: scanResult.calories,
        protein_g: scanResult.protein_g,
        carbs_g: scanResult.carbs_g,
        fat_g: scanResult.fat_g,
        meal_type: suggestType,
      });
      setScanOpen(false);
      setScanResult(null);
      setScanImageUri(null);
      await load();
    } catch (e: any) {
      setScanError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ flex: 1 }}>
    <SafeAreaView style={styles.container} testID="nutrition-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Nutrition</Text>
      </View>

      <FlatList
        data={meals}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        ListHeaderComponent={
          <View>
            <View style={styles.calorieCard}>
              <Text style={styles.cardLabel}>{"Calories aujourd'hui"}</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.calBig} testID="nutrition-consumed">{consumed}</Text>
                <Text style={styles.calGoal}>/ {goal} kcal</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${percent * 100}%` }]} />
              </View>
              <Text style={styles.calSub}>
                {remaining > 0 ? `Il reste ${remaining} kcal` : `Objectif dépassé de ${consumed - goal} kcal`}
              </Text>
              <View style={styles.perMealRow}>
                <Ionicons name="restaurant-outline" size={14} color={colors.onBrandTertiary} />
                <Text style={styles.perMealTxt}>
                  {user?.meals_per_day ?? 4} repas/jour · {Math.round(goal / (user?.meals_per_day ?? 4))} kcal/repas
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={styles.actionBtn} onPress={() => setAddOpen(true)} testID="nutrition-add-meal">
                <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.actionTxt}>Ajouter un repas</Text>
              </Pressable>
              <Pressable style={styles.actionBtnAlt} onPress={() => setSuggestOpen(true)} testID="nutrition-ai-suggest">
                <Ionicons name="sparkles-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.actionTxtAlt}>Idées IA</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.scanMenuBtn}
              onPress={() => { setScanOpen(true); setScanResult(null); setScanImageUri(null); setScanError(null); }}
              testID="nutrition-scan-menu"
            >
              <Ionicons name="camera-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.actionTxtAlt}>Scanner un menu</Text>
            </Pressable>

            <Text style={styles.sectionH}>Repas du jour</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <View style={styles.mealRow} testID={`meal-row-${item.id}`}>
            <View style={styles.mealIcon}>
              <Ionicons name="restaurant-outline" size={18} color={colors.onBrandTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mealName}>{item.name}</Text>
              <Text style={styles.mealSub}>{item.meal_type} · {item.calories} kcal</Text>
              {item.protein_g != null || item.carbs_g != null || item.fat_g != null ? (
                <Text style={styles.mealMacros}>
                  P {item.protein_g ?? 0}g · G {item.carbs_g ?? 0}g · L {item.fat_g ?? 0}g
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => deleteMeal(item.id)} style={styles.deleteBtn} testID={`meal-delete-${item.id}`}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState title="Aucun repas enregistré" subtitle="Ajoutez votre premier repas de la journée." testID="nutrition-empty" />
          ) : (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
          )
        }
      />

      {/* Add Meal Modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={styles.modalCard}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Nouveau repas</Text>
              <Text style={styles.modalSub}>
                {`Il vous reste ${remaining} kcal à répartir sur ${mealsRemaining} repas restant${mealsRemaining > 1 ? "s" : ""} · ~${perRemainingMeal} kcal/repas`}
              </Text>

              <Input
                label="Décrivez ce que vous avez mangé"
                placeholder="Ex : 150g de riz avec du poulet grillé et une salade"
                value={mealDesc}
                onChangeText={setMealDesc}
                multiline
                testID="meal-desc-input"
              />
              <Pressable
                onPress={estimateFromDesc}
                disabled={estimating || !mealDesc.trim()}
                style={[styles.estimateBtn, (!mealDesc.trim() || estimating) && { opacity: 0.4 }]}
                testID="meal-estimate-btn"
              >
                <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
                <Text style={styles.estimateBtnTxt}>
                  {estimating ? "Estimation en cours…" : "Estimer les calories via IA"}
                </Text>
              </Pressable>

              {breakdown ? (
                <View style={styles.breakdownBox} testID="meal-breakdown">
                  <Text style={styles.breakdownTxt}>{breakdown}</Text>
                </View>
              ) : null}

              <Input label="Nom" placeholder="Ex : Poulet et riz" value={mealName} onChangeText={setMealName} testID="meal-name-input" />
              <Input label="Calories" placeholder="450" keyboardType="numeric" value={mealCal} onChangeText={setMealCal} testID="meal-cal-input" />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Protéines (g)" placeholder="30" keyboardType="decimal-pad" value={mealProtein} onChangeText={setMealProtein} testID="meal-protein-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Glucides (g)" placeholder="50" keyboardType="decimal-pad" value={mealCarbs} onChangeText={setMealCarbs} testID="meal-carbs-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Lipides (g)" placeholder="15" keyboardType="decimal-pad" value={mealFat} onChangeText={setMealFat} testID="meal-fat-input" />
                </View>
              </View>
              <Text style={styles.subLabel}>Type</Text>
              <View style={styles.chipsRow}>
                {MEAL_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setMealType(t)}
                    style={[styles.chip, mealType === t && styles.chipActive]}
                    testID={`meal-type-${t}`}
                  >
                    <Text style={[styles.chipTxt, mealType === t && styles.chipTxtActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <Button title="Enregistrer" onPress={submitMeal} loading={saving} testID="meal-save-button" style={{ marginTop: spacing.md }} />
              <Pressable onPress={() => { setAddOpen(false); setBreakdown(null); }} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* AI Suggest Modal */}
      <Modal visible={suggestOpen} transparent animationType="slide" onRequestClose={() => setSuggestOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { maxHeight: "85%" }]}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Idées repas IA</Text>
              <Text style={styles.modalSub}>{`Cible : ~${Math.round(goal / (user?.meals_per_day ?? 4))} kcal par repas (basé sur votre profil)`}</Text>

              <Text style={styles.subLabel}>Type</Text>
              <View style={styles.chipsRow}>
                {MEAL_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setSuggestType(t)}
                    style={[styles.chip, suggestType === t && styles.chipActive]}
                  >
                    <Text style={[styles.chipTxt, suggestType === t && styles.chipTxtActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>

              <Input label="Préférences (facultatif)" placeholder="Ex : végétarien, sans gluten" value={suggestPref} onChangeText={setSuggestPref} />
              <Button title="Générer" onPress={runSuggest} loading={suggestLoading} testID="meal-ai-generate" />

              <ScrollView style={{ marginTop: spacing.md }}>
                {suggestions.map((s, i) => (
                  <View key={i} style={styles.sugCard} testID={`meal-suggestion-${i}`}>
                    <Text style={styles.sugName}>{s.name}</Text>
                    <Text style={styles.sugCal}>
                      {s.calories} kcal
                      {s.protein_g != null ? ` · P ${s.protein_g}g · G ${s.carbs_g}g · L ${s.fat_g}g` : ""}
                    </Text>
                    <Text style={styles.sugDesc}>{s.description}</Text>
                    {s.ingredients.length > 0 ? (
                      <Text style={styles.sugIngr}>Ingrédients : {s.ingredients.join(", ")}</Text>
                    ) : null}
                    <Pressable style={styles.addSugBtn} onPress={() => addSuggested(s)} testID={`meal-suggestion-add-${i}`}>
                      <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
                      <Text style={{ color: colors.onBrandPrimary, fontSize: font.base }}>Ajouter</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Pressable onPress={() => setSuggestOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Fermer</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Menu Scan Modal */}
      <Modal visible={scanOpen} transparent animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={styles.modalBg}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { maxHeight: "88%" }]}>
              <View style={styles.dragHandle} />
              <Text style={styles.modalTitle}>Scanner un menu</Text>
              <Text style={styles.modalSub}>
                Prenez en photo un menu de restaurant, l'IA vous recommande le plat le plus adapté à votre objectif.
              </Text>

              {!scanImageUri ? (
                <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
                  <Pressable style={[styles.actionBtn, { flex: 1 }]} onPress={() => pickMenuImage("camera")} testID="scan-menu-camera">
                    <Ionicons name="camera" size={18} color={colors.onBrandPrimary} />
                    <Text style={styles.actionTxt}>Prendre une photo</Text>
                  </Pressable>
                  <Pressable style={[styles.actionBtnAlt, { flex: 1 }]} onPress={() => pickMenuImage("library")} testID="scan-menu-library">
                    <Ionicons name="image-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.actionTxtAlt}>Galerie</Text>
                  </Pressable>
                </View>
              ) : (
                <Image source={{ uri: scanImageUri }} style={styles.scanPreview} resizeMode="cover" />
              )}

              {scanning ? (
                <View style={{ alignItems: "center", padding: spacing.lg }}>
                  <ActivityIndicator color={colors.brandPrimary} />
                  <Text style={{ color: colors.onSurfaceSecondary, marginTop: spacing.sm }}>Analyse du menu…</Text>
                </View>
              ) : null}

              {scanError ? <Text style={styles.err}>{scanError}</Text> : null}

              {scanResult ? (
                scanResult.menu_lisible ? (
                  <ScrollView style={{ marginTop: spacing.sm }}>
                    <View style={styles.sugCard}>
                      <Text style={styles.sugName}>{scanResult.plat_recommande}</Text>
                      <Text style={styles.sugCal}>
                        {scanResult.calories} kcal · P {scanResult.protein_g}g · G {scanResult.carbs_g}g · L {scanResult.fat_g}g
                      </Text>
                      <Text style={styles.sugDesc}>{scanResult.raison}</Text>
                      {scanResult.autres_options.length > 0 ? (
                        <Text style={styles.sugIngr}>Autres options : {scanResult.autres_options.join(", ")}</Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.sm }}>
                      Il vous reste {scanResult.remaining_calories} kcal aujourd'hui.
                    </Text>
                    <Text style={styles.subLabel}>Type de repas</Text>
                    <View style={styles.chipsRow}>
                      {MEAL_TYPES.map((t) => (
                        <Pressable
                          key={t}
                          onPress={() => setSuggestType(t)}
                          style={[styles.chip, suggestType === t && styles.chipActive]}
                        >
                          <Text style={[styles.chipTxt, suggestType === t && styles.chipTxtActive]}>{t}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Button title="Enregistrer ce repas" onPress={saveScannedMeal} loading={saving} testID="scan-menu-save" />
                  </ScrollView>
                ) : (
                  <Text style={styles.err}>{scanResult.raison || "Menu illisible, réessayez avec une photo plus nette."}</Text>
                )
              ) : null}

              {scanImageUri ? (
                <Pressable
                  onPress={() => { setScanImageUri(null); setScanResult(null); setScanError(null); }}
                  style={{ alignItems: "center", padding: spacing.md }}
                >
                  <Text style={{ color: colors.onSurfaceSecondary }}>Reprendre une photo</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => setScanOpen(false)} style={{ alignItems: "center", padding: spacing.sm }}>
                <Text style={{ color: colors.onSurfaceSecondary }}>Fermer</Text>
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
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  list: { padding: spacing.lg, paddingBottom: 120 },
  calorieCard: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  cardLabel: { fontSize: font.sm, color: colors.onBrandTertiary },
  rowBetween: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.xs },
  calBig: { fontSize: 40, color: colors.onBrandTertiary, fontWeight: "500" },
  calGoal: { fontSize: font.lg, color: colors.onBrandTertiary, marginBottom: 8 },
  progressBar: { height: 8, backgroundColor: "rgba(6,95,70,0.15)", borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.md },
  progressFill: { height: "100%", backgroundColor: colors.brandPrimary },
  calSub: { fontSize: font.base, color: colors.onBrandTertiary, marginTop: spacing.sm },
  perMealRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: "rgba(55,65,81,0.15)",
  },
  perMealTxt: { fontSize: font.sm, color: colors.onBrandTertiary },
  actionsRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md,
  },
  actionTxt: { color: colors.onBrandPrimary, fontSize: font.base },
  actionBtnAlt: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary,
  },
  actionTxtAlt: { color: colors.brandPrimary, fontSize: font.base },
  scanMenuBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary, marginTop: spacing.sm,
  },
  scanPreview: { width: "100%", height: 200, borderRadius: radius.md, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary },
  sectionH: { fontSize: font.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  mealRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
  },
  mealIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  mealName: { fontSize: font.lg, color: colors.onSurface },
  mealSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2, textTransform: "capitalize" },
  mealMacros: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  deleteBtn: { padding: spacing.sm },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxxl,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.md, fontWeight: "500" },
  modalSub: { fontSize: font.base, color: colors.onSurfaceSecondary, marginBottom: spacing.md },
  estimateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary,
    marginBottom: spacing.md,
  },
  estimateBtnTxt: { color: colors.brandPrimary, fontSize: font.base, fontWeight: "500" },
  breakdownBox: {
    padding: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, marginBottom: spacing.md,
  },
  breakdownTxt: { fontSize: font.sm, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  subLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs, marginLeft: spacing.xs },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTxt: { fontSize: font.sm, color: colors.onSurface, textTransform: "capitalize" },
  chipTxtActive: { color: colors.onBrandPrimary },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.xs },
  sugCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
  },
  sugName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  sugCal: { fontSize: font.sm, color: colors.brandPrimary, marginTop: 2 },
  sugDesc: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  sugIngr: { fontSize: font.sm, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  addSugBtn: {
    marginTop: spacing.sm, alignSelf: "flex-start",
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
});
