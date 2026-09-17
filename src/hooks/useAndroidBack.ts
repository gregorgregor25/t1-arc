import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Gives an in-screen panel first refusal on Android Back. When disabled,
 * React Navigation keeps its normal tab/back behaviour.
 */
export function useAndroidBack(
  enabled: boolean,
  onBack: () => void,
) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled || Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          onBack();
          return true;
        },
      );
      return () => subscription.remove();
    }, [enabled, onBack]),
  );
}
