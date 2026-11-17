import { useContext } from "react";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * System bar insets for edge-to-edge modals and screens. Android draws modal
 * windows behind the status and navigation bars, so bottom-anchored content
 * must pad by these values. Falls back to zero outside a SafeAreaProvider
 * (for example in isolated component tests) instead of throwing.
 */
export function useSystemBarInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? NO_INSETS;
}
