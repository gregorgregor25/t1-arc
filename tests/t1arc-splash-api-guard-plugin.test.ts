import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type StyleResources = {
  resources: {
    style: {
      $: { name: string; parent?: string };
      item?: { $: Record<string, string>; _: string }[];
    }[];
  };
};

const require = createRequire(import.meta.url);
const { splitSplashScreenBehaviour } = require(
  '../plugins/with-t1arc-splash-api-guard.js',
) as {
  splitSplashScreenBehaviour(
    baseStyles: StyleResources,
    api33Styles: StyleResources,
  ): boolean;
};

describe('T1 Arc splash API guard plugin', () => {
  it('moves the Android 13 splash behaviour out of base resources', () => {
    const baseStyles: StyleResources = {
      resources: {
        style: [
          {
            $: {
              name: 'Theme.App.SplashScreen',
              parent: 'Theme.SplashScreen',
            },
            item: [
              {
                $: { name: 'windowSplashScreenBackground' },
                _: '@color/splashscreen_background',
              },
              {
                $: { name: 'android:windowSplashScreenBehavior' },
                _: 'icon_preferred',
              },
            ],
          },
        ],
      },
    };
    const api33Styles: StyleResources = {
      resources: {
        style: [
          {
            $: { name: 'Existing.Api33.Style' },
            item: [
              {
                $: { name: 'android:windowOptOutEdgeToEdgeEnforcement' },
                _: 'true',
              },
            ],
          },
        ],
      },
    };

    expect(splitSplashScreenBehaviour(baseStyles, api33Styles)).toBe(true);

    expect(baseStyles.resources.style[0]!.item).toEqual([
      {
        $: { name: 'windowSplashScreenBackground' },
        _: '@color/splashscreen_background',
      },
    ]);
    expect(api33Styles.resources.style).toEqual([
      {
        $: { name: 'Existing.Api33.Style' },
        item: [
          {
            $: { name: 'android:windowOptOutEdgeToEdgeEnforcement' },
            _: 'true',
          },
        ],
      },
      {
        $: {
          name: 'Theme.App.SplashScreen',
          parent: 'Theme.SplashScreen',
        },
        item: [
          {
            $: { name: 'windowSplashScreenBackground' },
            _: '@color/splashscreen_background',
          },
          {
            $: { name: 'android:windowSplashScreenBehavior' },
            _: 'icon_preferred',
          },
        ],
      },
    ]);
  });

  it('is a no-op when Expo no longer emits the guarded attribute', () => {
    const baseStyles: StyleResources = {
      resources: {
        style: [
          {
            $: { name: 'Theme.App.SplashScreen' },
            item: [
              {
                $: { name: 'windowSplashScreenBackground' },
                _: '@color/splashscreen_background',
              },
            ],
          },
        ],
      },
    };
    const api33Styles: StyleResources = { resources: { style: [] } };

    expect(splitSplashScreenBehaviour(baseStyles, api33Styles)).toBe(false);
    expect(api33Styles.resources.style).toEqual([]);
  });
});
