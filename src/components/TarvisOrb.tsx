import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

export type TarvisOrbState = "idle" | "thinking" | "answering" | "complete";

interface Props {
  accentColor: string;
  primaryColor: string;
  size?: number;
  state?: TarvisOrbState;
}

export function TarvisOrb({
  accentColor,
  primaryColor,
  size = 76,
  state = "idle",
}: Props) {
  const [outerRotation] = useState(() => new Animated.Value(0));
  const [innerRotation] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    const appSubscription = AppState.addEventListener("change", (nextState) =>
      setAppActive(nextState === "active"),
    );
    return () => {
      motionSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  useEffect(() => {
    outerRotation.stopAnimation();
    innerRotation.stopAnimation();
    pulse.stopAnimation();
    if (reduceMotion || !appActive || state === "idle") {
      outerRotation.setValue(0);
      innerRotation.setValue(0);
      pulse.setValue(state === "complete" ? 1 : 0);
      return;
    }

    outerRotation.setValue(0);
    innerRotation.setValue(0);

    const outer = Animated.loop(
      Animated.timing(outerRotation, {
        toValue: 1,
        duration: state === "thinking" ? 4_800 : 6_000,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    const inner = Animated.loop(
      Animated.timing(innerRotation, {
        toValue: -1,
        duration: state === "thinking" ? 6_200 : 7_200,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      }),
    );
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          isInteraction: false,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          isInteraction: false,
          useNativeDriver: true,
        }),
      ]),
    );
    outer.start();
    inner.start();
    breathing.start();
    return () => {
      outer.stop();
      inner.stop();
      breathing.stop();
    };
  }, [appActive, innerRotation, outerRotation, pulse, reduceMotion, state]);

  const outerTurn = outerRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const innerTurn = innerRotation.interpolate({
    inputRange: [-1, 0],
    outputRange: ["-360deg", "0deg"],
  });
  const coreScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, state === "complete" ? 1.08 : 1.035],
  });

  return (
    <View
      accessibilityLabel={`Tarv1s ${state}`}
      accessibilityRole="image"
      style={{ width: size, height: size }}
    >
      <Animated.View
        style={[
          styles.layer,
          { transform: [{ rotate: outerTurn }] },
        ]}
      >
        <Svg height={size} viewBox="0 0 100 100" width={size}>
          <Circle
            cx="50"
            cy="50"
            fill="none"
            opacity={0.16}
            r="39"
            stroke={primaryColor}
            strokeWidth="2"
          />
          <Circle
            cx="50"
            cy="50"
            fill="none"
            r="39"
            stroke={primaryColor}
            strokeDasharray="94 151"
            strokeLinecap="round"
            strokeWidth="7"
          />
          <Circle cx="15" cy="39" fill={accentColor} r="3.2" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.layer,
          { transform: [{ rotate: innerTurn }] },
        ]}
      >
        <Svg height={size} viewBox="0 0 100 100" width={size}>
          <Circle
            cx="50"
            cy="50"
            fill="none"
            opacity={0.13}
            r="29"
            stroke={accentColor}
            strokeWidth="2"
          />
          <Circle
            cx="50"
            cy="50"
            fill="none"
            r="29"
            stroke={accentColor}
            strokeDasharray="76 106"
            strokeLinecap="round"
            strokeWidth="7"
          />
          <Circle cx="74" cy="33" fill={primaryColor} r="2.6" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[styles.layer, { transform: [{ scale: coreScale }] }]}
      >
        <Svg height={size} viewBox="0 0 100 100" width={size}>
          <Circle cx="50" cy="50" fill={accentColor} opacity={0.18} r="20" />
          <Circle cx="50" cy="50" fill={accentColor} r="13" />
          <Path
            d="M38 51h8l4-9 7 18 4-9h7"
            fill="none"
            stroke="#111217"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3.2"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
