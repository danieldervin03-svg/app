import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, TextInputProps, ViewStyle } from "react-native";
import { colors, radius, spacing, font } from "@/src/theme";
import * as Haptics from "expo-haptics";

// ============ Primary button ============
export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  testID?: string;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const bg =
    variant === "primary" ? colors.brandPrimary : variant === "secondary" ? colors.brandTertiary : "transparent";
  const fg =
    variant === "primary" ? colors.onBrandPrimary : variant === "secondary" ? colors.onBrandTertiary : colors.brandPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (isDisabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={[
        styles.btn,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.brandPrimary },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnTxt, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

// ============ Text input ============
export function Input(props: TextInputProps & { label?: string; errorText?: string }) {
  const { label, errorText, style, ...rest } = props;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, errorText ? { borderColor: colors.error } : null, style]}
        {...rest}
      />
      {errorText ? <Text style={styles.err}>{errorText}</Text> : null}
    </View>
  );
}

// ============ Card ============
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ============ Section header ============
export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

// ============ Empty ============
export function EmptyState({ title, subtitle, testID }: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View style={styles.empty} testID={testID}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  btnTxt: { fontSize: font.lg, fontWeight: "500" },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.lg,
    fontSize: font.lg,
    color: colors.onSurface,
  },
  inputLabel: { fontSize: font.sm, color: colors.onSurfaceSecondary, marginBottom: spacing.xs, marginLeft: spacing.xs },
  err: { color: colors.error, fontSize: font.sm, marginTop: spacing.xs, marginLeft: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: { fontSize: font.xl, color: colors.onSurface, fontWeight: "500" },
  empty: { alignItems: "center", padding: spacing.xxl },
  emptyTitle: { fontSize: font.lg, color: colors.onSurface, textAlign: "center" },
  emptySub: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm, textAlign: "center" },
});
