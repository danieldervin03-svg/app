import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";

import { colors, font, radius, spacing } from "@/src/theme";
import { CoachChat } from "@/src/components/coach-chat";
import { api, TodaySummary } from "@/src/api";
import { useAuth } from "@/src/auth";

const RING_SIZE = 64;
const RING_STROKE = 6;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachChatSummary, setCoachChatSummary] = useState<{ has_coach: boolean; latest: { content: string; sender_role: string; created_at: string } | null; unread_count: number } | null>(null);

  // Safety net: coach accounts should never land on this screen, no matter how
  // they got here (restored navigation state, deep link, etc).
  useEffect(() => {
    if (user?.role === "coach") {
      router.replace("/(tabs)/students" as any);
    }
  }, [user?.role, router]);

  const load = useCallback(async () => {
    try {
      const s = await api.summaryToday();
      setSummary(s);
    } catch {}
    if (user?.coach_id) {
      try {
        const c = await api.myCoachChatSummary();
        setCoachChatSummary(c);
      } catch {}
    }
  }, [user?.coach_id]);

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

  if (user?.role === "coach") {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  const macros = [
    { key: "protein", label: "Protéines", color: "#FF6B6B", remaining: summary?.protein_remaining_g, goal: summary?.protein_goal_g },
    { key: "carbs", label: "Glucides", color: colors.brandPrimary, remaining: summary?.carbs_remaining_g, goal: summary?.carbs_goal_g },
    { key: "fat", label: "Lipides", color: "#5FA8FF", remaining: summary?.fat_remaining_g, goal: summary?.fat_goal_g },
    { key: "fiber", label: "Fibres", color: "#3DDC9C", remaining: summary?.fiber_remaining_g, goal: summary?.fiber_goal_g },
  ];

  return (
    <SafeAreaView style={styles.container} testID="home-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
        <Text style={styles.hello} testID="home-greeting">Bonjour, {user?.name}</Text>

        {!user?.sex || !user?.age || !user?.height_cm || !user?.weight_kg ? (
          <Pressable
            style={styles.profileBanner}
            onPress={() => router.push("/(tabs)/profile")}
            testID="home-profile-banner"
          >
            <Ionicons name="information-circle" size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Personnalisez votre objectif calorique</Text>
              <Text style={styles.bannerSub}>Renseignez sexe, âge, taille, poids pour un calcul précis.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceSecondary} />
          </Pressable>
        ) : null}

        {/* Calorie glass card */}
        <View style={styles.kcalCard} testID="home-kcal-card">
          <View style={styles.glow} pointerEvents="none" />
          <Text style={styles.cardLabel}>Calories restantes</Text>
          <View style={styles.kcalRow}>
            <Text style={styles.calorieBig} testID="home-calories-remaining">{remaining}</Text>
            <Text style={styles.kcalGoal}>/ {goal} kcal</Text>
          </View>
          <Text style={styles.calorieSub}>{consumed} consommées</Text>

          <View style={styles.ringRow}>
            <View style={{ width: RING_SIZE, height: RING_SIZE }}>
              <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                  cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                  stroke={colors.surfaceTertiary} strokeWidth={RING_STROKE} fill="none"
                />
                <Circle
                  cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                  stroke={colors.brandPrimary} strokeWidth={RING_STROKE} fill="none"
                  strokeDasharray={`${RING_CIRC * percent} ${RING_CIRC}`}
                  strokeLinecap="round"
                  rotation={-90}
                  origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
                />
              </Svg>
              <View style={styles.ringLabelWrap}>
                <Text style={styles.ringLabel}>{Math.round(percent * 100)}%</Text>
              </View>
            </View>

            <View style={styles.macroGrid}>
              {macros.map((m) => {
                const g = m.goal ?? 0;
                const r = m.remaining ?? g;
                const consumedG = Math.round(g - r);
                return (
                  <View key={m.key} style={styles.macroLine}>
                    <View style={[styles.macroDot, { backgroundColor: m.color }]} />
                    <Text style={styles.macroTxt}>
                      <Text style={styles.macroTxtBold}>{consumedG}g</Text> {m.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Next workout */}
        <Text style={styles.sectionTitle}>Prochain entraînement</Text>
        <Pressable
          onPress={() => (summary?.next_workout ? router.push(`/workout/${summary.next_workout.id}` as any) : router.push("/(tabs)/workouts"))}
          testID="home-next-workout"
        >
          <View style={styles.workoutCard}>
            <View style={styles.workoutGlow} pointerEvents="none" />
            <Text style={styles.workoutTag}>
              {summary?.next_workout ? `${summary.next_workout.exercises.length} exercices · Aujourd'hui` : "Aucun programme"}
            </Text>
            <Text style={styles.workoutTitle} numberOfLines={2}>
              {summary?.next_workout?.title ?? "Créez votre premier programme"}
            </Text>
          </View>
        </Pressable>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <Pressable style={styles.quickBtn} onPress={() => router.push("/(tabs)/nutrition")} testID="home-quick-meal">
            <View style={styles.quickIcon}>
              <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.quickLbl}>Ajouter un repas</Text>
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={() => setCoachOpen(true)} testID="home-quick-coach">
            <View style={styles.quickIcon}>
              <Ionicons name="chatbubble-ellipses" size={15} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.quickLbl}>Coach IA</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.quickBtnWide}
          onPress={() => router.push("/workout/generate" as any)}
          testID="home-quick-generate"
        >
          <Ionicons name="sparkles-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.quickWideTxt}>Générer un programme IA</Text>
        </Pressable>

        {/* Weekly stats */}
        <Text style={styles.sectionTitle}>Cette semaine</Text>
        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <Text style={[styles.statVal, styles.statAccent]}>{summary?.workouts_done_this_week ?? 0}</Text>
            <Text style={styles.statLbl}>Séances</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{summary?.meals_today ?? 0}</Text>
            <Text style={styles.statLbl}>{"Repas aujourd'hui"}</Text>
          </View>
        </View>

        {coachChatSummary?.has_coach ? (
          <Pressable onPress={() => router.push("/my-coach-chat" as any)} style={styles.coachCard} testID="home-coach-chat-card">
            <View style={styles.coachIconWrap}>
              <Ionicons name="chatbubble-ellipses" size={20} color={colors.onBrandPrimary} />
              {coachChatSummary.unread_count > 0 ? (
                <View style={styles.unreadDot}>
                  <Text style={styles.unreadDotTxt}>{coachChatSummary.unread_count}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coachCardTitle}>{user?.coach_name ?? "Mon coach"}</Text>
              <Text style={styles.coachCardMsg} numberOfLines={1}>
                {coachChatSummary.latest
                  ? `${coachChatSummary.latest.sender_role === "user" ? "Vous : " : ""}${coachChatSummary.latest.content}`
                  : "Démarrer la conversation"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
        ) : null}
      </ScrollView>

      <CoachChat visible={coachOpen} onClose={() => setCoachOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  date: { fontSize: font.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 1 },
  hello: { fontSize: 26, color: colors.onSurface, fontWeight: "700", marginTop: 4, marginBottom: spacing.lg, letterSpacing: -0.5 },

  profileBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  bannerTitle: { fontSize: font.base, color: colors.onSurface, fontWeight: "500" },
  bannerSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },

  kcalCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, overflow: "hidden", position: "relative",
  },
  glow: {
    position: "absolute", top: -60, right: -60, width: 180, height: 180, borderRadius: 90,
    backgroundColor: colors.brandPrimary, opacity: 0.12,
  },
  cardLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  kcalRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginTop: 6 },
  calorieBig: { fontSize: 44, color: colors.onSurface, fontWeight: "700", letterSpacing: -1.5 },
  kcalGoal: { fontSize: font.base, color: colors.onSurfaceSecondary },
  calorieSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },

  ringRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.lg },
  ringLabelWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  ringLabel: { fontSize: 11, color: colors.brandPrimary, fontWeight: "700" },
  macroGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", rowGap: spacing.sm, columnGap: spacing.md },
  macroLine: { flexDirection: "row", alignItems: "center", gap: 7, width: "45%" },
  macroDot: { width: 7, height: 7, borderRadius: 4 },
  macroTxt: { fontSize: 12, color: colors.onSurfaceSecondary },
  macroTxtBold: { color: colors.onSurface, fontWeight: "700" },

  sectionTitle: {
    fontSize: 11, color: colors.onSurfaceSecondary, textTransform: "uppercase",
    letterSpacing: 1, fontWeight: "600", marginTop: spacing.xl, marginBottom: spacing.md,
  },

  workoutCard: {
    borderRadius: radius.lg, overflow: "hidden", position: "relative",
    height: 150, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    justifyContent: "flex-end", padding: spacing.lg,
  },
  workoutGlow: {
    position: "absolute", bottom: -30, right: -20, width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.brandPrimary, opacity: 0.1,
  },
  workoutTag: {
    color: colors.brandPrimary, fontSize: 10, letterSpacing: 1.2,
    textTransform: "uppercase", fontWeight: "700", marginBottom: 6,
  },
  workoutTitle: { fontSize: font.xl, color: colors.onSurface, fontWeight: "600", letterSpacing: -0.3 },

  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  quickBtn: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, alignItems: "center",
  },
  quickIcon: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  quickLbl: { fontSize: 11, color: colors.onSurface, fontWeight: "500" },
  quickBtnWide: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm,
  },
  quickWideTxt: { fontSize: font.base, color: colors.brandPrimary, fontWeight: "500" },

  statGrid: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  statVal: { fontSize: 22, color: colors.onSurface, fontWeight: "700", letterSpacing: -0.5 },
  statAccent: { color: colors.brandPrimary },
  statLbl: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 3 },

  coachCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md,
    marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  coachIconWrap: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  unreadDot: {
    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  unreadDotTxt: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  coachCardTitle: { fontSize: font.base, color: colors.onSurface, fontWeight: "600" },
  coachCardMsg: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
});
