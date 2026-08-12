import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { EmptyState } from "@/src/components/ui";
import { api } from "@/src/api";

type Conversation = {
  student_id: string;
  student_name: string;
  latest: { content: string; sender_role: "coach" | "user"; created_at: string } | null;
  unread_count: number;
};

export default function CoachMessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.coachConversations();
      setConversations(res.conversations);
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
    <SafeAreaView style={styles.container} testID="coach-messages-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
      ) : conversations.length === 0 ? (
        <EmptyState
          title="Aucune conversation"
          subtitle="Vos échanges avec vos élèves apparaîtront ici."
          testID="messages-empty"
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.student_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/student/chat", params: { studentId: item.student_id, studentName: item.student_name } } as any)}
              style={styles.card}
              testID={`conversation-${item.student_id}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{item.student_name.charAt(0).toUpperCase()}</Text>
                {item.unread_count > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeTxt}>{item.unread_count}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardName, item.unread_count > 0 && { fontWeight: "700" }]}>{item.student_name}</Text>
                <Text
                  style={[styles.cardMsg, item.unread_count > 0 && { color: colors.onSurface, fontWeight: "500" }]}
                  numberOfLines={1}
                >
                  {item.latest
                    ? `${item.latest.sender_role === "coach" ? "Vous : " : ""}${item.latest.content}`
                    : "Aucun message pour l'instant"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.lg },
  title: { fontSize: font.xxl, color: colors.onSurface, fontWeight: "500" },
  list: { padding: spacing.lg, paddingTop: 0, paddingBottom: 120 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  avatarTxt: { color: colors.onBrandPrimary, fontSize: font.lg, fontWeight: "600" },
  unreadBadge: {
    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  unreadBadgeTxt: { color: "#FFF", fontSize: 10, fontWeight: "700" },
  cardName: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  cardMsg: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
});
