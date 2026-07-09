import React, { useEffect } from "react";
import { StyleSheet, Text, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

type Props = {
  onFinished: () => void;
  /** Minimum time the splash stays fully visible before it can fade out (ms) */
  minDurationMs?: number;
};

export function AnimatedSplash({ onFinished, minDurationMs = 1400 }: Props) {
  const markScale = useSharedValue(0.7);
  const markOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(12);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    markScale.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.4)) });
    textOpacity.value = withDelay(260, withTiming(1, { duration: 420 }));
    textTranslateY.value = withDelay(260, withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }));

    overlayOpacity.value = withDelay(
      minDurationMs,
      withTiming(0, { duration: 380, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onFinished)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
      <LinearGradient
        colors={["#365314", "#A3E635"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.Image
        source={require("@/assets/images/adaptive-icon.png")}
        style={[styles.mark, markStyle]}
        resizeMode="contain"
      />
      <Animated.View style={textStyle}>
        <Text style={styles.title}>Bodypilot</Text>
        <Text style={styles.tagline}>Votre coach fitness intelligent</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width,
    height,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  mark: { width: 160, height: 160, marginBottom: 20 },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  tagline: {
    fontSize: 15,
    color: "#E8F5D2",
    textAlign: "center",
    marginTop: 6,
  },
});
