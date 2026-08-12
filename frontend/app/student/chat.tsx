import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, KeyboardAvoidingView, Platform, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { api, StudentMessage } from "@/src/api";

export default function CoachStudentChatScreen() {
  const router = useRouter();
  const { studentId, studentName } = useLocalSearchParams<{ studentId: string; studentName?: string }>();

  const [messages, setMessages] = useState<StudentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await api.coachGetChatWithStudent(studentId);
      setMessages(res.messages);
    } catch {} finally {
      setLoading(false);
    }
  }, [studentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    if (!studentId || !input.trim()) return;
    setSending(true);
    const text = input.trim();
    setInput("");
    try {
      const msg = await api.coachSendChatToStudent(studentId, text);
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {} finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="coach-chat-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="chat-back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{studentName || "Élève"}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.emptyTxt}>Envoyez un premier message pour démarrer la conversation.</Text>
            }
            renderItem={({ item }) => (
              <View style={[styles.bubbleRow, item.sender_role === "coach" ? styles.bubbleRowMe : styles.bubbleRowThem]}>
                <View style={[styles.bubble, item.sender_role === "coach" ? styles.bubbleMe : styles.bubbleThem]}>
                  <Text style={[styles.bubbleTxt, item.sender_role === "coach" && { color: colors.onBrandPrimary }]}>
                    {item.content}
                  </Text>
                </View>
              </View>
            )}
          />
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Votre message…"
            value={input}
            onChangeText={setInput}
            multiline
            testID="chat-input"
          />
          <Pressable onPress={send} disabled={sending || !input.trim()} style={[styles.sendBtn, (sending || !input.trim()) && { opacity: 0.4 }]} testID="chat-send">
            <Ionicons name="send" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: font.lg, color: colors.onSurface, fontWeight: "500", textAlign: "center" },
  list: { padding: spacing.lg, flexGrow: 1 },
  emptyTxt: { textAlign: "center", color: colors.onSurfaceSecondary, marginTop: spacing.xl },
  bubbleRow: { marginBottom: spacing.sm, flexDirection: "row" },
  bubbleRowMe: { justifyContent: "flex-end" },
  bubbleRowThem: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: radius.lg, padding: spacing.md },
  bubbleMe: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleTxt: { fontSize: font.base, color: colors.onSurface },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: spacing.sm,
    padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  input: {
    flex: 1, maxHeight: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.base, color: colors.onSurface,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
});
