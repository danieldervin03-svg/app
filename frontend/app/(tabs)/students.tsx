import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Modal, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type Student = {
  id: string; name: string; email: string; calorie_goal: number;
  meals_today: number; linked_since: string;
};

export default function StudentsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.coachStudents();
      setStudents(res.students);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const removeStudent = (s: Student) => {
    Alert.alert(
      "Retirer cet élève",
      `${s.name} ne sera plus lié à votre compte coach. Il pourra se relier avec un nouveau code si besoin.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer", style: "destructive",
          onPress: async () => {
            await api.coachRemoveStudent(s.id).catch(() => {});
            await load();
          },
        },
      ]
    );
  };

  const copyCode = async () => {
    if (!user?.coach_code) return;
    await Clipboard.setStringAsync(user.coach_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SafeAreaView style={styles.container} testID="students-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Mes élèves</Text>
        <Pressable onPress={() => setCodeOpen(true)} style={styles.codeBtn} testID="students-show-code">
          <Ionicons name="key-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.codeBtnTxt}>Mon code</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
      ) : students.length === 0 ? (
        <EmptyState
          title="Aucun élève pour l'instant"
          subtitle="Partagez votre code coach pour que vos élèves rejoignent votre suivi."
          testID="students-empty"
        />
      ) : (
        <FlatList
          data={students}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/student/${item.id}` as any)}
              style={styles.card}
              testID={`student-card-${item.id}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardSub}>{item.meals_today} repas aujourd'hui · {item.calorie_goal} kcal cible</Text>
              </View>
              <Pressable onPress={() => removeStudent(item)} style={styles.removeBtn} testID={`student-remove-${item.id}`}>
                <Ionicons name="close-circle-outline" size={20} color={colors.error} />
              </Pressable>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <Modal visible={codeOpen} transparent animationType="slide" onRequestClose={() => setCodeOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.dragHandle} />
            <Text style={styles.modalTitle}>Votre code coach</Text>
            <Text style={styles.modalSub}>Partagez ce code à vos élèves pour qu'ils rejoignent votre suivi.</Text>
            <Pressable onPress={copyCode} style={styles.codeDisplay} testID="students-copy-code">
              <Text style={styles.codeTxt}>{user?.coach_code}</Text>
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={20} color={colors.brandPrimary} />
            </Pressable>
            {copied ? <Text style={styles.copiedTxt}>Copié !</Text> : null}
            <Pressable onPress={() => setCodeOpen(false)} style={{ alignItems: "center", padding: spacing.md }}>
              <Text style={{ color: colors.onSurfaceSecondary }}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg,
  },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  codeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  codeBtnTxt: { color: colors.brandPrimary, fontSize: font.sm, fontWeight: "500" },
  list: { padding: spacing.lg, paddingTop: 0, paddingBottom: 120 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { color: colors.onBrandPrimary, fontSize: font.lg, fontWeight: "600" },
  cardName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  cardSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  removeBtn: { padding: 4 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing.xxxl,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: colors.borderStrong, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  modalTitle: { fontSize: font.xl, color: colors.onSurface, marginBottom: spacing.xs, fontWeight: "500" },
  modalSub: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.lg },
  codeDisplay: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg,
  },
  codeTxt: { fontSize: 28, letterSpacing: 4, color: colors.onBrandTertiary, fontWeight: "700" },
  copiedTxt: { color: colors.brandPrimary, textAlign: "center", marginTop: spacing.sm, fontSize: font.sm },
});
