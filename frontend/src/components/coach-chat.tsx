import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { api, CoachMessage } from "@/src/api";

export function CoachChat({
  visible,
  onClose,
  workoutId,
  title = "Coach IA",
}: {
  visible: boolean;
  onClose: () => void;
  workoutId?: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.coachMessages(workoutId);
      setMessages(list);
    } catch {}
    setLoading(false);
  }, [workoutId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const optimistic: CoachMessage = {
      id: `local-${Date.now()}`,
      user_id: "me",
      workout_id: workoutId ?? null,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const reply = await api.coachChat(text, workoutId);
      setMessages((m) => [...m, reply]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          user_id: "sys",
          workout_id: workoutId ?? null,
          role: "assistant",
          content: e.message || "Erreur du coach IA",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    try {
      await api.coachClear(workoutId);
      setMessages([]);
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.container} testID="coach-chat">
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.iconBtn} testID="coach-close">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>Votre entraîneur virtuel</Text>
          </View>
          <Pressable onPress={clear} style={styles.iconBtn} testID="coach-clear">
            <Ionicons name="refresh-outline" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
            ) : messages.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="sparkles-outline" size={28} color={colors.onBrandTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Bonjour, je suis votre Coach IA 👋</Text>
                <Text style={styles.emptyTxt}>
                  Je suis là pour discuter avec vous de votre entraînement : la forme d'un exercice, comment le
                  remplacer, votre récupération, votre progression, ou toute question sur votre pratique sportive.
                </Text>
                <Text style={styles.emptyNote}>
                  Petite précision : je ne crée pas de programme directement ici — pour ça, utilisez le bouton
                  « Générer un programme IA » sur l'écran Entraînements. Mais je peux vous aider à savoir quoi lui
                  demander !
                </Text>
                <View style={styles.suggestions}>
                  {[
                    "Comment améliorer ma forme au squat ?",
                    "Par quoi remplacer les tractions ?",
                    "Comment bien récupérer après une séance ?",
                  ].map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setInput(s)}
                      style={styles.suggestionChip}
                      testID={`coach-suggestion-${s.slice(0, 8)}`}
                    >
                      <Text style={styles.suggestionTxt}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              messages.map((m) => (
                <View
                  key={m.id}
                  style={[
                    styles.bubbleRow,
                    m.role === "user" ? styles.rowRight : styles.rowLeft,
                  ]}
                  testID={`coach-msg-${m.role}`}
                >
                  <View
                    style={[
                      styles.bubble,
                      m.role === "user" ? styles.bubbleUser : styles.bubbleAI,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleTxt,
                        m.role === "user" ? { color: colors.onBrandPrimary } : { color: colors.onSurface },
                      ]}
                    >
                      {m.content}
                    </Text>
                  </View>
                </View>
              ))
            )}
            {sending ? (
              <View style={[styles.bubbleRow, styles.rowLeft]}>
                <View style={[styles.bubble, styles.bubbleAI, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={{ color: colors.onSurfaceSecondary }}>Le coach réfléchit…</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Écrivez votre question…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
              testID="coach-input"
            />
            <Pressable
              onPress={send}
              disabled={sending || !input.trim()}
              style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
              testID="coach-send"
            >
              <Ionicons name="send" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: font.lg, color: colors.onSurface, fontWeight: "500" },
  sub: { fontSize: font.sm, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  emptyTxt: { fontSize: font.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  emptyTitle: { fontSize: font.lg, color: colors.onSurface, fontWeight: "600", textAlign: "center" },
  emptyNote: {
    fontSize: font.sm, color: colors.onSurfaceSecondary, textAlign: "center",
    backgroundColor: colors.brandTertiary, padding: spacing.sm, borderRadius: radius.md,
  },
  suggestions: { width: "100%", gap: spacing.sm, marginTop: spacing.sm },
  suggestionChip: {
    borderWidth: 1, borderColor: colors.brandSecondary, borderRadius: radius.pill,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  suggestionTxt: { fontSize: font.sm, color: colors.brandPrimary, textAlign: "center" },
  bubbleRow: { flexDirection: "row", marginBottom: spacing.sm },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
  },
  bubbleUser: { backgroundColor: colors.brandPrimary, borderBottomRightRadius: 6 },
  bubbleAI: { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 6 },
  bubbleTxt: { fontSize: font.base, lineHeight: 20 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.base,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
});
