import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { api, Workout } from "@/src/api";

export default function WorkoutsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <SafeAreaView style={styles.container} testID="workouts-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Entraînements</Text>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.push("/workout/generate" as any)}
          testID="workouts-generate-fab"
        >
          <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.headerBtnTxt}>IA</Text>
        </Pressable>
      </View>

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
          renderItem={({ item }) => (
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
                  {item.week_day ? (
                    <View style={styles.dayPill}>
                      <Text style={styles.dayPillTxt}>{item.week_day}</Text>
                    </View>
                  ) : item.program_type === "full_body" && item.session_index ? (
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
                <Text style={styles.cardSub}>
                  {item.exercises.length} exercices
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={() => router.push("/workout/generate" as any)}
        testID="workouts-fab-generate"
      >
        <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
        <Text style={styles.fabTxt}>{"Demander à l'IA"}</Text>
      </Pressable>
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
  headerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
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
});
