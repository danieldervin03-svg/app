import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { colors, font, radius, spacing } from "@/src/theme";
import { Card } from "@/src/components/ui";
import { CoachChat } from "@/src/components/coach-chat";
import { api, TodaySummary } from "@/src/api";
import { useAuth } from "@/src/auth";

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.summaryToday();
      setSummary(s);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const consumed = summary?.calories_consumed ?? 0;
  const goal = summary?.calorie_goal ?? user?.calorie_goal ?? 2000;
  const remaining = Math.max(0, goal - consumed);
  const percent = Math.min(1, consumed / Math.max(1, goal));

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <LinearGradient colors={[colors.brandTertiary, colors.surface]} style={{ flex: 1 }}>
    <SafeAreaView style={styles.container} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <LinearGradient
          colors={[colors.onBrandSecondary, colors.brand, colors.brandSecondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Ionicons name="barbell" size={140} color="rgba(255,255,255,0.10)" style={styles.heroDecor} />

          <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
          <Text style={styles.hello} testID="home-greeting">Bonjour {user?.name} 👋</Text>

          {!user?.sex || !user?.age || !user?.height_cm || !user?.weight_kg ? (
            <Pressable
              style={styles.profileBanner}
              onPress={() => router.push("/(tabs)/profile")}
              testID="home-profile-banner"
            >
              <Ionicons name="information-circle" size={22} color={colors.onBrandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Personnalisez votre objectif calorique</Text>
                <Text style={styles.bannerSub}>Renseignez votre profil santé (sexe, âge, taille, poids, objectif) pour un calcul précis.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          ) : null}

          <View style={styles.calorieCard}>
            <Text style={styles.cardLabel}>Calories restantes</Text>
            <Text style={styles.calorieBig} testID="home-calories-remaining">{remaining}</Text>
            <Text style={styles.calorieSub}>sur {goal} kcal · {consumed} consommées</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${percent * 100}%` }]} />
            </View>

            <View style={styles.macroRow}>
              {[
                { key: "protein", label: "Protéines", icon: "flash" as const, color: "#FB7185", remaining: summary?.protein_remaining_g, goal: summary?.protein_goal_g },
                { key: "carbs", label: "Glucides", icon: "leaf" as const, color: "#FBBF24", remaining: summary?.carbs_remaining_g, goal: summary?.carbs_goal_g },
                { key: "fat", label: "Lipides", icon: "water" as const, color: "#60A5FA", remaining: summary?.fat_remaining_g, goal: summary?.fat_goal_g },
              ].map((m) => {
                const g = m.goal ?? 0;
                const r = m.remaining ?? g;
                const pct = g > 0 ? Math.min(1, Math.max(0, (g - r) / g)) : 0;
                return (
                  <View key={m.key} style={styles.macroItem}>
                    <View style={styles.macroHeader}>
                      <View style={[styles.macroIconDot, { backgroundColor: m.color }]}>
                        <Ionicons name={m.icon} size={11} color="#FFF" />
                      </View>
                      <Text style={styles.macroValue}>{Math.max(0, Math.round(r))}g</Text>
                    </View>
                    <Text style={styles.macroLabel}>{m.label}</Text>
                    <View style={styles.macroBarTrack}>
                    <View style={[styles.macroBarFill, { width: `${pct * 100}%`, backgroundColor: m.color }]} />
                  </View>
                </View>
              );
            })}
          </View>
          </View>
        </LinearGradient>

        <Pressable
          onPress={() => (summary?.next_workout ? router.push(`/workout/${summary.next_workout.id}` as any) : router.push("/(tabs)/workouts"))}
          testID="home-next-workout"
        >
          <View style={styles.workoutCard}>
            <Image
              source="https://images.pexels.com/photos/36717701/pexels-photo-36717701.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
            <LinearGradient
              colors={["rgba(17,24,39,0.15)", "rgba(17,24,39,0.75)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.workoutInner}>
              <Text style={styles.workoutOverline}>Prochain entraînement</Text>
              <Text style={styles.workoutTitle} numberOfLines={2}>
                {summary?.next_workout?.title ?? "Aucun entraînement planifié"}
              </Text>
              <Text style={styles.workoutSub}>
                {summary?.next_workout
                  ? `${summary.next_workout.exercises.length} exercices`
                  : "Créez votre premier programme"}
              </Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.row}>
          <Card style={styles.statCard}>
            <LinearGradient colors={[colors.brand, colors.brandPrimary]} style={styles.iconWrap}>
              <Ionicons name="flame-outline" size={20} color={colors.onBrandPrimary} />
            </LinearGradient>
            <Text style={styles.statValue}>{summary?.meals_today ?? 0}</Text>
            <Text style={styles.statLabel}>{"Repas aujourd'hui"}</Text>
          </Card>
          <Card style={styles.statCard}>
            <LinearGradient colors={[colors.brand, colors.brandPrimary]} style={styles.iconWrap}>
              <Ionicons name="barbell-outline" size={20} color={colors.onBrandPrimary} />
            </LinearGradient>
            <Text style={styles.statValue}>{summary?.workouts_done_this_week ?? 0}</Text>
            <Text style={styles.statLabel}>Séances / semaine</Text>
          </Card>
        </View>

        <View style={styles.quickActions}>
          <Pressable
            style={styles.quickBtn}
            onPress={() => router.push("/workout/generate" as any)}
            testID="home-quick-generate"
          >
            <Ionicons name="sparkles-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.quickTxt}>Générer un programme IA</Text>
          </Pressable>
          <Pressable
            style={styles.quickBtn}
            onPress={() => router.push("/(tabs)/nutrition")}
            testID="home-quick-meal"
          >
            <Ionicons name="restaurant-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.quickTxt}>Logger un repas</Text>
          </Pressable>
          <Pressable
            style={styles.quickBtn}
            onPress={() => setCoachOpen(true)}
            testID="home-quick-coach"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.quickTxt}>Parler au Coach IA</Text>
          </Pressable>
        </View>
      </ScrollView>

      <CoachChat visible={coachOpen} onClose={() => setCoachOpen(false)} />
    </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  hero: {
    borderRadius: radius.lg, padding: spacing.lg,
    overflow: "hidden", position: "relative",
  },
  heroDecor: { position: "absolute", top: -20, right: -20, transform: [{ rotate: "-18deg" }] },
  date: { fontSize: font.sm, color: "rgba(255,255,255,0.8)", textTransform: "capitalize" },
  hello: { fontSize: font.xxl, color: colors.onBrandPrimary, fontWeight: "600", marginTop: spacing.xs, marginBottom: spacing.lg },
  profileBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, marginBottom: spacing.md,
    backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.md,
  },
  bannerTitle: { fontSize: font.base, color: colors.onBrandPrimary, fontWeight: "500" },
  bannerSub: { fontSize: font.sm, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  calorieCard: { alignItems: "flex-start" },
  cardLabel: { fontSize: font.sm, color: "rgba(255,255,255,0.85)" },
  calorieBig: { fontSize: 48, color: colors.onBrandPrimary, fontWeight: "600", marginTop: spacing.xs },
  calorieSub: { fontSize: font.base, color: "rgba(255,255,255,0.85)", marginBottom: spacing.md },
  progressBar: { height: 8, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: radius.pill, width: "100%", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.onBrandPrimary },
  macroRow: { flexDirection: "row", width: "100%", gap: spacing.md, marginTop: spacing.lg },
  macroItem: { flex: 1 },
  macroHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  macroIconDot: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  macroValue: { fontSize: font.lg, color: colors.onBrandPrimary, fontWeight: "600" },
  macroLabel: { fontSize: font.sm, color: "rgba(255,255,255,0.85)", marginBottom: 6 },
  macroBarTrack: { height: 5, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: radius.pill, overflow: "hidden" },
  macroBarFill: { height: "100%", borderRadius: radius.pill },
  workoutCard: {
    height: 160,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  workoutInner: { flex: 1, padding: spacing.lg, justifyContent: "flex-end" },
  workoutOverline: { fontSize: font.sm, color: colors.brandTertiary, textTransform: "uppercase", letterSpacing: 1 },
  workoutTitle: { fontSize: font.xl, color: colors.onSurfaceInverse, marginTop: spacing.xs, fontWeight: "500" },
  workoutSub: { fontSize: font.base, color: "rgba(255,255,255,0.85)", marginTop: spacing.xs },
  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  statCard: { flex: 1, alignItems: "flex-start" },
  iconWrap: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  statValue: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  statLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  quickActions: { marginTop: spacing.xl, gap: spacing.md },
  quickBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.divider,
  },
  quickTxt: { fontSize: font.lg, color: colors.onBrandTertiary },
});
