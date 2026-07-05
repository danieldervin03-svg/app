import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const LEVELS = ["débutant", "intermédiaire", "avancé"] as const;
const DURATIONS = [30, 45, 60, 90];
const EQUIP = ["poids du corps", "haltères", "salle de sport"];
const SESSIONS_PER_WEEK = [2, 3, 4, 5, 6];
const TYPES: { key: "full_body" | "split"; label: string; sub: string }[] = [
  { key: "full_body", label: "Full body", sub: "Corps entier à chaque séance" },
  { key: "split", label: "Split classique", sub: "Lundi pecs+biceps, mardi dos, etc." },
];

export default function GenerateWorkout() {
  const router = useRouter();
  const { user } = useAuth();
  const [programType, setProgramType] = useState<"full_body" | "split">("full_body");
  const [sessions, setSessions] = useState(3);
  const [goal, setGoal] = useState(user?.fitness_goal ?? "prise de masse");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("intermédiaire");
  const [duration, setDuration] = useState(45);
  const [equipment, setEquipment] = useState("salle de sport");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!goal.trim()) {
      setError("Décrivez votre objectif");
      return;
    }
    setLoading(true);
    try {
      const list = await api.generateProgram({
        goal: goal.trim(),
        level,
        program_type: programType,
        sessions_per_week: sessions,
        duration_minutes: duration,
        equipment,
      });
      if (list.length > 0) {
        router.replace(`/(tabs)/workouts` as any);
      }
    } catch (e: any) {
      setError(e.message || "Génération impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="generate-screen">
      <View style={styles.hero}>
        <Image
          source="https://images.unsplash.com/photo-1617957718645-7680362d6312?crop=entropy&cs=srgb&fm=jpg&h=650&w=940&q=80"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.9)", colors.surface]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.heroInner}>
          <Pressable onPress={() => router.back()} style={styles.back} testID="generate-back">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text style={styles.title}>Programme IA</Text>
          <Text style={styles.subtitle}>{"Choisissez le type et le nombre de séances, l'IA construit tout."}</Text>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Type de programme</Text>
          {TYPES.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setProgramType(t.key)}
              style={[styles.typeCard, programType === t.key && styles.typeCardActive]}
              testID={`gen-type-${t.key}`}
            >
              <View style={styles.radio}>
                {programType === t.key ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.typeLbl}>{t.label}</Text>
                <Text style={styles.typeSub}>{t.sub}</Text>
              </View>
            </Pressable>
          ))}

          <Text style={styles.label}>Séances par semaine</Text>
          <View style={styles.chips}>
            {SESSIONS_PER_WEEK.map((n) => (
              <Pressable
                key={n}
                onPress={() => setSessions(n)}
                style={[styles.chip, sessions === n && styles.chipActive]}
                testID={`gen-sessions-${n}`}
              >
                <Text style={[styles.chipTxt, sessions === n && styles.chipTxtActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Input
            label="Objectif"
            placeholder="Ex : prise de masse, perte de poids…"
            value={goal}
            onChangeText={setGoal}
            testID="gen-goal-input"
          />

          <Text style={styles.label}>Niveau</Text>
          <View style={styles.chips}>
            {LEVELS.map((l) => (
              <Pressable
                key={l}
                onPress={() => setLevel(l)}
                style={[styles.chip, level === l && styles.chipActive]}
                testID={`gen-level-${l}`}
              >
                <Text style={[styles.chipTxt, level === l && styles.chipTxtActive]}>{l}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Durée (min)</Text>
          <View style={styles.chips}>
            {DURATIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                style={[styles.chip, duration === d && styles.chipActive]}
                testID={`gen-duration-${d}`}
              >
                <Text style={[styles.chipTxt, duration === d && styles.chipTxtActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Équipement</Text>
          <View style={styles.chips}>
            {EQUIP.map((e) => (
              <Pressable
                key={e}
                onPress={() => setEquipment(e)}
                style={[styles.chip, equipment === e && styles.chipActive]}
                testID={`gen-equip-${e}`}
              >
                <Text style={[styles.chipTxt, equipment === e && styles.chipTxtActive]}>{e}</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Button
            title={loading ? "Génération en cours…" : `Générer ${sessions} séances`}
            onPress={submit}
            loading={loading}
            testID="gen-submit"
            style={{ marginTop: spacing.md }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200 },
  heroInner: { flex: 1, padding: spacing.lg, justifyContent: "flex-end" },
  back: {
    position: "absolute", top: spacing.md, left: spacing.md,
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  label: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs, marginLeft: spacing.xs, marginTop: spacing.md },
  typeCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  typeCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  typeLbl: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  typeSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipTxt: { fontSize: font.sm, color: colors.onSurface, textTransform: "capitalize" },
  chipTxtActive: { color: colors.onBrandPrimary },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.sm },
});
