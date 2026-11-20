import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function text(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Android Back navigation', () => {
  it('keeps Android Back inside the app on Android 13 to 15', () => {
    // React Native 0.86 only hands Back to JavaScript through its own callback
    // on Android 16 or newer. With predictive back turned on, Android 13 to 15
    // never call onBackPressed, so Back closed T1 Arc instead of going back a
    // screen. Turning it off keeps the older route that every version uses.
    const appConfig = JSON.parse(text('app.json')) as {
      expo: { android: { predictiveBackGestureEnabled?: boolean } };
    };

    expect(appConfig.expo.android.predictiveBackGestureEnabled).toBe(false);
  });

  it('relies on React Native passing the older Back route to JavaScript', () => {
    // If a React Native update changes this, check Back again on Android 13,
    // 15 and 16 before keeping the setting above.
    const activity = text(
      'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/ReactActivity.java',
    );

    expect(activity).toMatch(
      /public void onBackPressed\(\)\s*\{\s*if \(!mDelegate\.onBackPressed\(\)\)/,
    );
  });
});
