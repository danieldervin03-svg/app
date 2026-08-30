import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform, Modal } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { Button } from "@/src/components/ui";
import { api } from "@/src/api";

/** Compares two "1.2.3"-style version strings. Returns true if `latest` is
 * strictly newer than `current`. */
function isNewer(current: string, latest: string): boolean {
  const c = current.split(".").map((n) => parseInt(n, 10) || 0);
  const l = latest.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

export function UpdateChecker() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [message, setMessage] = useState("");
  const [forceUpdate, setForceUpdate] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const info = await api.checkAppVersion();
        const currentVersion = Constants.expoConfig?.version ?? "1.0.0";
        const latest = Platform.OS === "ios" ? info.latest_version_ios : info.latest_version_android;
        const url = Platform.OS === "ios" ? info.ios_url : info.android_url;
        if (isNewer(currentVersion, latest)) {
          setStoreUrl(url);
          setMessage(info.message || "");
          setForceUpdate(!!info.force_update);
          setVisible(true);
        }
      } catch {
        // Silently ignore — never block app usage just because the version
        // check itself failed (e.g. no network yet).
      }
    };
    check();
  }, []);

  const openStore = () => {
    if (storeUrl) Linking.openURL(storeUrl).catch(() => {});
  };

  if (!visible || dismissed) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !forceUpdate && setDismissed(true)}>
      <View style={styles.bg}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="rocket-outline" size={28} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.title}>Nouvelle version disponible</Text>
          <Text style={styles.subtitle}>
            {message || "Une nouvelle version de Bodypilot est disponible avec des améliorations et corrections."}
          </Text>
          <Button title="Mettre à jour" onPress={openStore} style={{ width: "100%", marginTop: spacing.lg }} testID="update-now-btn" />
          {!forceUpdate ? (
            <Pressable onPress={() => setDismissed(true)} style={{ padding: spacing.md }} testID="update-later-btn">
              <Text style={{ color: colors.onSurfaceSecondary }}>Plus tard</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: "center", width: "100%", borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  title: { fontSize: font.xl, color: colors.onSurface, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: font.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm, textAlign: "center" },
});
